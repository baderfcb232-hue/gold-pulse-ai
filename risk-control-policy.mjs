// Phase 12: deterministic, fail-closed preflight for a future owner-scoped
// Risk Control Center. Pure policy only: this does NOT authorize or route MT5 orders.
// The server, persisted stop state, and each account's EA must enforce the same
// constraints again immediately before dispatch and before broker submission.
const finite = value => typeof value === 'number' && Number.isFinite(value);
const nonnegative = value => finite(value) && value >= 0;
const positive = value => finite(value) && value > 0;
export const RISK_REASONS = Object.freeze({
  STOPPED: 'STOPPED',
  MISSING_DATA: 'MISSING_DATA',
  INVALID_LIMITS: 'INVALID_LIMITS',
  STALE_PRICE: 'STALE_PRICE',
  SIGNAL_EXPIRED: 'SIGNAL_EXPIRED',
  DAILY_LOSS_LIMIT: 'DAILY_LOSS_LIMIT',
  DAILY_TRADE_LIMIT: 'DAILY_TRADE_LIMIT',
  OPEN_POSITION_LIMIT: 'OPEN_POSITION_LIMIT',
  SPREAD_LIMIT: 'SPREAD_LIMIT',
  SLIPPAGE_LIMIT: 'SLIPPAGE_LIMIT',
  TRADE_RISK_LIMIT: 'TRADE_RISK_LIMIT',
  MARGIN_LIMIT: 'MARGIN_LIMIT'
});
// Input is a server-authoritative, account-and-symbol-scoped snapshot, never a
// browser-supplied assertion. No default limits: incomplete data blocks entry.
export function evaluateRiskPreflight({limits, state, quote, signal, now} = {}) {
  const deny = reason => ({allowNewEntry: false, reason, closeOpenPositions: false});
  if (state?.paused === true || state?.emergencyStop === true) return deny(RISK_REASONS.STOPPED);
  if (!limits || !state || !quote || !signal || !finite(now) ||
      typeof state.paused !== 'boolean' || typeof state.emergencyStop !== 'boolean')
    return deny(RISK_REASONS.MISSING_DATA);
  if (!positive(limits.riskPercent) || limits.riskPercent > 100 ||
      !positive(limits.maxDailyLoss) || !Number.isSafeInteger(limits.maxDailyTrades) || limits.maxDailyTrades < 1 ||
      !Number.isSafeInteger(limits.maxOpenPositions) || limits.maxOpenPositions < 1 ||
      !nonnegative(limits.maxSpread) || !nonnegative(limits.maxSlippage) ||
      !positive(limits.quoteMaxAgeSeconds))
    return deny(RISK_REASONS.INVALID_LIMITS);
  if (![state.dailyLoss, state.dailyTrades, state.openPositions, state.proposedRiskPercent,
        state.availableMargin, state.requiredMargin, state.proposedDailyLoss, quote.spread, quote.slippage,
        quote.timestamp, signal.expiresAt].every(finite) ||
      ![state.dailyLoss, state.dailyTrades, state.openPositions, state.proposedRiskPercent,
        state.availableMargin, state.requiredMargin, state.proposedDailyLoss, quote.spread, quote.slippage].every(nonnegative))
    return deny(RISK_REASONS.MISSING_DATA);
  if (!Number.isSafeInteger(state.dailyTrades) || !Number.isSafeInteger(state.openPositions))
    return deny(RISK_REASONS.MISSING_DATA);
  if (quote.timestamp > now || now - quote.timestamp > limits.quoteMaxAgeSeconds)
    return deny(RISK_REASONS.STALE_PRICE);
  if (signal.expiresAt <= now || signal.expiresAt < quote.timestamp)
    return deny(RISK_REASONS.SIGNAL_EXPIRED);
  if (state.dailyLoss + state.proposedDailyLoss > limits.maxDailyLoss + 1e-8)
    return deny(RISK_REASONS.DAILY_LOSS_LIMIT);
  if (state.dailyTrades >= limits.maxDailyTrades) return deny(RISK_REASONS.DAILY_TRADE_LIMIT);
  if (state.openPositions >= limits.maxOpenPositions) return deny(RISK_REASONS.OPEN_POSITION_LIMIT);
  if (quote.spread > limits.maxSpread) return deny(RISK_REASONS.SPREAD_LIMIT);
  if (quote.slippage > limits.maxSlippage) return deny(RISK_REASONS.SLIPPAGE_LIMIT);
  if (state.proposedRiskPercent <= 0 || state.proposedRiskPercent > limits.riskPercent)
    return deny(RISK_REASONS.TRADE_RISK_LIMIT);
  if (state.requiredMargin > state.availableMargin) return deny(RISK_REASONS.MARGIN_LIMIT);
  return {allowNewEntry: true, reason: null, closeOpenPositions: false};
}
