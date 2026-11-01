import {createHash} from 'node:crypto';

// A short, stable operator reference; the full, account/source-bound signal ID
// remains the database key and is never replaced by this display code.
export function recommendationCode(id) {
  if (typeof id !== 'string' || !id) return null;
  return createHash('sha256').update(id).digest('hex').slice(0, 12).toUpperCase();
}

// Non-sensitive, per-signal execution state. A SUBMITTED EA response is NOT proof
// of a broker fill; only a source-bound deal/position can establish that.
export function linkExecutionTrace(signals, entries = [], decisions = []) {
  const key = (symbol, id) => symbol + '\u0000' + id;
  const records = new Map(), checks = new Map();
  for (const record of entries) {
    const id = record?.plan_id || record?.plan?.id;
    const symbol = record?.symbol || record?.plan?.symbol;
    if (!id || !symbol) continue;
    const k = key(symbol, id), previous = records.get(k);
    if (!previous || (Number(record.time) || 0) > (Number(previous.time) || 0)) records.set(k, record);
  }
  for (const check of decisions) {
    if (!check?.plan_id || !check.symbol) continue;
    const k = key(check.symbol, check.plan_id), previous = checks.get(k);
    if (!previous || (Number(check.updated_at) || 0) >= (Number(previous.updated_at) || 0)) checks.set(k, check);
  }
  return signals.map(p => {
    if (!p?.id || !p?.symbol || !String(p.source || '').startsWith('MT5')) return p;
    const code = recommendationCode(p.id), entry = records.get(key(p.symbol, p.id));
    const check = checks.get(key(p.symbol, p.id));
    const status = entry?.status === 'REJECTED' ? 'REJECTED' :
      entry?.status === 'SUBMITTED' ? 'SUBMITTED' :
      entry?.status === 'DISPATCHED' ? 'DISPATCHED' :
      check?.status === 'BLOCKED' ? 'BLOCKED' : 'NOT_DISPATCHED';
    return {...p, execution_trace: {signal_code: code, status,
      approval_id: entry && Number.isSafeInteger(Number(entry.id)) ? Number(entry.id) : null,
      reason: entry?.status === 'REJECTED' ? 'EA_REJECTED' :
        check?.status === 'BLOCKED' && !entry ? check.reason : null,
      reason_code: entry?.reason_code ?? null,
      mt5_retcode: entry?.mt5_retcode ?? null,
      // Never claim FILLED based on MT5's SUBMITTED acknowledgement.
      broker_fill_confirmed: false}};
  });
}
