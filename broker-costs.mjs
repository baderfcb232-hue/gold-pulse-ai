const KEYS = ['spreadBps', 'slippageBps', 'commissionBps', 'carryBpsPerDay'];
const DAY = 86400;

// A cost scenario belongs to one account, server, instrument and EA. A Coinbase
// scenario or a broker's advertised minimum spread cannot stand in for it.
export function brokerCostStatus(snapshot, profiles, now) {
  if (!snapshot) return {status: 'WAITING_BROKER', ready: false, observedSpreadBps: null};
  const live = snapshot.terminal_connected && now - snapshot.quote_at >= -5 &&
    now - snapshot.quote_at <= 10 && now - snapshot.received_at >= -5 && now - snapshot.received_at <= 10;
  const mid = (snapshot.bid + snapshot.ask) / 2;
  const observedSpreadBps = live && mid > 0 ? (snapshot.ask - snapshot.bid) / mid * 10000 : null;
  const result = {ready: false, observedSpreadBps, broker: snapshot.broker, symbol: snapshot.symbol};
  if (!Array.isArray(profiles)) return {...result, status: 'INVALID_COST_CONFIGURATION'};
  const matches = profiles.filter(p => p && p.accountRef === snapshot.account_ref &&
    p.broker === snapshot.broker && p.symbol === snapshot.symbol &&
    p.magic === snapshot.execution.managed_magic);
  if (matches.length !== 1) return {...result, status: matches.length ? 'AMBIGUOUS_COST_PROFILE' : 'WAITING_VERIFIED_COSTS', missing: KEYS};
  const p = matches[0], costs = p.costs;
  const missing = KEYS.filter(k => typeof costs?.[k] !== 'number' || !Number.isFinite(costs[k]) || costs[k] < 0 || costs[k] > 1000);
  if (missing.length || costs.acknowledged !== true || typeof p.evidence !== 'string' || p.evidence.trim().length < 8 ||
    !Number.isFinite(p.verifiedAt) || p.verifiedAt <= 0 || p.verifiedAt > now + 5)
    return {...result, status: 'INVALID_COST_PROFILE', missing};
  if (now - p.verifiedAt > 30 * DAY) return {...result, status: 'EXPIRED_COST_PROFILE'};
  const scenario = Object.fromEntries(KEYS.map(k => [k, costs[k]]));
  scenario.acknowledged = true;
  const valid = {...result, costs: scenario, verifiedAt: p.verifiedAt, evidence: p.evidence.slice(0, 500),
    // This is a constant-cost simulation scenario, not historical execution data.
    costMeaning: 'ACKNOWLEDGED_SCENARIO'};
  if (!live) return {...valid, status: 'WAITING_LIVE_BROKER'};
  if (observedSpreadBps > scenario.spreadBps + 1e-8) return {...valid, status: 'SPREAD_EXCEEDS_SCENARIO'};
  return {...valid, status: 'READY', ready: true};
}
