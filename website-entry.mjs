import {createHash} from 'node:crypto';
import {automaticRiskSizing} from './automatic-risk.mjs';

export const entrySourceKey = s => createHash('sha256').update(JSON.stringify([
  s.account_ref, s.broker, s.symbol, s.execution.managed_magic])).digest('hex');

// Only the website's frozen plan on this account's MT5 gold feed is eligible.
// No local EA strategy signal is required. This is still Demo-only and opt-in.
export function websiteTradeDecision({enabled, snapshot: s, market: m, analysisPlan: a, costs, durable, now}) {
  const no = reason => ({ready: false, reason, plan: null});
  if (!enabled) return no('DISABLED');
  if (!s?.execution?.website_recommendations) return no('MT5_WEBSITE_UPDATE_REQUIRED');
  if (!durable) return no('DURABLE_ENTRY_JOURNAL_REQUIRED');
  if (!s.account) return no('ACCOUNT_NOT_SHARED');
  if (!s.execution.demo || !/just.?markets/i.test(s.broker || '') || !/^XAUUSD(?:[._#-][a-zA-Z0-9._#-]*)?$/i.test(s.symbol || ''))
    return no('NOT_JUSTMARKETS_DEMO');
  if (!s.execution.demo_recommendations || !s.execution.enabled || !s.execution.main_connected ||
      !s.execution.remote_control || s.execution.paused || s.ea?.emergency_stop || !s.terminal_connected)
    return no('MT5_EXECUTION_NOT_READY');
  if (s.positions?.length) return no('POSITION_ALREADY_OPEN');
  if (![s.received_at, s.quote_at, s.ea?.heartbeat_at].every(v => Number.isFinite(v) && v <= now + 5) ||
      now - s.received_at > 5 || now - s.quote_at > 10 || now - s.ea.heartbeat_at > 5)
    return no('STALE_MT5');
  const p = m?.currentSignal;
  if (!p || m.connection !== 'LIVE' || m.analysis?.status !== 'READY') return no('WAITING_WEBSITE_PLAN');
  if (m.broker_symbol !== s.symbol || m.source !== `MT5 · ${s.broker}` || !m.source_id?.startsWith('MT5:') ||
      p.source_id !== m.source_id || p.source !== m.source || p.broker_symbol !== s.symbol || p.symbol !== 'XAUUSD')
    return no('WEBSITE_SOURCE_MISMATCH');
  if (!a || a.bar_time !== p.bar_time || a.side !== p.side) return no('WEBSITE_PLAN_CHANGED');
  if (!Number.isFinite(s.execution.website_since) || s.execution.website_since <= 0 ||
      s.execution.website_since > now + 5 || p.issued_at < s.execution.website_since)
    return no('WAITING_NEW_WEBSITE_PLAN');
  const tp = p.tp1, buy = p.side === 'BUY';
  if (typeof p.id !== 'string' || !p.id || p.id.length > 300 || p.status !== 'TRACKING' ||
      !['BUY','SELL'].includes(p.side) || ![p.entry,p.sl,tp].every(v => Number.isFinite(v) && v > 0) ||
      (buy ? !(p.sl < p.entry && p.entry < tp) : !(tp < p.entry && p.entry < p.sl)) ||
      ![p.issued_at,p.expires_at,p.bar_time].every(Number.isFinite) || p.issued_at > now + 5 || now - p.issued_at > 75 ||
      p.expires_at <= now || p.bar_time > now || now - (p.bar_time + 300) > 300 || p.bar_time + 300 > now + 5)
    return no('INVALID_PLAN');
  const price = buy ? s.ask : s.bid, exit = buy ? s.bid : s.ask, risk = Math.abs(p.entry - p.sl);
  if (!Number.isFinite(s.spec?.point) || s.spec.point <= 0 ||
      Math.abs(price - p.entry) > risk * .15 || (s.ask - s.bid) / s.spec.point > Math.min(80, s.ea?.settings?.max_spread_points || 80) ||
      (buy ? exit <= p.sl || exit >= tp : exit >= p.sl || exit <= tp)) return no('PRICE_OR_SPREAD_MOVED');
  if (!costs?.ready) return no('WAITING_COSTS');
  const sizing = automaticRiskSizing(s, p, now);
  if (!sizing.available) return no(sizing.reason);
  if (!sizing.estimate?.volume) return no(sizing.estimate?.code || 'INVALID_PLAN');
  return {ready: true, reason: 'WEBSITE_READY', plan: {...p, tp, expires_at: Math.min(p.expires_at, now + 15)}};
}

// A dispatch is claimed durably BEFORE returning a wire payload. An uncertain
// response is never retried, including across deploys or a second terminal.
export function websiteEntryJournal(pool) {
  return {
    claimWebsite: async (source, p, now) => (await pool.query(`INSERT INTO nabd_website_entries
      (source_key,plan_id,time,expires,status,plan) VALUES($1,$2,$3,$4,'DISPATCHED',$5)
      ON CONFLICT(source_key,plan_id) DO NOTHING RETURNING *`,
      [source,p.id,now,p.expires_at,JSON.stringify(p)])).rows[0] || null,
    websiteResult: async (source,id,status,now) => {await pool.query(`UPDATE nabd_website_entries
      SET status=$3,reported_at=$4 WHERE source_key=$1 AND id=$2 AND status='DISPATCHED'`,[source,id,status,now]);},
    websiteEntries: async source => (await pool.query(`SELECT id,time,expires,status,plan,reported_at
      FROM nabd_website_entries WHERE source_key=$1 ORDER BY id DESC LIMIT 30`,[source])).rows
      .map(r => ({...r,id:Number(r.id),plan:JSON.parse(r.plan)}))
  };
}
