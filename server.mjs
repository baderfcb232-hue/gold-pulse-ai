import http from 'node:http';
import {readFileSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';
import {randomBytes, timingSafeEqual, createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {analyze, sourceAnalysis, cleanSnapshot, trackPlan, positionSize, text, defaults} from './engine.mjs';
import {mt5Archive} from './archive.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(ROOT, 'public');
const limit = 1_500_000;
const exactSecret = (input, expected) => {
  if (!expected || expected.length < 32 || typeof input !== 'string') return false;
  return timingSafeEqual(createHash('sha256').update(input).digest(), createHash('sha256').update(expected).digest());
};
const escapeCsv = v => {
  let s = String(v ?? '');
  if (/^[=+@\-]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
};

export function createApplication({dataDir = process.env.DATA_DIR || resolve(ROOT, '.data'),
  ingestToken = process.env.MT5_INGEST_TOKEN || '', dashboardToken = process.env.DASHBOARD_TOKEN || '',
  publicBase = process.env.PUBLIC_BASE_URL || (process.env.RENDER === 'true' ? 'https://gold-pulse-ai.onrender.com' : ''),
  storagePersistent = process.env.PERSISTENT_STORAGE_CONFIRMED === 'true', clock = () => Date.now() / 1000,
  config = {}} = {}) {
  if (ingestToken.length >= 32 && ingestToken === dashboardToken)
    throw new Error('MT5_INGEST_TOKEN and DASHBOARD_TOKEN must be different.');
  mkdirSync(dataDir, {recursive: true, mode: 0o700});
  const db = new DatabaseSync(resolve(dataDir, 'nabd.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS signals (id TEXT PRIMARY KEY, issued_at REAL NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, time REAL NOT NULL, event TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS deals (ticket TEXT PRIMARY KEY, time REAL NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS commands (id INTEGER PRIMARY KEY, time REAL NOT NULL, expires REAL NOT NULL,
      action TEXT NOT NULL, ticket TEXT NOT NULL, fraction REAL NOT NULL, status TEXT NOT NULL, result TEXT);`);
  let snapshot = null;
  try { const row = db.prepare('SELECT data FROM snapshot WHERE id=1').get(); if (row) snapshot = JSON.parse(row.data); } catch {}
  let lastSource = snapshot ? `${snapshot.account_ref}|${snapshot.broker}|${snapshot.symbol}|${snapshot.execution.managed_magic}` : null;
  const clients = new Set(), sessions = new Map(), attempts = new Map();
  let revision = 0;
  const cfg = {...defaults, signalSource: process.env.SIGNAL_SOURCE || 'EA', ...config};
  if (!['EA','DASHBOARD'].includes(cfg.signalSource)) throw new Error('SIGNAL_SOURCE must be EA or DASHBOARD');
  const audit = (event, data) => db.prepare('INSERT INTO audit(time,event,data) VALUES(?,?,?)').run(clock(), event, JSON.stringify(data));
  const signalRows = () => db.prepare('SELECT data FROM signals ORDER BY issued_at DESC LIMIT 200').all().map(x => JSON.parse(x.data));
  const cookieSession = req => {
    const key = (req.headers.cookie ?? '').split(';').map(s => s.trim()).find(s => s.startsWith('nabd_session='))?.slice(13);
    const expiry = sessions.get(key);
    if (expiry && expiry > clock()) return true;
    if (key) sessions.delete(key);
    return false;
  };
  const bearer = req => (req.headers.authorization ?? '').replace(/^Bearer /, '');
  const operator = req => cookieSession(req) || exactSecret(bearer(req), dashboardToken);
  const bridge = req => exactSecret(bearer(req), ingestToken);
  function ownOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true; // API clients must still present their independent bearer token.
    const expected = publicBase ? new URL(publicBase).origin : `http://${req.headers.host}`;
    return origin === expected;
  }
  const headers = req => ({
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-src 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  });
  const send = (req, res, status, data, type = 'application/json; charset=utf-8', extra = {}) => {
    res.writeHead(status, {...headers(req), 'Content-Type': type, ...extra});
    res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
  };
  async function body(req) {
    const length = Number(req.headers['content-length'] || 0);
    if (length > limit) throw new Error('Request too large');
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) throw new Error('JSON content type required');
    const chunks = []; let total = 0;
    for await (const chunk of req) {
      total += chunk.length; if (total > limit) throw new Error('Request too large'); chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  function publicState() {
    const a = sourceAnalysis(snapshot, clock(), cfg);
    const active = signalRows().find(s => s.status === 'TRACKING' && (a.source === 'MT5_EA' ? s.source === 'MT5_EA' : s.source !== 'MT5_EA'));
    const available = a.connection === 'LIVE' && a.source_ready;
    return {version: '3.2.0', revision, symbol: snapshot?.symbol || 'XAUUSD', broker: snapshot?.broker || null,
      bid: snapshot?.bid ?? null, ask: snapshot?.ask ?? null,
      spread: snapshot ? (snapshot.ask - snapshot.bid) / snapshot.spec.point : null,
      spreadUnit: 'points', lastUpdate: snapshot?.quote_at ?? null,
      connection: a.connection, quoteAge: a.quote_age,
      aiDecision: a.decision, confidence: a.score, confidenceMeaning: 'CONDITION_SCORE',
      riskLevel: a.risk, reasons: a.reasons, checks: a.checks,
      timeframes: a.frames, zones: a.zones, strategy: a.strategy,
      signalSource: a.source, signalSourceReady: a.source_ready,
      currentSignal: available ? active ?? null : null,
      suspendedSignal: !available ? active?.id ?? null : null,
      bot: snapshot?.ea ? {heartbeat_at: snapshot.ea.heartbeat_at, checked_at: snapshot.ea.checked_at,
        emergency_stop: snapshot.ea.emergency_stop, settings: snapshot.ea.settings} : null,
      spec: snapshot?.spec ?? null,
      calendar: snapshot?.calendar ?? {status: 'unavailable', updated_at: null, events: []},
      newsBlock: a.news_block ?? null,
      execution: snapshot ? {...snapshot.execution, managed_magic: undefined,
        remote_control: snapshot.execution.remote_control && storagePersistent} : null,
      storage: {mode: storagePersistent ? 'persistent' : 'ephemeral', remoteControlAvailable: storagePersistent},
      historyCount: db.prepare('SELECT COUNT(*) AS n FROM signals').get().n,
      publicBaseUrl: publicBase || null, accountDataShared: Boolean(snapshot?.account),
      serverTime: clock(), controlsConfigured: dashboardToken.length >= 32 && ingestToken.length >= 32};
  }
  function broadcast() {
    const message = 'event: state\ndata: ' + JSON.stringify(publicState()) + '\n\n';
    for (const res of clients) if (!res.write(message)) { clients.delete(res); res.end(); }
  }
  function ingest(raw) {
    const next = cleanSnapshot(raw, clock());
    const source = `${next.account_ref}|${next.broker}|${next.symbol}|${next.execution.managed_magic}`;
    if (lastSource && source !== lastSource) throw new Error('Source mismatch. Use a separate DATA_DIR for a different account, symbol or EA magic.');
    if (snapshot && next.quote_at < snapshot.quote_at) throw new Error('Out-of-order quote');
    snapshot = next; lastSource = source; revision++;
    db.prepare('INSERT INTO snapshot(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(JSON.stringify(snapshot));
    for (const d of next.deals) db.prepare('INSERT OR IGNORE INTO deals(ticket,time,data) VALUES(?,?,?)').run(d.ticket, d.time, JSON.stringify(d));
    for (const p of signalRows().filter(p => p.status === 'TRACKING')) {
      const change = trackPlan(p, snapshot, clock());
      if (change) { db.prepare('UPDATE signals SET data=? WHERE id=?').run(JSON.stringify({...p, ...change}), p.id); audit('SIGNAL_UPDATE', {id: p.id, ...change}); }
    }
    const analysis = sourceAnalysis(snapshot, clock(), cfg), plan = analysis.plan;
    if (plan && !signalRows().some(p => p.status === 'TRACKING' && p.strategy === plan.strategy)) {
      const id = `${plan.strategy}:${plan.symbol}:${plan.bar_time}:${plan.side}`;
      const saved = db.prepare('INSERT OR IGNORE INTO signals(id,issued_at,data) VALUES(?,?,?)').run(id, plan.issued_at, JSON.stringify({...plan, id}));
      if (saved.changes) audit('SIGNAL_ISSUED', {id, side: plan.side});
    }
    broadcast();
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost'), path = url.pathname;
      if (!['GET', 'POST'].includes(req.method)) return send(req, res, 405, {error: 'Method not allowed'});
      if (req.method === 'POST' && !ownOrigin(req)) return send(req, res, 403, {error: 'Origin rejected'});
      if (path === '/healthz' && req.method === 'GET') return send(req, res, 200, {ok: true, version: '3.2.0', storage: storagePersistent ? 'persistent' : 'ephemeral'});
      if (path === '/api/state' && req.method === 'GET') return send(req, res, 200, publicState());
      if (path === '/engine.mjs' && req.method === 'GET') return send(req, res, 200, readFileSync(resolve(ROOT, 'engine.mjs')), 'text/javascript; charset=utf-8');
      if (path === '/api/events' && req.method === 'GET') {
        if (clients.size >= 200) return send(req, res, 503, {error: 'Too many connections'});
        res.writeHead(200, {...headers(req), 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive', 'X-Accel-Buffering': 'no'});
        res.write('event: state\ndata: ' + JSON.stringify(publicState()) + '\n\n');
        clients.add(res); req.on('close', () => clients.delete(res)); return;
      }
      if (path === '/api/candles' && req.method === 'GET') {
        const tf = url.searchParams.get('tf') || 'M5';
        if (!['M5','M15','H1','H4'].includes(tf)) return send(req, res, 400, {error: 'Invalid timeframe'});
        return send(req, res, 200, {tf, symbol: snapshot?.symbol || null, source: snapshot?.broker || null,
          candles: snapshot?.candles[tf].slice(-320) || []});
      }
      if (path === '/api/signals' && req.method === 'GET') return send(req, res, 200, {signals: signalRows(), kind: 'VIRTUAL_RECOMMENDATIONS'});
      if (path === '/api/signals.csv' && req.method === 'GET') {
        const cols = ['id','source','issued_at','symbol','side','entry','sl','tp1','tp2','status','tp1_hit','exit','r','tracking'];
        const csv = '\uFEFF' + [cols.join(','), ...signalRows().map(s => cols.map(k => escapeCsv(s[k])).join(','))].join('\r\n');
        return send(req, res, 200, csv, 'text/csv; charset=utf-8', {'Content-Disposition': 'attachment; filename="nabd-signals.csv"'});
      }
      if (['/api/mt5', '/api/update'].includes(path) && req.method === 'POST') {
        if (!bridge(req)) return send(req, res, 401, {error: 'Invalid bridge token'});
        const raw = await body(req);
        if (path === '/api/update' && (!raw.spec || !raw.candles || !raw.account_ref))
          return send(req, res, 426, {error: 'صيغة الربط القديمة لا تحتوي على الشموع ومواصفات البروكر. استخدم جسر NABD المحدّث.', endpoint: '/api/mt5'});
        ingest(raw); return send(req, res, 200, {ok: true, status: 'success', received_at: clock()});
      }
      if (path === '/api/risk-settings' && req.method === 'POST') {
        if (!operator(req)) return send(req, res, 401, {error: 'تسجيل دخول المشغّل مطلوب.'});
        if (!snapshot || publicState().connection !== 'LIVE')
          return send(req, res, 409, {error: 'مواصفات بروكر حديثة مطلوبة لحساب اللوت.'});
        const b = await body(req), plan = publicState().currentSignal;
        if ((b.entry == null || b.sl == null) && !plan)
          return send(req, res, 409, {error: 'أدخل سعر الدخول ووقف الخسارة أو انتظر خطة البوت.'});
        const estimate = positionSize({equity: Number(b.balance ?? b.equity ?? snapshot.account?.equity),
          riskPercent: Number(b.riskPercent), entry: Number(b.entry ?? plan.entry), sl: Number(b.sl ?? plan.sl),
          spec: snapshot.spec, commissionPerLot: Number(b.commissionPerLot ?? 0),
          freeMargin: snapshot.account?.free_margin ?? Infinity});
        return send(req, res, 200, {status: 'estimated', calculatedLot: estimate.volume, ...estimate,
          message: 'الحساب تقديري؛ إعدادات مخاطرة البوت تبقى مضبوطة في MT5.'});
      }
      if (path === '/api/login' && req.method === 'POST') {
        if (!ownOrigin(req)) return send(req, res, 403, {error: 'Origin rejected'});
        const ip = req.socket.remoteAddress, rate = attempts.get(ip) || {n: 0, since: clock()};
        if (clock() - rate.since > 600) { rate.n = 0; rate.since = clock(); }
        if (++rate.n > 10) return send(req, res, 429, {error: 'محاولات كثيرة؛ حاول بعد عشر دقائق.'});
        attempts.set(ip, rate);
        const b = await body(req);
        if (!exactSecret(b.token, dashboardToken)) return send(req, res, 401, {error: 'رمز الدخول غير صحيح أو غير مضبوط في الخادم.'});
        const session = randomBytes(32).toString('hex'); sessions.set(session, clock() + 21600);
        const secure = publicBase.startsWith('https://') ? '; Secure' : '';
        audit('OPERATOR_LOGIN', {});
        return send(req, res, 200, {ok: true}, 'application/json; charset=utf-8',
          {'Set-Cookie': `nabd_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=21600${secure}`});
      }
      if (path === '/api/logout' && req.method === 'POST') {
        const key = (req.headers.cookie ?? '').split(';').map(s => s.trim()).find(s => s.startsWith('nabd_session='))?.slice(13);
        if (key) sessions.delete(key);
        return send(req, res, 200, {ok: true}, 'application/json; charset=utf-8',
          {'Set-Cookie': 'nabd_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});
      }
      if (path === '/api/account' && req.method === 'GET') {
        if (!operator(req)) return send(req, res, 401, {error: 'تسجيل دخول المشغّل مطلوب.'});
        return send(req, res, 200, {account: snapshot?.account ?? null, positions: snapshot?.positions ?? [],
          deals: db.prepare('SELECT data FROM deals ORDER BY time DESC LIMIT 1000').all().map(x => JSON.parse(x.data)),
          commands: db.prepare('SELECT * FROM commands ORDER BY id DESC LIMIT 100').all(),
          lastUpdate: snapshot?.received_at ?? null});
      }
      if (path === '/api/mt5.zip' && req.method === 'GET') {
        if (!operator(req)) return send(req, res, 401, {error: 'تسجيل دخول المشغّل مطلوب لتنزيل ملفات الربط.'});
        return send(req, res, 200, mt5Archive(ROOT), 'application/zip', {'Content-Disposition':'attachment; filename="NABD_MT5_Link.zip"'});
      }
      if (path === '/api/commands' && req.method === 'POST') {
        if (!operator(req)) return send(req, res, 401, {error: 'تسجيل دخول المشغّل مطلوب.'});
        if (!storagePersistent) return send(req, res, 409, {error: 'إدارة الصفقات من الموقع تحتاج حفظًا دائمًا لسجل الأوامر. المراقبة متاحة.'});
        const a = analyze(snapshot, clock(), cfg);
        if (a.connection !== 'LIVE') return send(req, res, 409, {error: 'الربط غير حي؛ لا يمكن إرسال أمر.'});
        if ((cfg.signalSource === 'EA' || snapshot.ea) && !sourceAnalysis(snapshot, clock(), {...cfg, signalSource:'EA'}).source_ready)
          return send(req, res, 409, {error: 'حالة البوت المحلي قديمة أو غير متاحة؛ أوامر الإدارة معلّقة.'});
        const b = await body(req), action = b.action;
        if (!snapshot.execution.remote_control) return send(req, res, 409, {error: 'التحكم من الموقع غير مفعّل في إعدادات البوت.'});
        if (!['PAUSE','RESUME','CLOSE_POSITION','CLOSE_ALL','BREAK_EVEN','PARTIAL_CLOSE'].includes(action))
          return send(req, res, 400, {error: 'أمر غير مدعوم.'});
        if (!snapshot.execution.enabled && !['PAUSE','RESUME'].includes(action))
          return send(req, res, 409, {error: 'التنفيذ غير مفعّل داخل MT5.'});
        const ticket = text(b.ticket ?? '0', 25);
        if (!/^\d{1,25}$/.test(ticket)) return send(req, res, 400, {error: 'رقم صفقة غير صالح.'});
        if (['CLOSE_POSITION','BREAK_EVEN','PARTIAL_CLOSE'].includes(action) && !snapshot.positions.some(p => p.ticket === ticket))
          return send(req, res, 400, {error: 'هذه الصفقة ليست ضمن صفقات البوت المرتبطة.'});
        const fraction = action === 'PARTIAL_CLOSE' ? Number(b.fraction) : 0;
        if (action === 'PARTIAL_CLOSE' && !(fraction > 0 && fraction < 1)) return send(req, res, 400, {error: 'نسبة إغلاق جزئي غير صالحة.'});
        if (db.prepare("SELECT id FROM commands WHERE status='QUEUED' AND expires>? LIMIT 1").get(clock()))
          return send(req, res, 409, {error: 'يوجد أمر قيد الانتظار؛ انتظر تأكيده أولًا.'});
        const id = db.prepare("INSERT INTO commands(time,expires,action,ticket,fraction,status) VALUES(?,?,?,?,?,'QUEUED')")
          .run(clock(), clock() + 20, action, ticket, fraction).lastInsertRowid;
        audit('COMMAND_QUEUED', {id: Number(id), action, ticket});
        return send(req, res, 202, {id: Number(id), status: 'QUEUED', message: 'الأمر في الانتظار؛ التنفيذ يحتاج تأكيد MT5.'});
      }
      if (path === '/api/bridge/next' && req.method === 'GET') {
        if (!bridge(req)) return send(req, res, 401, {error: 'Invalid bridge token'});
        if (!storagePersistent) return send(req, res, 200, '', 'text/plain; charset=utf-8');
        db.prepare("UPDATE commands SET status='EXPIRED' WHERE status='QUEUED' AND expires<?").run(clock());
        const c = db.prepare("SELECT * FROM commands WHERE status='QUEUED' ORDER BY id LIMIT 1").get();
        return send(req, res, 200, c ? [c.id,c.action,c.ticket,c.fraction,Math.floor(c.time),Math.floor(c.expires)].join('|') : '', 'text/plain; charset=utf-8');
      }
      if (path === '/api/bridge/result' && req.method === 'POST') {
        if (!bridge(req)) return send(req, res, 401, {error: 'Invalid bridge token'});
        const b = await body(req), c = db.prepare('SELECT * FROM commands WHERE id=?').get(Number(b.id));
        if (!c) return send(req, res, 404, {error: 'Unknown command'});
        if (!['QUEUED','EXPIRED'].includes(c.status)) return send(req, res, 200, {ok: true, status: c.status});
        if (!['CONFIRMED','REJECTED','UNCERTAIN'].includes(b.status)) return send(req, res, 400, {error: 'Invalid confirmation'});
        db.prepare('UPDATE commands SET status=?,result=? WHERE id=?').run(b.status, text(b.message, 500), c.id);
        audit('COMMAND_RESULT', {id: c.id, status: b.status, message: text(b.message, 500)});
        return send(req, res, 200, {ok: true});
      }
      const files = {'/':'index.html','/index.html':'index.html','/app.js':'app.js','/styles.css':'styles.css','/manifest.webmanifest':'manifest.webmanifest','/icon.svg':'icon.svg'};
      if (req.method === 'GET' && files[path]) {
        const type = path.endsWith('.js') ? 'text/javascript; charset=utf-8' : path.endsWith('.css') ? 'text/css; charset=utf-8'
          : path.endsWith('.webmanifest') ? 'application/manifest+json' : path.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8';
        return send(req, res, 200, readFileSync(resolve(PUBLIC, files[path])), type);
      }
      send(req, res, 404, {error: 'Not found'});
    } catch (e) {
      if (req.url?.startsWith('/api/')) return send(req, res, 400, {error: text(e.message, 300)});
      console.error('Request failed:', e.message); send(req, res, 500, {error: 'Server error'});
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  const timer = setInterval(() => {
    try {
      db.prepare("UPDATE commands SET status='EXPIRED' WHERE status='QUEUED' AND expires<?").run(clock());
      for (const p of signalRows().filter(p => p.status === 'TRACKING' && p.expires_at <= clock())) {
        const change = trackPlan(p, snapshot, clock());
        if (change) { db.prepare('UPDATE signals SET data=? WHERE id=?').run(JSON.stringify({...p, ...change}), p.id);
          audit('SIGNAL_UPDATE', {id: p.id, ...change}); }
      }
      for (const [key, expiry] of sessions) if (expiry < clock()) sessions.delete(key);
      for (const [key, rate] of attempts) if (clock() - rate.since > 600) attempts.delete(key);
      broadcast();
    } catch (e) { console.error('State update failed:', e.message); }
  }, 5000); timer.unref();
  const close = async () => {clearInterval(timer); for (const c of clients) c.end();
    await new Promise(r => server.close(r)); db.close();};
  return {server, ingest, publicState, signalRows, db, close};
}
export function startServer() {
  const app = createApplication();
  const port = Number(process.env.PORT || 3000);
  app.server.listen(port, process.env.BIND_ADDRESS || '0.0.0.0', () => console.log(`NABD v3.2 listening on ${app.server.address().port}`));
  if (!(process.env.MT5_INGEST_TOKEN?.length >= 32 && process.env.DASHBOARD_TOKEN?.length >= 32))
    console.log('MT5 ingestion and operator controls require separately configured 32+ character tokens.');
  let closing = false;
  const shutdown = async () => {if (closing) return; closing = true; await app.close();};
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return app;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer();
