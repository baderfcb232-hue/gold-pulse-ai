export function formatSignal(p) {
  const price = v => v != null && Number.isFinite(Number(v)) ? String(v) : '—';
  return ['نبض | توصية جديدة', `${p.symbol} — ${p.side === 'BUY' ? 'شراء' : 'بيع'}`,
    `الدخول: ${price(p.entry)}`, `وقف الخسارة: ${price(p.sl)}`,
    `الهدف الأول: ${price(p.tp1)}`, `الهدف الثاني: ${price(p.tp2)}`,
    `الفريم: ${p.timeframe || p.tf || 'حسب استراتيجية الموقع'}`,
    `المصدر: ${p.source || p.source_id || 'REFERENCE'}`,
    'توصية تحليلية وليست ضمان ربح.', 'https://gold-pulse-ai.onrender.com/'].join('\n');
}

export function createTelegramPublisher({db, signals, enabled = false, clock = () => Date.now() / 1000,
  token = process.env.TELEGRAM_BOT_TOKEN || '', chatId = process.env.TELEGRAM_CHAT_ID || '', fetcher = fetch}) {
  db.exec(`CREATE TABLE IF NOT EXISTS telegram_delivery
    (id TEXT PRIMARY KEY, state TEXT NOT NULL, updated_at REAL NOT NULL);`);
  const started = clock();
  let busy = false, stopped = false, pending = Promise.resolve(), lastError = null;
  const configured = Boolean(token && chatId);
  async function publish() {
    if (!enabled || !configured || busy || stopped) return;
    busy = true;
    try {
      for (const p of signals()) {
        if (stopped) break;
        if (!p?.id || p.status !== 'TRACKING' || p.issued_at < started ||
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
  return {status: () => ({configured, enabled, mode: enabled ? 'PUBLISHING' : 'PAUSED_RESEARCH', channel: '@NabdSignalsChannel', lastError,
    deliveries: db.prepare('SELECT state,COUNT(*) AS count FROM telegram_delivery GROUP BY state').all()}),
    async close() {stopped = true; clearInterval(timer); await pending;}, publish};
}
