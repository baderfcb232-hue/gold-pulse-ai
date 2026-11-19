// Read-only projection for the isolated Demo viewer. Only validated market fields leave the service.
import { createHash, timingSafeEqual } from 'node:crypto';
const symbols = ['XAUUSD', 'BTCUSD'];
const frames = ['M5', 'M15', 'H1', 'H4'];
const iso = value => Number.isFinite(value) ? new Date(value * 1000).toISOString() : null;
const hash = value => createHash('sha256').update(value).digest();
const keyOf = (symbol, bar) => symbol + '-' + bar;
const validKey = key => /^(XAUUSD|BTCUSD)-[1-9][0-9]{8,10}$/.test(key || '');

export function authorizedView(header, key) {
  return typeof key === 'string' && key.length >= 32 && typeof header === 'string' &&
    header.length <= 256 && timingSafeEqual(hash(header), hash('Bearer ' + key));
}
function barsOnly(rows) {
  return (rows || []).map(({time, open, high, low, close}) => ({time, open, high, low, close}));
}
function bank() {
  return {quote:null, bars:Object.fromEntries(frames.map(frame => [frame, []])), cycles:new Map(), lastSchedule:null};
}
export function createObservatory({clock = () => Date.now()} = {}) {
  const markets = Object.fromEntries(symbols.map(symbol => [symbol, bank()]));
  const acknowledgements = new Map();
  const historyDeals = new Map();
  const now = () => new Date(clock()).toISOString();
  const partial = (symbol, bar, values) => {
    if (!markets[symbol] || !Number.isSafeInteger(bar) || bar <= 0) return;
    const cycles = markets[symbol].cycles, id = keyOf(symbol,bar);
    const cycle = {...(cycles.get(id) || {id,symbol,bar,source:'observer'}), ...values};
    cycles.set(id,cycle);
    while (cycles.size > 36) cycles.delete(cycles.keys().next().value);
  };
  function observe(snapshot, schedule) {
    const m = markets[snapshot?.symbol];
    if (!m || snapshot.accountType !== 'DEMO' || !snapshot.multiTimeframeVerified) return;
    m.quote = {bid:snapshot.bid, ask:snapshot.ask, at:iso(snapshot.timestamp), receivedAt:iso(snapshot.receivedAt)};
    for (const frame of frames) {
      const add = barsOnly(snapshot['candles'+frame]);
      const indexed = new Map(m.bars[frame].map(row=>[row.time,row]));
      for (const row of add) indexed.set(row.time,row);
      m.bars[frame] = [...indexed.values()].sort((a,b)=>a.time-b.time).slice(-160);
    }
    const bar = snapshot.candlesM5.at(-1)?.time;
    m.lastSchedule = {at:now(), reason:schedule.reason, scheduled:schedule.scheduled === true};
    if (!schedule.scheduled) return;
    partial(snapshot.symbol,bar,{at:now(),scheduledAt:now(),trigger:schedule.reason,quote:{...m.quote},
      framesUsed:[...frames], newsClassification:'NONE', candles:Object.fromEntries(frames.map(f=>[f,m.bars[f].slice(-80)]))});
  }
  function analysis(symbol, event) {
    const bar = event.closedBarAt ? Date.parse(event.closedBarAt)/1000 : null;
    if (!bar) return;
    if (event.stage === 'ANALYZED') {
      partial(symbol,bar,{at:event.at,analyzedAt:event.at,stance:event.stance,
        confidence:event.confidence,thesis:event.reasonSummary,trigger:event.trigger});
    } else if (event.stage === 'BLOCKED' || event.stage === 'PERSISTENCE_FAILED') {
      partial(symbol,bar,{analysisIssue:{at:event.at,reason:event.reason,stage:event.stage}});
    }
  }
  function decision(p, verdict) {
    const {symbol,closedBarTime,plan,features} = p;
    partial(symbol,closedBarTime,{thesis:plan.thesis,alternative:plan.counterThesis,evidence:plan.evidence,
      invalidation:plan.invalidation,riskNotes:plan.riskNotes,features, horizon:plan.timeHorizonMinutes,
      risk:{at:now(),status:verdict.created?'ACCEPTED':'BLOCKED',code:verdict.reason || null}});
  }
  function acknowledge(rec) {
    if (!validKey(rec?.id)) return;
    const filled = rec.status === 'FILLED' && [10009,10010].includes(rec.tradeRetcode) &&
      Number.isSafeInteger(rec.brokerDealTicket) && rec.brokerDealTicket > 0 &&
      Number.isFinite(rec.executedVolume) && rec.executedVolume > 0;
    acknowledgements.set(rec.id,{at:iso(rec.occurredAt),code:rec.tradeRetcode,status:rec.status,
      account:rec.accountLogin,deal:filled?String(rec.brokerDealTicket):null,lot:filled?rec.executedVolume:null});
    if(acknowledgements.size>256) acknowledgements.delete(acknowledgements.keys().next().value);
  }
  function history(records, snapshot) {
    if (!Array.isArray(records) || !snapshot || snapshot.accountType!=='DEMO') return;
    for (const r of records.slice(0,5)) {
      if (!validKey(r?.id) || !r.id.startsWith(snapshot.symbol+'-') ||
          r.symbol !== snapshot.brokerSymbol || typeof r.deal!=='string' || !/^[1-9][0-9]{0,18}$/.test(r.deal) ||
          !Number.isFinite(r.price) || r.price<=0 || !Number.isFinite(r.lot) || r.lot<=0 ||
          !Number.isSafeInteger(r.time) || r.time<=0) continue;
      historyDeals.set(r.id,{account:snapshot.accountLogin,deal:r.deal,at:iso(r.time),
        price:r.price,lot:r.lot,sl:r.sl>0&&Number.isFinite(r.sl)?r.sl:null,tp:r.tp>0&&Number.isFinite(r.tp)?r.tp:null});
      if(historyDeals.size>256) historyDeals.delete(historyDeals.keys().next().value);
    }
  }
  async function read({requested, journal, trade, sensor, active=[]}) {
    let history = [], journalState = 'UNAVAILABLE';
    if (journal?.viewDecisions) {
      try { history = await journal.viewDecisions(validKey(requested) ? requested : null); journalState = 'CONNECTED'; }
      catch { journalState = 'READ_FAILED'; }
    }
    const out = {};
    for (const symbol of symbols) {
      const m = markets[symbol], cycles = new Map();
      for (const row of history.filter(r=>r.symbol === symbol)) {
        const plan = row.plan_summary || {}, bar = Number(row.bar), id = keyOf(symbol,bar);
        cycles.set(id,{id,symbol,bar,at:row.analyzed_at,analyzedAt:row.analyzed_at,stance:row.stance,
          source:'journal',confidence:row.confidence,trigger:row.trigger,thesis:plan.thesis,alternative:plan.counterThesis,
          evidence:plan.evidence || [],invalidation:plan.invalidation,riskNotes:plan.riskNotes,horizon:plan.timeHorizonMinutes,
          analysisIssue:!row.stance?{stage:row.analysis_status,reason:(row.reason_codes||[]).join(', '),at:row.analyzed_at}:null,
          evaluation:row.outcome_status ? {status:row.outcome_status,at:row.outcome_tick_at,hit:row.hit,direction:row.direction}:null,
          comparison:row.ema_stance ? {stance:row.ema_stance,agreement:row.agreement,method:'EMA_PROXY'}:null});
      }
      for (const [id,record] of m.cycles) {
        const {candles, ...cycle} = record;
        cycles.set(id,{...cycles.get(id),...cycle});
      }
      for (const delivery of trade.recentDeliveries || []) {
        const c = cycles.get(delivery.id);
        if(c) c.delivery = {at:delivery.deliveredAt,status:delivery.deliveryState,ack:delivery.ackStatus || null};
      }
      for (const c of cycles.values()) {
        const ack = acknowledgements.get(c.id), hist = historyDeals.get(c.id);
        if (ack) {
          const {account, ...receipt} = ack;
          c.ack = receipt;
          if (hist && ack.deal === hist.deal && hist.account === account && Number.isSafeInteger(account) &&
              account>0 && Math.abs(hist.lot-ack.lot)<0.0000001) {
            const {account:unused, ...details} = hist;
            c.fill = {...details,source:'MT5_DEMO_HISTORY'};
          }
        }
      }
      const ordered = [...cycles.values()].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
      const selected = ordered.find(c=>c.id===requested);
      const rows = ordered.slice(0,28);
      if(selected && !rows.includes(selected)) rows.push(selected);
      out[symbol] = {quote:m.quote,sourceStatus:sensor.markets?.[symbol]?.status || 'AWAITING_SENSOR',
        lastSchedule:m.lastSchedule,active:active.includes(symbol),candles:m.bars,cycles:rows};
    }
    const frozen = symbols.flatMap(s=>[markets[s].cycles.get(requested)]).find(Boolean);
    return {schema:1,environment:'ISOLATED_DEMO',asOf:now(),markets:out,
      journal:journalState,executor:{online:trade.executorOnline,seenAt:trade.lastExecutorSeenAt},
      archivedChart:frozen?.candles ? {id:requested,candles:frozen.candles}:null};
  }
  return {observe,analysis,decision,acknowledge,history,read};
}
