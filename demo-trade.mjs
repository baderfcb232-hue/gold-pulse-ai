// Broker-bound, short-lived execution approval. Never authorize on a reference feed.
// This module does not submit orders; MT5 independently checks every prerequisite.
export function demoTradeDecision({enabled = false, snapshot: s, publication, now}) {
  const reject = reason => ({ready: false, reason, plan: null});
  if (!enabled) return reject('DISABLED');
  if (!s || !s.account || !s.execution) return reject('ACCOUNT_NOT_SHARED');
  if (s.execution.demo !== true || !/just.?markets/i.test(s.broker || '')) return reject('NOT_JUSTMARKETS_DEMO');
  if (!s.terminal_connected || !s.execution.main_connected || !s.execution.enabled ||
      !s.execution.remote_control || s.execution.paused || s.ea?.emergency_stop)
    return reject('MT5_EXECUTION_NOT_READY');
  if (!Number.isFinite(s.received_at) || !Number.isFinite(s.quote_at) ||
      now - s.received_at > 5 || now - s.quote_at > 10 ||
      !Number.isFinite(s.ea?.heartbeat_at) || now - s.ea.heartbeat_at > 5)
    return reject('STALE_MT5');
  if (!publication?.ready || !publication.plan) return reject('PLAN_NOT_APPROVED');
  const p = publication.plan, entry = p.entry, sl = p.sl, tp = p.tp1 ?? p.tp2;
  if (!p.id || p.broker_symbol !== s.symbol || !['BUY', 'SELL'].includes(p.side) ||
      !Number.isFinite(p.issued_at) || !Number.isFinite(p.expires_at) ||
      p.issued_at > now + 5 || now - p.issued_at > 75 || p.expires_at <= now ||
      ![entry, sl, tp].every(x => Number.isFinite(x) && x > 0) ||
      (p.side === 'BUY' ? !(sl < entry && entry < tp) : !(tp < entry && entry < sl)))
    return reject('INVALID_PLAN');
  const risk = Math.abs(entry - sl), quote = p.side === 'BUY' ? s.ask : s.bid;
  if (Math.abs(quote - entry) > risk * 0.15 ||
      (s.ask - s.bid) / s.spec.point > Math.min(80, s.ea?.settings?.max_spread_points || 80))
    return reject('PRICE_OR_SPREAD_MOVED');
  return {ready: true, reason: 'READY', plan: {side: p.side, entry, sl, tp, 
    issued_at: p.issued_at, expires_at: Math.min(p.expires_at, now + 15), bar_time: p.bar_time}};
}
