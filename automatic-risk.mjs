import {positionSize} from './engine.mjs';

// Estimates only. MT5 recalculates volume with OrderCalcProfit and applies its
// remaining daily loss allowance, margin ceiling and fresh-price checks.
export function automaticRiskSizing(snapshot, plan = null, now = Date.now() / 1000) {
  const account = snapshot?.account, spec = snapshot?.spec;
  const riskPercent = snapshot?.execution?.risk_percent;
  if (!account || !Number.isFinite(account.equity) || account.equity <= 0)
    return {available: false, reason: 'ACCOUNT_NOT_SHARED'};
  if (!Number.isFinite(riskPercent) || riskPercent <= 0 || riskPercent > 100)
    return {available: false, reason: 'INVALID_RISK_SETTINGS'};
  if (!spec || ![spec.tick_size, spec.tick_value_loss, spec.volume_min, spec.volume_step, spec.volume_max].every(v => Number.isFinite(v) && v > 0) || spec.volume_max < spec.volume_min)
    return {available: false, reason: 'INVALID_CONTRACT'};
  const budget = account.equity * riskPercent / 100;
  const result = {available: true, mode: 'EQUITY_AND_STOP', capital: account.equity, riskPercent, budget,
    currency: account.currency || spec.currency, minimumVolume: spec.volume_min,
    maxStopDistance: budget / (spec.volume_min * spec.tick_value_loss / spec.tick_size),
    plan: null, estimate: null};
  if (!plan) return result;
  // Callers select the matching broker feed; the contract suffix must also
  // match before applying this account's tick values to an estimate.
  const brokerSymbol = plan.broker_symbol || plan.symbol;
  if (brokerSymbol !== snapshot.symbol || !['BUY', 'SELL'].includes(plan.side) ||
      !Number.isFinite(plan.entry) || plan.entry <= 0 || !Number.isFinite(plan.sl) || plan.sl <= 0 ||
      (plan.side === 'BUY' ? plan.sl >= plan.entry : plan.sl <= plan.entry))
    return {...result, reason: 'INVALID_PLAN'};
  result.plan = {id: plan.id || null, side: plan.side, entry: plan.entry, sl: plan.sl,
    issued_at: plan.issued_at, expires_at: plan.expires_at,
    expired: !Number.isFinite(plan.expires_at) || plan.expires_at <= now || (plan.status != null && plan.status !== 'TRACKING')};
  result.estimate = positionSize({equity: account.equity, riskPercent, entry: plan.entry, sl: plan.sl,
    spec, freeMargin: Number.isFinite(account.free_margin) ? account.free_margin : 0});
  return result;
}
