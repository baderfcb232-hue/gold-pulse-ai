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
    'توصية تحليلية وليست ضمان ربح.', 'https://gold-pulse-ai.onrender.com/'].join('\n');
}

export function createTelegramPublisher({db, signals, enabled = false, clock = () => Date.now() / 1000,
  token = process.env.TELEGRAM_BOT_TOKEN || '', chatId = process.env.TELEGRAM_CHAT_ID || '', fetcher = fetch}) {
  db.exec(`CREATE TABLE IF NOT EXISTS telegram_delivery
    (id TEXT PRIMARY KEY, state TEXT NOT NULL, updated_at REAL NOT NULL);`);
  const started = clock();
  let busy = false, stopped = false, pending = Promise.resolve(), lastError = null;
  const configured = Boolean(token && chatId);
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
      verification = {state: 'READY', checkedAt: clock(), botUsername: me.username, canPost: true};
      lastError = null;
      return true;
    } catch {
      verification = {...verification, state: 'FAILED', canPost: false};
      lastError = 'Telegram bot or channel posting permission could not be verified.';
      return false;
    }
  }
  async function publish() {
    if (!enabled || !configured || busy || stopped) return;
    busy = true;
    try {
      if (!await verifyConfiguration() || stopped) return;
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
    deliveries: db.prepare('SELECT state,COUNT(*) AS count FROM telegram_delivery GROUP BY state').all()}),
    async close() {stopped = true; clearInterval(timer); await pending;}, publish};
}
