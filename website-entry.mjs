import {createHash} from 'node:crypto';
import {automaticRiskSizing} from './automatic-risk.mjs';
import {validateManualLot,stopLossEstimate} from './trade-lot.mjs';

export const entrySourceKey = s => createHash('sha256').update(JSON.stringify([
  s.account_ref, s.broker, s.symbol, s.execution.managed_magic])).digest('hex');

// A website plan can execute only against its own account's MT5 broker feed.
// Gold and BTC never share a quote source. Demo-only, explicitly opted-in.
export function websiteTradeDecision({enabled, snapshot: s, market: m, analysisPlan: a, costs, durable, now, requiredStrategy = null, tradeSizing = null}) {
  const no = reason => ({ready: false, reason, plan: null});
  if (!enabled) return no('DISABLED');
  if (!s?.execution?.website_recommendations) return no('MT5_WEBSITE_UPDATE_REQUIRED');
  if (!durable) return no('DURABLE_ENTRY_JOURNAL_REQUIRED');
  if (!s.account) return no('ACCOUNT_NOT_SHARED');
  const canonical = /^XAUUSD(?:[._#][A-Za-z0-9._#-]+)?$/i.test(s.symbol || '') ? 'XAUUSD'
    : /^BTCUSD(?:[._#][A-Za-z0-9._#-]+)?$/i.test(s.symbol || '') ? 'BTCUSD' : null;
  if (!s.execution.demo || !/just.?markets/i.test(s.broker || '') || !canonical)
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
  // A posted legacy signal must never be traded after switching to scalping (and vice versa).
  // All three strategy identities must match the current live broker-derived analysis.
  if (!a || a.strategy !== p.strategy || m.analysis.strategy !== p.strategy ||
      (requiredStrategy && p.strategy !== requiredStrategy))
    return no('WEBSITE_STRATEGY_MISMATCH');
  if (m.broker_symbol !== s.symbol || m.source !== `MT5 · ${s.broker}` || !m.source_id?.startsWith('MT5:') ||
      p.source_id !== m.source_id || p.source !== m.source || p.broker_symbol !== s.symbol || p.symbol !== canonical || m.symbol !== canonical)
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
  const maxSpread = canonical === 'BTCUSD'
    ? Math.max(1, Math.floor((s.ask + s.bid) / 2 * .001 / s.spec.point)) : 80;
  if (!Number.isFinite(s.spec?.point) || s.spec.point <= 0 ||
      Math.abs(price - p.entry) > risk * .15 || (s.ask - s.bid) / s.spec.point > Math.min(maxSpread, s.ea?.settings?.max_spread_points || maxSpread) ||
      (buy ? exit <= p.sl || exit >= tp : exit >= p.sl || exit <= tp)) return no('PRICE_OR_SPREAD_MOVED');
  if (!costs?.ready) return no('WAITING_COSTS');
  let manualLot = null;
  if (tradeSizing?.mode === 'FIXED') {
    const checked = validateManualLot(tradeSizing.lot, s.spec);
    if (!checked.ok) return no(checked.reason);
    const stopLoss = stopLossEstimate(checked.lot, p, s.spec);
    if (!(s.account?.equity>0) || !stopLoss || stopLoss > s.account.equity)
      return no('MANUAL_LOT_RISK_TOO_HIGH');
    manualLot = checked.lot; // Same entry/SL/TP. MT5 checks margin, broker stops and actual loss.
  } else {
    const sizing = automaticRiskSizing(s, p, now);
    if (!sizing.available) return no(sizing.reason);
    if (!sizing.estimate?.volume) return no(sizing.estimate?.code || 'INVALID_PLAN');
  }
  return {ready: true, reason: 'WEBSITE_READY',
    plan: {...p, tp, ...(manualLot===null ? {} : {manual_lot:manualLot}),
      expires_at: Math.min(p.expires_at, now + 15)}};
}

// A dispatch is claimed durably BEFORE returning a wire payload. An uncertain
// response is never retried, including across deploys or a second terminal.
export function websiteEntryJournal(pool) {
  return {
    recordWebsiteDecision: async (source,plan,reason,status,now) => {
      if (!source || !plan?.id || !['BLOCKED','ELIGIBLE'].includes(status) ||
          typeof reason !== 'string' || !/^[A-Z_]{2,64}$/.test(reason)) return null;
      await pool.query(`INSERT INTO nabd_website_decisions
        (source_key,plan_id,time,reason,status,updated_at) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT (source_key,plan_id) DO UPDATE SET
        reason=excluded.reason,status=excluded.status,updated_at=excluded.updated_at
        WHERE nabd_website_decisions.reason<>excluded.reason OR nabd_website_decisions.status<>excluded.status`,
        [source,plan.id,plan.issued_at,reason,status,now]);
    },
    websiteDecisions: async source => (await pool.query(
      'SELECT plan_id,time,reason,status,updated_at FROM nabd_website_decisions WHERE source_key=$1 ORDER BY updated_at DESC LIMIT 50',
      [source])).rows,
    claimWebsite: async (source, p, now) => (await pool.query(`INSERT INTO nabd_website_entries
      (source_key,plan_id,time,expires,status,plan) VALUES($1,$2,$3,$4,'DISPATCHED',$5)
      ON CONFLICT(source_key,plan_id) DO NOTHING RETURNING *`,
      [source,p.id,now,p.expires_at,JSON.stringify(p)])).rows[0] || null,
    websiteResult: async (source,id,status,now,details={}) => {
      // A submitted request is never promoted to a confirmed position by this ACK.
      // Only accepted, source-bound responses may annotate a previously dispatched id.
      const reason=Number.isInteger(details.reason_code)&&details.reason_code>=0&&details.reason_code<=999
        ?details.reason_code:null;
      const retcode=Number.isInteger(details.mt5_retcode)&&details.mt5_retcode>=0&&details.mt5_retcode<=999999
        ?details.mt5_retcode:null;
      await pool.query(`UPDATE nabd_website_entries SET status=$3,reported_at=$4,
        reason_code=$5,mt5_retcode=$6
        WHERE source_key=$1 AND id=$2 AND status='DISPATCHED'`,
        [source,id,status,now,reason,retcode]);
    },
    websiteEntries: async source => (await pool.query(`SELECT id,time,expires,status,plan,reported_at,reason_code,mt5_retcode
      FROM nabd_website_entries WHERE source_key=$1 ORDER BY id DESC LIMIT 30`,[source])).rows
      .map(r => ({...r,id:Number(r.id),plan:JSON.parse(r.plan)}))
  };
}
