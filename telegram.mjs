export function formatSignal(p) {
  const price = v => v != null && Number.isFinite(Number(v)) ? String(v) : '—';
  const time = v => Number.isFinite(v) && v > 0 ? new Date(v * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : '—';
  return ['نبض | توصية جديدة', `${p.symbol} — ${p.side === 'BUY' ? 'شراء' : 'بيع'}`,
    `الدخول: ${price(p.entry)}`, `وقف الخسارة: ${price(p.sl)}`,
    `الهدف الأول: ${price(p.tp1)}`, `الهدف الثاني: ${price(p.tp2)}`,
    `الفريم: ${p.timeframe || p.tf || 'حسب استراتيجية الموقع'}`,
    `المصدر: ${p.source || p.source_id || 'REFERENCE'}`,
    `صدرت: ${time(p.issued_at)}`, `تنتهي: ${time(p.expires_at)}`,
    ...(p.broker_symbol ? ['استخدم أسعار الرمز نفسه لدى الوسيط؛ قد تختلف أسعار المنصات الأخرى.'] : []),
    ...(p.costMeaning === 'NOT_VERIFIED' ? ['الأهداف قبل التكاليف؛ لم تُتحقق تكاليف الوسيط لهذه الرسالة.'] : []),
    'توصية تحليلية وليست ضمان ربح.', 'https://gold-pulse-ai.onrender.com/'].join('\n');
}

export function createTelegramPublisher({db, signals, enabled = false, clock = () => Date.now() / 1000,
  health = () => [], token = process.env.TELEGRAM_BOT_TOKEN || '', chatId = process.env.TELEGRAM_CHAT_ID || '', fetcher = fetch,
  testId = process.env.TELEGRAM_TEST_ID || '', testText = process.env.TELEGRAM_TEST_TEXT || '',
  testChannel = process.env.TELEGRAM_TEST_CHANNEL || ''}) {
  db.exec(`CREATE TABLE IF NOT EXISTS telegram_delivery
    (id TEXT PRIMARY KEY, state TEXT NOT NULL, updated_at REAL NOT NULL);`);
  db.exec(`CREATE TABLE IF NOT EXISTS telegram_faults
    (id TEXT PRIMARY KEY, active INTEGER NOT NULL, since REAL NOT NULL, attempted_at REAL, delivery TEXT);`);
  db.exec(`CREATE TABLE IF NOT EXISTS telegram_tests
    (id TEXT PRIMARY KEY, state TEXT NOT NULL, updated_at REAL NOT NULL, message_id INTEGER);`);
  const started = clock();
  let busy = false, stopped = false, pending = Promise.resolve(), lastError = null;
  const configured = Boolean(token && chatId);
  let verifiedChannel = null;
  const testRequested = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(testId) &&
    typeof testText === 'string' && testText.trim().length > 0 && testText.length <= 1000 &&
    /^@[a-zA-Z0-9_]{5,32}$/.test(testChannel);
  let verification = {state: !enabled ? 'PAUSED' : !configured ? 'NOT_CONFIGURED' : 'PENDING', checkedAt: null,
    botUsername: null, canPost: false};
  async function verifyConfiguration() {
    if (!enabled || !configured || stopped) return false;
    if (verification.checkedAt != null && clock() - verification.checkedAt < 300) return verification.canPost;
    verification = {...verification, state: 'CHECKING', checkedAt: clock(), canPost: false};
    try {
      const api = async (method, body = {}) => {
        const response = await fetcher(`https://api.telegram.org/bot${token}/${method}`, {
          method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
          signal: AbortSignal.timeout(10000)});
        const data = await response.json();
        if (!response.ok || data.ok !== true) throw Error('CONFIGURATION_REJECTED');
        return data.result;
      };
      const me = await api('getMe');
      if (!Number.isSafeInteger(me?.id) || me.is_bot !== true || !me.username) throw Error('INVALID_BOT');
      const chat = await api('getChat', {chat_id: chatId});
      if (chat?.type !== 'channel' || (chatId.startsWith('@') &&
        String(chat.username).toLowerCase() !== chatId.slice(1).toLowerCase())) throw Error('INVALID_CHANNEL');
      const member = await api('getChatMember', {chat_id: chatId, user_id: me.id});
      if (member?.user?.id !== me.id || !(member.status === 'creator' ||
        member.status === 'administrator' && member.can_post_messages === true)) throw Error('POST_PERMISSION_MISSING');
      verifiedChannel = chat.username ? '@' + String(chat.username).toLowerCase() : null;
      verification = {state: 'READY', checkedAt: clock(), botUsername: me.username, canPost: true};
      lastError = null;
      return true;
    } catch {
      verifiedChannel = null;
      verification = {...verification, state: 'FAILED', canPost: false};
      lastError = 'Telegram bot or channel posting permission could not be verified.';
      return false;
    }
  }
  async function publishTest() {
    if (!testRequested || stopped) return;
    // A diagnostic is separate from trading signals and requires an exact public-channel match.
    if (verifiedChannel !== testChannel.toLowerCase()) {
      db.prepare('INSERT OR IGNORE INTO telegram_tests VALUES(?,?,?,NULL)').run(testId, 'REJECTED_CHANNEL', clock());
      return;
    }
    // Claim before network I/O. Never retry an uncertain outcome or a claimed test after restart.
    const claim = db.prepare('INSERT OR IGNORE INTO telegram_tests VALUES(?,?,?,NULL)').run(testId, 'SENDING', clock());
    if (!claim.changes) return;
    let state = 'UNCERTAIN', messageId = null;
    try {
      const response = await fetcher(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({chat_id: chatId,
          text: 'نبض | رسالة اختبار اتصال\n' + testText.trim() + '\nرسالة تجريبية فقط، ليست توصية تداول.',
          link_preview_options: {is_disabled: true}}), signal: AbortSignal.timeout(10000)});
      const data = await response.json();
      if (response.ok && data.ok === true && Number.isSafeInteger(data.result?.message_id)) {
        state = 'SENT'; messageId = data.result.message_id;
      } else if (!response.ok || data.ok === false) state = 'FAILED';
    } catch {}
    db.prepare('UPDATE telegram_tests SET state=?,updated_at=?,message_id=? WHERE id=?')
      .run(state, clock(), messageId, testId);
  }
  async function publishFaults() {
    // Static text only: never publish account details, tokens or database errors.
    const messages = {
      BRIDGE: ['لم تصل تحديثات جسر MT5 منذ أكثر من دقيقة ونصف. افحص المنصة والاتصال؛ هذا لا يثبت وجود عطل في السوق.', 'عاد وصول تحديثات جسر MT5. جاهزية التوصيات تُفحص بشكل مستقل.'],
      STORAGE: ['تعذر تحديث نسخة استرداد السجل. راجع حالة الحفظ في الموقع.', 'عاد حفظ نسخة استرداد السجل بنجاح.']
    };
    const faults = new Set(health().filter(id => Object.hasOwn(messages, id)));
    for (const id of Object.keys(messages)) {
      let row = db.prepare('SELECT * FROM telegram_faults WHERE id=?').get(id);
      const active = faults.has(id);
      if (!row) {
        db.prepare('INSERT INTO telegram_faults VALUES(?,?,?,?,?)').run(id, Number(active), clock(), null, null);
        continue;
      }
      if (Boolean(row.active) !== active) {
        db.prepare('UPDATE telegram_faults SET active=?,since=?,delivery=NULL WHERE id=?')
          .run(Number(active), clock(), id);
        row = {...row, active: Number(active), since: clock(), recovery: row.delivery === 'SENT'};
        if (!active && !row.recovery) continue;
      } else if (!active) continue;
      // Startup grace, sustained failure and an hour between repeated incidents.
      if (active && (clock()-started < 300 || clock()-row.since < 90 ||
        row.delivery || row.attempted_at != null && clock()-row.attempted_at < 3600)) continue;
      // Claim before network I/O. Unknown outcomes are never blindly retried.
      db.prepare('UPDATE telegram_faults SET attempted_at=?,delivery=? WHERE id=?').run(clock(), 'UNCERTAIN', id);
      let delivery = 'UNCERTAIN';
      try {
        const response = await fetcher(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({chat_id: chatId, text: 'نبض | تنبيه تشغيل\n' + messages[id][active ? 0 : 1],
            link_preview_options: {is_disabled: true}}), signal: AbortSignal.timeout(10000)});
        delivery = response.ok && (await response.json()).ok === true ? 'SENT' : 'FAILED';
      } catch {}
      db.prepare('UPDATE telegram_faults SET delivery=? WHERE id=?').run(delivery, id);
    }
  }
  async function publish() {
    if (!enabled || !configured || busy || stopped) return;
    busy = true;
    try {
      if (!await verifyConfiguration() || stopped) return;
      await publishTest();
      if (stopped) return;
      await publishFaults();
      if (stopped) return;
      for (const p of signals()) {
        if (stopped) break;
        if (!p?.id || p.status !== 'TRACKING' || !Number.isFinite(p.issued_at) ||
          p.issued_at < started || p.issued_at > clock() + 5 || !Number.isFinite(p.expires_at) ||
          !(p.expires_at > clock()) || !['BUY', 'SELL'].includes(p.side)) continue;
        const claim = db.prepare('INSERT OR IGNORE INTO telegram_delivery VALUES(?,?,?)')
          .run(p.id, 'SENDING', clock());
        if (!claim.changes) continue;
        let state = 'UNCERTAIN';
        try {
          const response = await fetcher(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({chat_id: chatId, text: formatSignal(p), link_preview_options: {is_disabled: true}}),
            signal: AbortSignal.timeout(10000)});
          const data = await response.json();
          state = response.ok && data.ok === true ? 'SENT' : 'FAILED';
          lastError = state === 'SENT' ? null : 'Telegram rejected delivery; check bot permissions and configuration.';
        } catch {lastError = 'Telegram delivery could not be confirmed.';}
        db.prepare('UPDATE telegram_delivery SET state=?,updated_at=? WHERE id=?').run(state, clock(), p.id);
      }
    } catch {lastError = 'Signal publishing is temporarily unavailable.';}
    finally {busy = false;}
  }
  const timer = setInterval(() => {if (!busy && !stopped) pending = publish();}, 3000);
  timer.unref();
  return {status: () => ({configured, enabled, mode: !enabled ? 'PAUSED_RESEARCH' : !configured ? 'WAITING_CONFIGURATION'
    : verification.canPost ? 'PUBLISHING' : 'WAITING_VERIFICATION', channel: chatId || null, verification: {...verification}, lastError,
    faultAlerts: db.prepare('SELECT id,active,since,attempted_at,delivery FROM telegram_faults').all(),
    testDelivery: db.prepare('SELECT id,state,updated_at,message_id FROM telegram_tests ORDER BY updated_at DESC LIMIT 1').get() || null,
    deliveries: db.prepare('SELECT state,COUNT(*) AS count FROM telegram_delivery GROUP BY state').all()}),
    async close() {stopped = true; clearInterval(timer); await pending;}, publish};
}
