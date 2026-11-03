// Operator-only, gold-EA performance from verified MT5 deal history.
// Percentages use an inferred starting balance because the current bridge does
// not transmit deposits/withdrawals or complete account-wide history.
const valid = n => typeof n === 'number' && Number.isFinite(n);

export function summarizeGoldPerformance({deals = [], positions = [], account = null,
  now = Date.now() / 1000, timeZone = 'Asia/Hebron'} = {}) {
  if (!account || !valid(account.balance)) return {available: false, reason: 'ACCOUNT_NOT_SHARED'};
  const formatter = new Intl.DateTimeFormat('en-US', {timeZone, year: 'numeric',
    month: '2-digit', day: '2-digit'});
  const dateKey = seconds => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(seconds * 1000))
      .filter(p => ['year', 'month', 'day'].includes(p.type)).map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const day = dateKey(now), month = day.slice(0, 7);
  const rows = (Array.isArray(deals) ? deals : []).filter(d => d && valid(d.time) &&
    d.time <= now + 5 && d.time > 0 && ['IN', 'OUT', 'INOUT', 'OUT_BY'].includes(d.entry_type) &&
    [d.profit, d.commission, d.swap, d.fee, d.volume].every(valid) && d.volume >= 0);
  const netOf = d => d.profit + d.commission + d.swap + d.fee;
  const dayRows = rows.filter(d => dateKey(d.time) === day);
  const monthRows = rows.filter(d => dateKey(d.time).slice(0, 7) === month);
  const sum = items => items.reduce((total, d) => total + netOf(d), 0);
  const period = items => {
    const net = sum(items);
    // Only the bot's own deals are transmitted. Without a full balance ledger
    // this is an ESTIMATE, never claim exact return on starting capital.
    const estimatedStart = account.balance - net;
    return {net, returnPercentEstimate: estimatedStart > 0 ? 100 * net / estimatedStart : null,
      startBalanceEstimate: estimatedStart > 0 ? estimatedStart : null, dealCount: items.length};
  };

  const openIds = new Set((Array.isArray(positions) ? positions : [])
    .map(p => String(p.position_id || p.ticket || '')).filter(Boolean));
  const grouped = new Map();
  for (const d of rows) {
    if (d.position_id == null || !String(d.position_id)) continue;
    const id = String(d.position_id);
    const p = grouped.get(id) || {id, entryVolume: 0, exitVolume: 0, net: 0, exitAt: 0};
    p.net += netOf(d);
    if (d.entry_type === 'IN') p.entryVolume += d.volume;
    else if (d.entry_type === 'OUT' || d.entry_type === 'OUT_BY') {
      p.exitVolume += d.volume;
      p.exitAt = Math.max(p.exitAt, d.time);
    }
    // Netting reversals are ambiguous without a full position ledger; exclude
    // them from win-rate calculations until fully normalized.
    else if (d.entry_type === 'INOUT') p.reversal = true;
    grouped.set(id, p);
  }
  const complete = [...grouped.values()].filter(p =>
    !p.reversal && p.entryVolume > 0 && p.exitVolume >= p.entryVolume - 1e-7 &&
    p.exitAt > 0 && !openIds.has(p.id));
  const score = tag => {
    const selected = complete.filter(p => tag === day ? dateKey(p.exitAt) === day :
      dateKey(p.exitAt).slice(0, 7) === month);
    const wins = selected.filter(p => p.net > 0).length;
    const losses = selected.filter(p => p.net < 0).length;
    const grossProfit = selected.reduce((x, p) => x + Math.max(0, p.net), 0);
    const grossLoss = selected.reduce((x, p) => x + Math.max(0, -p.net), 0);
    return {closedTrades: selected.length, wins, losses,
      winRatePercent: selected.length ? 100 * wins / selected.length : null,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
      grossProfit, grossLoss};
  };

  return {available: true, currency: account.currency || '', day, month,
    daily: {...period(dayRows), ...score(day)},
    monthly: {...period(monthRows), ...score(month)},
    floatingGold: (Array.isArray(positions) ? positions : []).reduce((total, p) =>
      total + (valid(p.profit) ? p.profit : 0) + (valid(p.swap) ? p.swap : 0), 0),
    baselineEstimated: true,
    caveat: 'النسب تقديرية لأن بيانات MT5 المتاحة لا تشمل سجل الإيداعات والسحوبات وكامل تداولات الحساب. تُحتسب النتائج من الصفقات المحفوظة فقط، ولا تدخل الصفقات المفتوحة في نسبة النجاح.'};
}
