import {randomUUID, randomBytes} from 'node:crypto';
import {postgresAuthStore} from './auth-store.mjs';
import {opaque, digest, equal, keyed, parseKey, encrypt, decrypt, hashPassword, checkPassword, newTotpSecret, totpStep} from './auth-crypto.mjs';
import {createAuthMailer} from './auth-mail.mjs';
import {backupConfig, exportAuthBackup, readAuthBackup, backupTables} from './auth-backup.mjs';
import {createSubscriberAlerts} from './subscriber-alerts.mjs';
import {createSubscriberSignalDispatch} from './subscriber-signal-dispatch.mjs';

const fail = (status, message) => {throw Object.assign(Error(message), {status});};
const result = (data = {ok: true}, status = 200, headers = {}) => ({data, status, headers});
const clean = (value, max) => typeof value === 'string' ? value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : '';
function emailAddress(value) {
  if (typeof value !== 'string' || value.trim().length > 254) fail(400, 'أدخل بريدًا إلكترونيًا صالحًا.');
  const email = clean(value, 255).toLowerCase();
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(email)) fail(400, 'أدخل بريدًا إلكترونيًا صالحًا.');
  return email;
}
function passwordInput(value) {
  if (typeof value !== 'string' || value.length < 15 || value.length > 128) fail(400, 'كلمة المرور بين 15 و128 حرفًا؛ يمكنك استخدام عبارة طويلة.');
  return value;
}
const cookieValue = (req, name) => (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1) || '';
// A fresh read-only heartbeat never grants a trade permission.
const monitorStatus = (worker, at) => {
  if (!worker?.worker_id) return 'NOT_ISSUED';
  if (worker.last_seen_at == null) return 'AWAITING_WORKER';
  if (Number(worker.last_seen_at) > at + 5 || at - Number(worker.last_seen_at) > 45) return 'STALE';
  return Number(worker.mt5_online) === 1 ? 'OBSERVED_DEMO' : 'MT5_OFFLINE';
};
const userView = u => ({id: u.id, email: u.email, name: u.name, role: u.role, status: u.status,
  verified: Boolean(u.verified_at), created_at: Number(u.created_at), last_login: u.last_login && Number(u.last_login),
  notifications: Boolean(u.notifications), recommendations: Boolean(u.recommendations), mfa: Boolean(u.totp_secret)});

export function createAccounts({publicBase, clock = () => Date.now() / 1000, store: injectedStore, mailer: injectedMailer,
  env = process.env, encryptionKey, adminEmail, backup: injectedBackup, operationalStatus = () => ({}), onError = () => {}, telegramFetch = fetch} = {}) {
  const key = encryptionKey || parseKey(env.AUTH_ENCRYPTION_KEY), owner = (adminEmail || env.AUTH_ADMIN_EMAIL || '').trim().toLowerCase();
  const secure = publicBase?.startsWith('https://'), base = publicBase?.replace(/\/$/, '') || '';
  let privateSignalDispatch = null;
  const publishSubscriberSignal = async signal => {
    await ready;
    if (!online || !healthy || closed ||
      env.NABD_SUBSCRIBER_TELEGRAM_AUTO_SIGNALS !== 'true')
      return {attempted:0,enabled:false};
    if (!privateSignalDispatch) privateSignalDispatch=createSubscriberSignalDispatch({
      store,clock,enabled:true,botToken:env.NABD_SUBSCRIBER_TELEGRAM_BOT_TOKEN||'',
      fetcher:telegramFetch
    });
    return privateSignalDispatch.publish(signal);
  };
  let subscriberAlerts = null;
  const subscriberBot = () => {
    if (!subscriberAlerts) subscriberAlerts = createSubscriberAlerts({
      store,clock,botToken:env.NABD_SUBSCRIBER_TELEGRAM_BOT_TOKEN||'',
      botUsername:env.NABD_SUBSCRIBER_TELEGRAM_BOT_USERNAME||'',
      webhookSecret:env.NABD_SUBSCRIBER_TELEGRAM_WEBHOOK_SECRET||'',
      fetcher:telegramFetch
    });
    return subscriberAlerts;
  };
  const smtp = env.AUTH_SMTP_HOST && env.AUTH_SMTP_USER && env.AUTH_SMTP_PASSWORD ? {
    host: env.AUTH_SMTP_HOST, port: Number(env.AUTH_SMTP_PORT || 465), secure: env.AUTH_SMTP_SECURE !== 'false',
    auth: {user: env.AUTH_SMTP_USER, pass: env.AUTH_SMTP_PASSWORD}} : null;
  const provider = env.AUTH_MAIL_PROVIDER || 'resend';
  const mailConfigured = Boolean(injectedMailer || (env.AUTH_MAIL_FROM && (smtp || (env.AUTH_MAIL_API_KEY && ['resend', 'brevo'].includes(provider)))));
  const mailer = injectedMailer || createAuthMailer({apiKey: env.AUTH_MAIL_API_KEY, from: env.AUTH_MAIL_FROM, publicBase: base, provider, smtp});
  let store = injectedStore, databaseReady = false, online = false, healthy = true, closed = false, timer, backupBusy = false;
  let backup = injectedBackup || {key: null, storage: null}, lastBackup = null, backupState = 'NOT_CONFIGURED';
  const needs = [];
  if (!store && !env.AUTH_DATABASE_URL) needs.push('DATABASE');
  if (!key) needs.push('ENCRYPTION_KEY');
  if (!mailConfigured) needs.push('EMAIL');
  if (!owner || !owner.includes('@')) needs.push('ADMIN_EMAIL');
  if (!base || (!secure && !injectedStore)) needs.push('HTTPS_URL');
  const status = () => ({ready: online && healthy, status: online && healthy ? 'READY' : needs.length ? 'SETUP_REQUIRED' : 'UNAVAILABLE',
    missing: [...needs], database: databaseReady && healthy ? 'CONNECTED' : needs.includes('DATABASE') ? 'NOT_CONFIGURED' : 'UNAVAILABLE',
    persistence: databaseReady && store.kind === 'postgres' ? 'postgres' : injectedStore ? 'test-only' : 'unavailable',
    email: mailConfigured ? 'CONFIGURED' : 'NOT_CONFIGURED', backups: {state: backupState, last_success: lastBackup},
    note: online ? null : 'التسجيل بانتظار تهيئة الحفظ الدائم والبريد من مسؤول الموقع.'});
  // PostgreSQL may replace its idle connections during a Render plan upgrade.
  // A successful SELECT 1 is the only proof of recovery, not the pool error event.
  async function probeDatabase() {
    if (!online || closed) return false;
    try {
      await store.query('SELECT 1');
      if (!healthy) console.info('NABD accounts database connection recovered');
      healthy = true; return true;
    } catch {
      if (healthy) console.warn('NABD accounts database health check failed');
      healthy = false; return false;
    }
  }
  let attemptPromise = null;
  async function ensureOnline() {
    if (online || closed || (!store && !env.AUTH_DATABASE_URL) || (databaseReady && needs.length)) return;
    if (attemptPromise) return attemptPromise;
    attemptPromise = (async () => {
      try {
        store ||= await postgresAuthStore(env.AUTH_DATABASE_URL);
        await store.initialize();
        databaseReady = true;
        if (needs.length) return;
        if (!injectedBackup) backup = backupConfig(env);
        backupState = backup.key && backup.storage ? 'READY' : 'NOT_CONFIGURED';
        const last = (await store.query("SELECT value FROM nabd_auth_settings WHERE key='last_backup'")).rows[0];
        lastBackup = last ? Number(last.value) : null;
        online = true; healthy = true;
        await maintenance().catch(() => {});
        console.info('NABD accounts database initialized and reachable');
      } catch {
        online = false; healthy = false;
        console.warn('NABD accounts setup unavailable; will retry without changing accounts');
      }
    })();
    try {await attemptPromise;} finally {attemptPromise = null;}
  }
  const ready = ensureOnline();
  // Retry failed initializations without restarting the trading engine.
  if (store || env.AUTH_DATABASE_URL) {
    timer = setInterval(() => (online ? maintenance() : ensureOnline()).catch(() => {}), 60000);
    timer.unref();
  }
  const audit = (q, actor, event, subject = null) => q('INSERT INTO nabd_auth_audit(id,time,actor,event,subject) VALUES(?,?,?,?,?)', [randomUUID(), clock(), actor, event, subject]);
  const cookie = (name, value, seconds) => `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${seconds}${secure ? '; Secure' : ''}`;
  const clearCookies = () => [cookie('nabd_member', '', 0), cookie('nabd_challenge', '', 0)];
  const csrf = token => keyed(key, 'csrf:' + token);
  function ip(req) {
    const peer = req.socket?.remoteAddress || 'unknown';
    if (env.RENDER !== 'true') return peer;
    // Render appends the client to X-Forwarded-For; never use an attacker-supplied first entry.
    return clean((req.headers['x-forwarded-for'] || '').split(',').at(-1), 80) || peer;
  }
  async function rate(req, purpose, email = '') {
    for (const [identity, maximum] of [[`ip:${ip(req)}`, purpose === 'login' ? 60 : 20], ...(email ? [[`email:${email}`, purpose === 'login' ? 10 : 4]] : [])]) {
      const id = keyed(key, `${purpose}:${identity}`), expires = clock() + 900;
      const {rows} = await store.query(`INSERT INTO nabd_auth_limits(key,count,expires_at) VALUES(?,1,?)
        ON CONFLICT(key) DO UPDATE SET count=CASE WHEN nabd_auth_limits.expires_at<? THEN 1 ELSE nabd_auth_limits.count+1 END,
        expires_at=CASE WHEN nabd_auth_limits.expires_at<? THEN excluded.expires_at ELSE nabd_auth_limits.expires_at END RETURNING count`, [id, expires, clock(), clock()]);
      if (rows[0].count > maximum) fail(429, 'محاولات كثيرة؛ حاول بعد 15 دقيقة.');
    }
  }
  async function session(req) {
    await ready; if (!online || closed) return null;
    const token = cookieValue(req, 'nabd_member'); if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const {rows} = await store.query(`SELECT s.id AS session_id,s.hash AS session_hash,s.mfa AS session_mfa,s.created_at AS session_created,
      u.* FROM nabd_sessions s JOIN nabd_users u ON u.id=s.user_id WHERE s.hash=? AND s.expires_at>? AND u.status='active' AND u.verified_at IS NOT NULL`, [digest(token), clock()]);
    return rows[0] ? {...rows[0], csrf: csrf(token)} : null;
  }
  async function authenticated(req, write = false, admin = false) {
    const u = await session(req); if (!u) fail(401, 'سجّل الدخول للوصول إلى حسابك.');
    if (write && !equal(req.headers['x-nabd-csrf'], u.csrf)) fail(403, 'انتهى تحقق الصفحة؛ أعد تحميلها وحاول مجددًا.');
    if (admin && (u.role !== 'admin' || !u.totp_secret || !u.session_mfa)) fail(403, 'لوحة الأدمن تحتاج حساب مسؤول وتحققًا بخطوتين.');
    return u;
  }
  async function issueToken(q, userId, purpose, lifetime) {
    const token = opaque();
    await q('DELETE FROM nabd_tokens WHERE user_id=? AND purpose=?', [userId, purpose]);
    await q('INSERT INTO nabd_tokens(hash,user_id,purpose,expires_at) VALUES(?,?,?,?)', [digest(token), userId, purpose, clock() + lifetime]);
    return token;
  }
  async function newSession(q, u, req, mfa = false) {
    const token = opaque();
    await q('INSERT INTO nabd_sessions(hash,id,user_id,created_at,expires_at,seen_at,agent,mfa) VALUES(?,?,?,?,?,?,?,?)',
      [digest(token), randomUUID(), u.id, clock(), clock() + 604800, clock(), clean(req.headers['user-agent'] || 'جهاز غير معروف', 180), mfa ? 1 : 0]);
    await q('UPDATE nabd_users SET last_login=? WHERE id=?', [clock(), u.id]);
    await audit(q, u.id, 'LOGIN', u.id);
    return result({ok: true, user: userView(u), csrf: csrf(token)}, 200, {'Set-Cookie': [cookie('nabd_member', token, 604800), cookie('nabd_challenge', '', 0)]});
  }
  async function freshPassword(u, password) {
    if (typeof password !== 'string' || password.length > 128 || !await checkPassword(password, u.password_hash)) fail(401, 'كلمة المرور الحالية غير صحيحة.');
  }
  async function secondFactor(q, u, code) {
    const step = totpStep(decrypt(u.totp_secret, key), code, clock(), u.totp_last_step);
    if (step !== null) {await q('UPDATE nabd_users SET totp_last_step=? WHERE id=?', [step, u.id]); return true;}
    if (typeof code !== 'string' || !/^[a-f0-9]{24}$/.test(code)) return false;
    return (await q("DELETE FROM nabd_tokens WHERE hash=? AND user_id=? AND purpose='recovery' AND expires_at>? RETURNING hash", [digest(code), u.id, clock()])).rows.length > 0;
  }
  async function sendMail(payload) {
    try {await mailer(payload);} catch {fail(503, 'تعذّر إرسال البريد الآن؛ حاول مجددًا بعد قليل.');}
  }
  async function maintenance() {
    if (!online || closed || !await probeDatabase()) return;
    await store.query('DELETE FROM nabd_tokens WHERE expires_at<?', [clock()]);
    await store.query('DELETE FROM nabd_sessions WHERE expires_at<?', [clock()]);
    await store.query('DELETE FROM nabd_auth_limits WHERE expires_at<?', [clock()]);
    if (backup.key && backup.storage && (!lastBackup || clock() - lastBackup >= 86400)) await runBackup();
  }
  async function runBackup() {
    if (!backup.key || !backup.storage) fail(503, 'النسخ التلقائي يحتاج وجهة تخزين مستقلة ومفتاح نسخ احتياطي.');
    if (backupBusy) fail(409, 'يوجد نسخ احتياطي قيد التنفيذ.');
    backupBusy = true;
    try {
      const content = await exportAuthBackup(store, backup.key, clock);
      await backup.storage(`nabd-accounts/${Math.floor(clock())}-${randomUUID()}.enc`, content);
      lastBackup = clock(); backupState = 'READY';
      await store.query("INSERT INTO nabd_auth_settings(key,value) VALUES('last_backup',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [String(lastBackup)]);
    } catch {backupState = 'ERROR'; fail(503, 'تعذر النسخ إلى الوجهة الخارجية؛ لم يتم تأكيد حفظ النسخة.');}
    finally {backupBusy = false;}
  }

  async function handle(req, path, url, body) {
    if (!path.startsWith('/api/auth/') && !path.startsWith('/api/admin/') && path !== '/api/worker/mt5-heartbeat' && path !== '/api/telegram/subscriber-webhook') return null;
    await ready;
    if (path === '/api/auth/status' && req.method === 'GET') {
      if (!online) await ensureOnline();
      if (online) await probeDatabase();
      return result(status());
    }
    if (!online) await ensureOnline();
    if (online && !healthy) await probeDatabase();
    if (!online || !healthy)
      return result({error: 'خدمة الحسابات غير متاحة مؤقتًا؛ جارٍ إعادة الاتصال بقاعدة البيانات.', ...status()}, 503);
    if (req.method === 'POST' && path !== '/api/worker/mt5-heartbeat' && path !== '/api/telegram/subscriber-webhook' && req.headers.origin !== new URL(base).origin) return result({error: 'Origin rejected'}, 403);
    try {
      if (path === '/api/telegram/subscriber-webhook' && req.method === 'POST') {
        const secret=req.headers['x-telegram-bot-api-secret-token'];
        const packet=await body(req);
        await subscriberBot().acceptWebhook(secret,packet);
        return result({ok:true});
      }
      if (path === '/api/worker/mt5-heartbeat' && req.method === 'POST') {
        // This endpoint is limited to read-only account presence. A worker token
        // can NEVER call operator trade APIs, poll signals or dispatch orders.
        const token = req.headers['x-nabd-worker-token'];
        if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token))
          fail(401, 'Invalid monitoring worker credentials');
        const packet = await body(req);
        if (!packet || typeof packet !== 'object' || Array.isArray(packet) ||
            Object.keys(packet).some(name => !['account_id','worker_id','broker','server','login','environment','terminal_connected','demo_mode'].includes(name)) ||
            typeof packet.account_id !== 'string' || !/^[a-f0-9-]{36}$/.test(packet.account_id) ||
            typeof packet.worker_id !== 'string' || !/^[a-f0-9-]{36}$/.test(packet.worker_id) ||
            typeof packet.login !== 'string' || !/^[1-9][0-9]{3,15}$/.test(packet.login) ||
            typeof packet.server !== 'string' || packet.server.length > 60 ||
            packet.broker !== 'JustMarkets' || packet.environment !== 'demo' ||
            typeof packet.terminal_connected !== 'boolean' || typeof packet.demo_mode !== 'boolean')
          fail(400, 'Invalid read-only MT5 monitoring report');
        const identity = (await store.query(`SELECT w.account_id,w.worker_id,
          a.broker,a.server_name,a.login,a.environment
          FROM nabd_mt5_monitor_workers w
          JOIN nabd_member_mt5_accounts a ON a.id=w.account_id
          JOIN nabd_mt5_hosting_requests h ON h.account_id=a.id
          JOIN nabd_users owner ON owner.id=a.user_id
          WHERE w.account_id=? AND w.token_hash=? AND h.status='APPROVED'
            AND owner.status='active' AND owner.verified_at IS NOT NULL`,
          [packet.account_id, digest(token)])).rows[0];
        if (!identity || identity.worker_id !== packet.worker_id)
          fail(401, 'Invalid monitoring worker credentials');
        if (identity.broker !== packet.broker || identity.server_name !== packet.server ||
            identity.login !== packet.login || identity.environment !== packet.environment ||
            !packet.demo_mode) {
          // A real account or a wrong MT5 login must not appear as connected.
          await store.query(`UPDATE nabd_mt5_monitor_workers SET last_seen_at=?, mt5_online=0
            WHERE account_id=? AND token_hash=?`, [clock(), identity.account_id, digest(token)]);
          fail(409, 'MT5 Demo identity does not match the registered account');
        }
        await store.query(`UPDATE nabd_mt5_monitor_workers SET last_seen_at=?, mt5_online=?
          WHERE account_id=? AND token_hash=?`,
          [clock(), packet.terminal_connected ? 1 : 0, identity.account_id, digest(token)]);
        return result({ok:true,monitoringOnly:true,tradeAllowed:false,
          observed:packet.terminal_connected});
      }
      const adminPrincipal = path.startsWith('/api/admin/') ? await authenticated(req, req.method === 'POST', true) : null;
      const b = req.method === 'POST' ? await body(req) : {};
      if (req.method === 'POST' && Buffer.byteLength(JSON.stringify(b)) > (path === '/api/admin/restore' ? 24 * 1024 * 1024 : 16000)) fail(413, 'الطلب أكبر من الحد المسموح.');
      if (path === '/api/auth/register' && req.method === 'POST') {
        const email = emailAddress(b.email), name = clean(b.name, 80), password = passwordInput(b.password);
        if (name.length < 2 || b.acceptPrivacy !== true) fail(400, 'أدخل اسمك ووافق على سياسة الخصوصية.');
        await rate(req, 'register', email);
        const pass = await hashPassword(password); let token;
        await store.transaction(async q => {
          const existing = (await q('SELECT id FROM nabd_users WHERE email=?', [email])).rows[0];
          if (existing) return;
          const id = randomUUID();
          await q('INSERT INTO nabd_users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)', [id, email, name, pass, clock()]);
          token = await issueToken(q, id, 'verify', 86400); await audit(q, id, 'REGISTER', id);
        });
        if (token) await sendMail({email, token, kind: 'verify'});
        return result({ok: true, message: 'إذا كان البريد متاحًا للتسجيل ستصلك رسالة التحقق. وللحساب الموجود استخدم الدخول أو استعادة كلمة المرور.'}, 202);
      }
      if (['/api/auth/resend', '/api/auth/forgot'].includes(path) && req.method === 'POST') {
        const email = emailAddress(b.email), kind = path.endsWith('forgot') ? 'reset' : 'verify'; await rate(req, kind, email);
        const u = (await store.query("SELECT * FROM nabd_users WHERE email=? AND status='active'", [email])).rows[0];
        if (u && (kind === 'reset' ? u.verified_at : !u.verified_at)) {
          const token = await store.transaction(q => issueToken(q, u.id, kind, kind === 'reset' ? 1800 : 86400));
          await sendMail({email, kind, token});
        }
        return result({ok: true, message: 'إذا كان البريد مؤهلًا ستصلك رسالة تحتوي على الخطوة التالية.'}, 202);
      }
      if (path === '/api/auth/verify' && req.method === 'POST') {
        await rate(req, 'verify');
        const pass = await hashPassword(passwordInput(b.password));
        await store.transaction(async q => {
          const token = (await q("SELECT * FROM nabd_tokens WHERE hash=? AND purpose='verify' AND expires_at>?", [digest(b.token), clock()])).rows[0];
          if (!token) fail(400, 'رابط التحقق غير صالح أو انتهت صلاحيته.');
          const u = (await q("SELECT * FROM nabd_users WHERE id=? AND status='active'", [token.user_id])).rows[0];
          if (!u) fail(400, 'الحساب غير متاح.');
          let role = u.role;
          if (u.email === owner && !(await q("SELECT id FROM nabd_users WHERE role='admin' LIMIT 1")).rows.length) {
            const claimed = await q("INSERT INTO nabd_auth_settings(key,value) VALUES('owner_bootstrap',?) ON CONFLICT(key) DO NOTHING RETURNING key", [u.id]);
            if (claimed.rows.length) role = 'admin';
          }
          await q('UPDATE nabd_users SET verified_at=?,role=?,password_hash=? WHERE id=?', [clock(), role, pass, u.id]);
          await q('DELETE FROM nabd_tokens WHERE hash=?', [token.hash]); await audit(q, u.id, 'EMAIL_VERIFIED', u.id);
        });
        return result({ok: true, message: 'تم تأكيد البريد. يمكنك تسجيل الدخول الآن.'});
      }
      if (path === '/api/auth/reset' && req.method === 'POST') {
        await rate(req, 'reset-use'); const pass = await hashPassword(passwordInput(b.password));
        await store.transaction(async q => {
          const token = (await q("SELECT * FROM nabd_tokens WHERE hash=? AND purpose='reset' AND expires_at>?", [digest(b.token), clock()])).rows[0];
          if (!token) fail(400, 'رابط الاستعادة غير صالح أو انتهت صلاحيته.');
          await q('UPDATE nabd_users SET password_hash=? WHERE id=?', [pass, token.user_id]);
          await q('DELETE FROM nabd_tokens WHERE user_id=? AND purpose<>?', [token.user_id, 'recovery']);
          await q('DELETE FROM nabd_sessions WHERE user_id=?', [token.user_id]); await audit(q, token.user_id, 'PASSWORD_RESET', token.user_id);
        });
        return result({ok: true, message: 'تم تغيير كلمة المرور وإنهاء الجلسات السابقة. التحقق بخطوتين يبقى مطلوبًا للحساب المحمي.'}, 200, {'Set-Cookie': clearCookies()});
      }
      if (path === '/api/auth/login' && req.method === 'POST') {
        const email = emailAddress(b.email); await rate(req, 'login', email);
        const u = (await store.query('SELECT * FROM nabd_users WHERE email=?', [email])).rows[0];
        const pass = typeof b.password === 'string' && b.password.length <= 128 ? b.password : '';
        if (!await checkPassword(pass, u?.password_hash) || !u || u.status !== 'active' || !u.verified_at) fail(401, 'بيانات الدخول غير صحيحة، أو البريد غير مؤكد، أو الحساب غير متاح.');
        if (u.totp_secret) {
          const token = await store.transaction(q => issueToken(q, u.id, 'mfa-login', 300));
          return result({mfaRequired: true}, 200, {'Set-Cookie': cookie('nabd_challenge', token, 300)});
        }
        const response = await store.transaction(async q => {
          const fresh = (await q("SELECT * FROM nabd_users WHERE id=? AND status='active'", [u.id])).rows[0];
          if (!fresh || fresh.password_hash !== u.password_hash || fresh.totp_secret) fail(401, 'تغيرت بيانات الحساب؛ أعد الدخول.');
          return newSession(q, fresh, req);
        });
        mailer({email, kind: 'login'}).catch(() => {}); return response;
      }
      if (path === '/api/auth/mfa-login' && req.method === 'POST') {
        await rate(req, 'mfa-login');
        const response = await store.transaction(async q => {
          const challenge = cookieValue(req, 'nabd_challenge');
          const token = (await q("SELECT * FROM nabd_tokens WHERE hash=? AND purpose='mfa-login' AND expires_at>?", [digest(challenge), clock()])).rows[0];
          if (!token) fail(401, 'انتهت جلسة التحقق؛ أعد تسجيل الدخول.');
          const u = (await q("SELECT * FROM nabd_users WHERE id=? AND status='active'", [token.user_id])).rows[0];
          if (!u?.totp_secret || !await secondFactor(q, u, clean(b.code, 32))) fail(401, 'رمز التحقق غير صحيح أو استُخدم سابقًا.');
          await q('DELETE FROM nabd_tokens WHERE hash=?', [token.hash]); return newSession(q, u, req, true);
        });
        mailer({email: response.data.user.email, kind: 'login'}).catch(() => {}); return response;
      }
      if (path === '/api/auth/me' && req.method === 'GET') {
        const u = await session(req); if (!u) return result({user: null});
        await store.query('UPDATE nabd_sessions SET seen_at=? WHERE hash=?', [clock(), u.session_hash]);
        return result({user: userView(u), csrf: u.csrf, adminReady: u.role === 'admin' && Boolean(u.totp_secret && u.session_mfa)});
      }
      const u = adminPrincipal || await authenticated(req, req.method === 'POST');
      if (path === '/api/auth/logout' && req.method === 'POST') {
        await store.query('DELETE FROM nabd_sessions WHERE hash=?', [u.session_hash]); return result({ok: true}, 200, {'Set-Cookie': clearCookies()});
      }
      // Phase 1: member-scoped, read-only MT5 account registration. Not an active MT5 link.
      // Never accept or store brokerage passwords or investor passwords here.
      if (path === '/api/auth/mt5-accounts' && req.method === 'GET') {
        const rows = (await store.query(`SELECT a.id,a.broker,a.server_name,a.login,a.environment,a.status,a.created_at,
          COALESCE(h.status,'NOT_REQUESTED') AS hosting_status,h.requested_at,h.reviewed_at,
          w.worker_id,w.last_seen_at,w.mt5_online
          FROM nabd_member_mt5_accounts a
          LEFT JOIN nabd_mt5_hosting_requests h ON h.account_id=a.id
          LEFT JOIN nabd_mt5_monitor_workers w ON w.account_id=a.id
          WHERE a.user_id=? ORDER BY a.created_at DESC`, [u.id])).rows;
        const accounts=rows.map(({worker_id,mt5_online,...a}) => ({
          ...a,monitoring_status:a.hosting_status === 'APPROVED'
            ? monitorStatus({worker_id,mt5_online,last_seen_at:a.last_seen_at},clock()) : 'NOT_APPROVED'
        }));
        return result({accounts, tradingEnabled: false, connectionEnabled: false, phase: 'READ_ONLY_MONITORING'});
      }
      if (path === '/api/auth/mt5-accounts' && req.method === 'POST') {
        if (!b || typeof b !== 'object' || Array.isArray(b) ||
            Object.keys(b).some(name => !['broker','server','login','environment','acknowledge'].includes(name)))
          fail(400, 'أدخل معلومات الحساب فقط، بدون كلمات مرور أو بيانات إضافية.');
        if (b.broker !== 'JustMarkets' || b.environment !== 'demo' ||
            typeof b.server !== 'string' || !/^JustMarkets-Demo[0-9]{0,5}$/.test(b.server) ||
            typeof b.login !== 'string' || !/^[1-9][0-9]{3,15}$/.test(b.login) ||
            b.acknowledge !== true)
          fail(400, 'هذه المرحلة تقبل رقم حساب JustMarkets Demo وسيرفره فقط، مع تأكيد أن التسجيل لا يفعّل التداول.');
        let id;
        await store.transaction(async q => {
          const existing = (await q('SELECT id FROM nabd_member_mt5_accounts WHERE user_id=? LIMIT 1', [u.id])).rows;
          if (existing.length) fail(409, 'يمكن تسجيل حساب Demo واحد حاليًا. احذف طلبك السابق أولًا.');
          const occupied = (await q('SELECT id FROM nabd_member_mt5_accounts WHERE broker=? AND server_name=? AND login=? LIMIT 1',
            [b.broker, b.server, b.login])).rows;
          if (occupied.length) fail(409, 'الحساب غير متاح للتسجيل حاليًا.');
          id = randomUUID();
          await q(`INSERT INTO nabd_member_mt5_accounts
            (id,user_id,broker,server_name,login,environment,status,created_at)
            VALUES(?,?,?,?,?,?,'PENDING_SETUP',?)`,
            [id, u.id, b.broker, b.server, b.login, 'demo', clock()]);
          await audit(q, u.id, 'MT5_REGISTRATION_CREATED', id);
        });
        return result({ok: true, id, status: 'PENDING_SETUP', connectionEnabled: false, tradingEnabled: false,
          message: 'تم تسجيل بيانات حساب Demo فقط. الربط والتداول غير مفعّلين بعد.'}, 201);
      }
      if (path === '/api/auth/mt5-accounts/remove' && req.method === 'POST') {
        if (!b || typeof b.id !== 'string' || !/^[a-f0-9-]{36}$/.test(b.id)) fail(400, 'معرّف الحساب غير صالح.');
        await store.transaction(async q => {
          const removed = await q('DELETE FROM nabd_member_mt5_accounts WHERE id=? AND user_id=? RETURNING id', [b.id, u.id]);
          if (!removed.rows.length) fail(404, 'الحساب غير موجود ضمن حساباتك.');
          await audit(q, u.id, 'MT5_REGISTRATION_REMOVED', b.id);
        });
        return result({ok: true});
      }
      // Phase 2a: opt-in request for centralized MT5 hosting, NOT MT5 credential
      // collection or automatic execution. The worker is not provisioned here.
      if (path === '/api/auth/mt5-hosting/request' && req.method === 'POST') {
        if (!b || typeof b !== 'object' || Array.isArray(b) ||
            Object.keys(b).some(name => !['id','consent'].includes(name)) ||
            typeof b.id !== 'string' || !/^[a-f0-9-]{36}$/.test(b.id) || b.consent !== true)
          fail(400, 'أكّد طلب الاستضافة التجريبية للحساب الذي تملكه.');
        let outcome;
        await store.transaction(async q => {
          const owned = (await q(`SELECT id FROM nabd_member_mt5_accounts
            WHERE id=? AND user_id=? AND broker='JustMarkets' AND environment='demo'`, [b.id, u.id])).rows;
          if (!owned.length) fail(404, 'حساب Demo غير موجود ضمن حساباتك.');
          const existing = (await q('SELECT status FROM nabd_mt5_hosting_requests WHERE account_id=?', [b.id])).rows[0];
          if (existing && existing.status !== 'REJECTED')
            fail(409, 'طلب الاستضافة مسجّل بالفعل أو تمت الموافقة على تجهيزه.');
          if (existing) {
            await q(`UPDATE nabd_mt5_hosting_requests SET status='REQUESTED',requested_at=?,reviewed_at=NULL,reviewed_by=NULL
              WHERE account_id=? AND status='REJECTED'`, [clock(), b.id]);
          } else {
            await q(`INSERT INTO nabd_mt5_hosting_requests(account_id,status,requested_at)
              VALUES(?,'REQUESTED',?)`, [b.id, clock()]);
          }
          await audit(q,u.id,'MT5_HOSTING_REQUESTED',b.id);
          outcome = {ok:true,status:'REQUESTED',tradingEnabled:false,connectionEnabled:false,
            message:'وصل طلب الاستضافة للإدارة. الربط والتداول غير مفعّلين.'};
        });
        return result(outcome, 202);
      }
      if (path === '/api/auth/alerts' && req.method === 'GET') {
        return result(await subscriberBot().state(u.id));
      }
      if (path === '/api/auth/alerts' && req.method === 'POST') {
        const preferences=await subscriberBot().updatePreferences(u.id,b);
        await audit(store.query,u.id,'ALERT_PREFERENCES_UPDATED',u.id);
        return result({preferences});
      }
      if (path === '/api/auth/telegram/link' && req.method === 'POST') {
        await rate(req,'telegram-link',u.email);
        const response=await subscriberBot().startLink(u.id);
        await audit(store.query,u.id,'TELEGRAM_LINK_STARTED',u.id);
        return result(response);
      }
      if (path === '/api/auth/telegram/test' && req.method === 'POST') {
        const response=await subscriberBot().sendTest(u.id);
        await audit(store.query,u.id,'TELEGRAM_TEST_SENT',u.id);
        return result(response);
      }
      if (path === '/api/auth/telegram/unlink' && req.method === 'POST') {
        const response=await subscriberBot().unlink(u.id);
        await audit(store.query,u.id,'TELEGRAM_UNLINKED',u.id);
        return result(response);
      }
      if (path === '/api/auth/profile' && req.method === 'POST') {
        const name = clean(b.name, 80); if (name.length < 2 || typeof b.notifications !== 'boolean') fail(400, 'بيانات الملف غير صالحة.');
        await store.query('UPDATE nabd_users SET name=?,notifications=? WHERE id=?', [name, b.notifications ? 1 : 0, u.id]);
        return result({ok: true});
      }
      if (path === '/api/auth/password' && req.method === 'POST') {
        await rate(req, 'password', u.email); await freshPassword(u, b.currentPassword); const pass = await hashPassword(passwordInput(b.password));
        await store.transaction(async q => {await q('UPDATE nabd_users SET password_hash=? WHERE id=?', [pass, u.id]);
          await q('DELETE FROM nabd_sessions WHERE user_id=?', [u.id]); await q("DELETE FROM nabd_tokens WHERE user_id=? AND purpose<>'recovery'", [u.id]); await audit(q, u.id, 'PASSWORD_CHANGED', u.id);});
        return result({ok: true}, 200, {'Set-Cookie': clearCookies()});
      }
      if (path === '/api/auth/sessions' && req.method === 'GET') return result({sessions: (await store.query('SELECT id,created_at,seen_at,expires_at,agent FROM nabd_sessions WHERE user_id=? AND expires_at>? ORDER BY created_at DESC', [u.id, clock()])).rows.map(s => ({...s, current: s.id === u.session_id}))});
      if (path === '/api/auth/sessions/revoke' && req.method === 'POST') {
        if (b.all === true) {await store.query('DELETE FROM nabd_sessions WHERE user_id=?', [u.id]); return result({ok: true}, 200, {'Set-Cookie': clearCookies()});}
        await store.query('DELETE FROM nabd_sessions WHERE id=? AND user_id=?', [clean(b.id, 50), u.id]); return result({ok: true});
      }
      if (path === '/api/auth/mfa/start' && req.method === 'POST') {
        await rate(req, 'mfa-start', u.email); await freshPassword(u, b.password);
        if (u.totp_secret) fail(409, 'التحقق بخطوتين مفعّل بالفعل.');
        const secret = newTotpSecret(); await store.query('UPDATE nabd_users SET totp_pending=?,pending_until=? WHERE id=?', [encrypt(secret, key), clock() + 600, u.id]);
        return result({secret, issuer: 'NABD', account: u.email, expires_in: 600});
      }
      if (path === '/api/auth/mfa/confirm' && req.method === 'POST') {
        await rate(req, 'mfa-confirm', u.email);
        let codes;
        await store.transaction(async q => {
          const current = (await q('SELECT * FROM nabd_users WHERE id=?', [u.id])).rows[0];
          if (!current.totp_pending || current.totp_secret || current.pending_until < clock()) fail(400, 'ابدأ إعداد التحقق بخطوتين من جديد.');
          const step = totpStep(decrypt(current.totp_pending, key), clean(b.code, 10), clock());
          if (step === null) fail(400, 'رمز التحقق غير صحيح.');
          await q('UPDATE nabd_users SET totp_secret=totp_pending,totp_pending=NULL,pending_until=NULL,totp_last_step=? WHERE id=?', [step, u.id]);
          await q('DELETE FROM nabd_sessions WHERE user_id=? AND hash<>?', [u.id, u.session_hash]);
          await q('UPDATE nabd_sessions SET mfa=1 WHERE hash=?', [u.session_hash]);
          codes = Array.from({length: 8}, () => randomBytes(12).toString('hex'));
          for (const code of codes) await q('INSERT INTO nabd_tokens(hash,user_id,purpose,expires_at) VALUES(?,?,?,?)', [digest(code), u.id, 'recovery', clock() + 315360000]);
          await audit(q, u.id, 'MFA_ENABLED', u.id);
        }); return result({ok: true, recoveryCodes: codes});
      }
      if (path === '/api/auth/delete-request' && req.method === 'POST') {
        await rate(req, 'delete', u.email); await freshPassword(u, b.password);
        if (u.role === 'admin') fail(409, 'حساب مالك الموقع لا يمكن تعطيله من طلب حذف ذاتي.');
        await store.transaction(async q => {await q("UPDATE nabd_users SET status='deletion_requested' WHERE id=?", [u.id]);
          await q('DELETE FROM nabd_sessions WHERE user_id=?', [u.id]); await audit(q, u.id, 'DELETION_REQUESTED', u.id);});
        return result({ok: true}, 200, {'Set-Cookie': clearCookies()});
      }
      if (path === '/api/admin/overview' && req.method === 'GET') return result({accounts: status(),
        counts: (await store.query('SELECT status,COUNT(*) AS count FROM nabd_users GROUP BY status')).rows, operational: operationalStatus()});
      if (path === '/api/admin/users' && req.method === 'GET') {
        const search = clean(url.searchParams.get('search') || '', 100), state = url.searchParams.get('status') || 'all';
        const where = ['1=1'], values = [];
        if (search) {where.push('(LOWER(email) LIKE ? OR LOWER(name) LIKE ?)'); values.push('%' + search.toLowerCase() + '%', '%' + search.toLowerCase() + '%');}
        if (['active', 'disabled', 'deletion_requested'].includes(state)) {where.push('status=?'); values.push(state);}
        const page = Math.max(0, Math.min(10000, Math.floor(Number(url.searchParams.get('page')) || 0)));
        return result({users: (await store.query(`SELECT * FROM nabd_users WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 50 OFFSET ?`, [...values, page * 50])).rows.map(userView), page});
      }
      if (path === '/api/admin/users/update' && req.method === 'POST') {
        if (!['active', 'disabled', 'deletion_requested'].includes(b.status) || typeof b.recommendations !== 'boolean') fail(400, 'إعدادات غير صالحة.');
        await store.transaction(async q => {
          const target = (await q('SELECT * FROM nabd_users WHERE id=?', [clean(b.id, 50)])).rows[0];
          if (!target) fail(404, 'المستخدم غير موجود.');
          if (target.role === 'admin') fail(403, 'لا يمكن تغيير حساب المسؤول من إدارة المستخدمين.');
          await q('UPDATE nabd_users SET status=?,recommendations=? WHERE id=?', [b.status, b.recommendations ? 1 : 0, target.id]);
          if (b.status !== 'active' || !b.recommendations) await q('DELETE FROM nabd_sessions WHERE user_id=?', [target.id]);
          await audit(q, u.id, 'USER_UPDATED', target.id);
        }); return result({ok: true});
      }
      if (path === '/api/admin/users/reset' && req.method === 'POST') {
        await rate(req, 'admin-reset', u.email);
        const target = (await store.query("SELECT * FROM nabd_users WHERE id=? AND status='active'", [clean(b.id, 50)])).rows[0];
        if (!target?.verified_at || target.role === 'admin') fail(400, 'الحساب غير مؤهل لهذا الإجراء.');
        const token = await store.transaction(q => issueToken(q, target.id, 'reset', 1800));
        await sendMail({email: target.email, kind: 'reset', token}); await audit(store.query, u.id, 'RESET_SENT', target.id); return result();
      }
      // Admin MFA required by the /api/admin/ path guard. Review only; never provision
      // brokerage credentials or set the member account as connected.
      if (path === '/api/admin/mt5-hosting' && req.method === 'GET') {
        const rows = (await store.query(`SELECT h.account_id,h.status,h.requested_at,h.reviewed_at,
          a.broker,a.server_name,a.login,a.environment,a.user_id,u.name AS member_name,u.email AS member_email,
          w.worker_id,w.issued_at,w.last_seen_at,w.mt5_online
          FROM nabd_mt5_hosting_requests h
          JOIN nabd_member_mt5_accounts a ON a.id=h.account_id
          JOIN nabd_users u ON u.id=a.user_id
          LEFT JOIN nabd_mt5_monitor_workers w ON w.account_id=a.id
          ORDER BY h.requested_at DESC LIMIT 100`)).rows;
        const accounts=rows.map(({worker_id,mt5_online,...a}) => ({
          ...a,worker_provisioned:Boolean(worker_id),
          monitoring_status:a.status === 'APPROVED'
            ? monitorStatus({worker_id,mt5_online,last_seen_at:a.last_seen_at},clock()) : 'NOT_APPROVED'
        }));
        return result({accounts,workerConnected:false,tradingEnabled:false,phase:'READ_ONLY_MONITORING'});
      }
      if (path === '/api/admin/mt5-monitor/provision' && req.method === 'POST') {
        if (!b || typeof b !== 'object' || Array.isArray(b) ||
            Object.keys(b).some(name => !['id','confirm'].includes(name)) ||
            typeof b.id !== 'string' || !/^[a-f0-9-]{36}$/.test(b.id) ||
            b.confirm !== 'ISSUE_READONLY_TOKEN')
          fail(400, 'Confirm read-only Windows worker enrollment.');
        const token = opaque(), workerId = randomUUID();
        await store.transaction(async q => {
          const ready = (await q(`SELECT a.id FROM nabd_member_mt5_accounts a
            JOIN nabd_mt5_hosting_requests h ON h.account_id=a.id
            JOIN nabd_users owner ON owner.id=a.user_id
            WHERE a.id=? AND h.status='APPROVED' AND owner.status='active'
            AND owner.verified_at IS NOT NULL AND a.environment='demo'`, [b.id])).rows[0];
          if (!ready) fail(409, 'Approved, active Demo hosting request required.');
          await q(`INSERT INTO nabd_mt5_monitor_workers
            (account_id,token_hash,worker_id,issued_at,last_seen_at,mt5_online)
            VALUES(?,?,?,?,NULL,0)
            ON CONFLICT(account_id) DO UPDATE SET token_hash=excluded.token_hash,
              worker_id=excluded.worker_id,issued_at=excluded.issued_at,last_seen_at=NULL,mt5_online=0`,
            [b.id,digest(token),workerId,clock()]);
          await audit(q,u.id,'MT5_MONITOR_TOKEN_ROTATED',b.id);
        });
        // This token is emitted ONCE to the MFA-protected administrator.
        // Store it only on the Windows worker; never save to Render env, logs or browser storage.
        return result({ok:true,account_id:b.id,worker_id:workerId,token,
          monitoringOnly:true,tradeAllowed:false,expires:'until_revoked_or_rotated'});
      }
      if (path === '/api/admin/mt5-monitor/revoke' && req.method === 'POST') {
        if (!b || typeof b !== 'object' || Array.isArray(b) ||
            Object.keys(b).some(name => !['id'].includes(name)) ||
            typeof b.id !== 'string' || !/^[a-f0-9-]{36}$/.test(b.id))
          fail(400, 'Invalid monitoring account');
        await store.transaction(async q => {
          const deleted = (await q('DELETE FROM nabd_mt5_monitor_workers WHERE account_id=? RETURNING account_id', [b.id])).rows;
          if (!deleted.length) fail(404, 'No monitoring worker for this account.');
          await audit(q,u.id,'MT5_MONITOR_REVOKED',b.id);
        });
        return result({ok:true,monitoringOnly:true,tradeAllowed:false});
      }
      if (path === '/api/admin/mt5-hosting/review' && req.method === 'POST') {
        if (!b || typeof b !== 'object' || Array.isArray(b) ||
            Object.keys(b).some(name => !['id','decision'].includes(name)) ||
            typeof b.id !== 'string' || !/^[a-f0-9-]{36}$/.test(b.id) ||
            !['APPROVE','REJECT'].includes(b.decision))
          fail(400, 'اختر حسابًا وقرار مراجعة صالحًا.');
        const statusValue = b.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
        await store.transaction(async q => {
          const changed = (await q(`UPDATE nabd_mt5_hosting_requests
            SET status=?,reviewed_at=?,reviewed_by=? WHERE account_id=? AND status='REQUESTED'
            AND EXISTS(SELECT 1 FROM nabd_member_mt5_accounts a
              JOIN nabd_users owner ON owner.id=a.user_id
              WHERE a.id=nabd_mt5_hosting_requests.account_id AND owner.status='active'
                AND owner.verified_at IS NOT NULL)
            RETURNING account_id`, [statusValue, clock(), u.id, b.id])).rows;
          if (!changed.length) fail(409, 'الطلب غير متاح للمراجعة أو سبق البت فيه.');
          if (statusValue === 'REJECTED')
            await q('DELETE FROM nabd_mt5_monitor_workers WHERE account_id=?',[b.id]);
          await audit(q,u.id,'MT5_HOSTING_'+statusValue,b.id);
        });
        return result({ok:true,status:statusValue,workerConnected:false,tradingEnabled:false});
      }
      if (path === '/api/admin/audit' && req.method === 'GET') return result({events: (await store.query('SELECT * FROM nabd_auth_audit ORDER BY time DESC LIMIT 100')).rows});
      if (path === '/api/admin/backup' && req.method === 'POST') {await runBackup(); await audit(store.query, u.id, 'BACKUP_CREATED'); return result({ok: true, last_success: lastBackup});}
      if (path === '/api/admin/backup/download' && req.method === 'POST') {
        await freshPassword(u, b.password); const encrypted = await exportAuthBackup(store, backup.key, clock);
        await audit(store.query, u.id, 'BACKUP_EXPORTED'); return result({backup: encrypted, filename: `nabd-accounts-${Math.floor(clock())}.enc`});
      }
      if (path === '/api/admin/restore' && req.method === 'POST') {
        await rate(req, 'restore', u.email); await freshPassword(u, b.password);
        if (b.confirm !== 'RESTORE' || !backup.key || typeof b.backup !== 'string') fail(400, 'تأكيد الاستعادة والنسخة المشفرة مطلوبان.');
        let data; try {data = readAuthBackup(b.backup, backup.key);} catch {fail(400, 'النسخة غير صالحة أو المفتاح غير مطابق.');}
        const ownerRow = data.tables.nabd_users.find(row => row.id === u.id && row.email === u.email && row.role === 'admin' && row.status === 'active' && row.totp_secret);
        if (!ownerRow) fail(409, 'النسخة لا تحتوي على حساب المسؤول الحالي المحمي.');
        if (!await store.transaction(q => secondFactor(q, u, clean(b.code, 32)))) fail(401, 'رمز تحقق جديد مطلوب للاستعادة.');
        await runBackup(); // A confirmed external safety copy is required before replacing identities.
        await store.transaction(async q => {
          await q('DELETE FROM nabd_sessions'); await q('DELETE FROM nabd_tokens');
          for (const table of [...backupTables].reverse()) await q(`DELETE FROM ${table}`);
          const allowed = {
            nabd_users: ['id','email','name','password_hash','role','status','verified_at','created_at','last_login','notifications','recommendations','totp_secret','totp_pending','pending_until','totp_last_step'],
            nabd_auth_audit: ['id','time','actor','event','subject'], nabd_auth_settings: ['key','value'],
            nabd_member_mt5_accounts: ['id','user_id','broker','server_name','login','environment','status','created_at'],
            nabd_mt5_hosting_requests: ['account_id','status','requested_at','reviewed_at','reviewed_by'],
            nabd_member_alert_preferences: ['user_id','gold_enabled','btc_enabled','signals_enabled','execution_enabled','system_enabled','updated_at'],
            nabd_member_telegram: ['user_id','chat_id','linked_at','last_test_at']};
          for (const table of backupTables) for (const row of data.tables[table]) {
            const columns = allowed[table];
            await q(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`, columns.map(name => row[name] ?? null));
          }
          await q('UPDATE nabd_users SET totp_last_step=? WHERE id=?', [Math.floor(clock() / 30), u.id]);
          await audit(q, u.id, 'BACKUP_RESTORED');
        }); return result({ok: true}, 200, {'Set-Cookie': clearCookies()});
      }
      return result({error: 'Not found'}, 404);
    } catch (error) {
      if (!error.status) onError(error);
      return result({error: error.status ? error.message : 'تعذّر إكمال الطلب؛ حاول مجددًا بعد قليل.'}, error.status || 503);
    }
  }
  return {ready, status, handle, session, publishSubscriberSignal, async canReadSignals(req) {try {const u = await session(req); return Boolean(u?.recommendations);} catch {return false;}},
    async close() {closed = true; clearInterval(timer); await ready; if (store) await store.close();}};
}
