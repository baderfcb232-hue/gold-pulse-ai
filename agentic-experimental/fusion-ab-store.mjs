// Durable isolated A/B ledger; no trading methods and no raw account identifiers in reports.
import {createHash} from 'node:crypto';
import {scoreFusionPairs} from './fusion-ab-evaluation.mjs';
const S=['XAUUSD','BTCUSD'],stances=['BUY_WATCH','SELL_WATCH','WAIT'];
const validTime=t=>Number.isSafeInteger(t)&&t>0;
const good=p=>p&&stances.includes(p.stance)&&Number.isFinite(p.confidence)&&p.confidence>=0&&p.confidence<=1;
function fingerprint(q){
 if(typeof q?.brokerServer!=='string'||!q.brokerServer.toLowerCase().includes('demo')||q.brokerServer.toLowerCase().includes('synthetic')||typeof q.brokerSymbol!=='string'||!q.brokerSymbol||!Number.isSafeInteger(q.accountLogin)||q.accountLogin<=0)return null;
 return createHash('sha256').update(JSON.stringify([q.brokerServer,q.brokerSymbol,q.accountLogin])).digest('hex');
}
function fresh(q,t){
 return q?.environment==='EXPERIMENTAL_NABD_AGENTIC'&&q.accountType==='DEMO'&&q.executionEnabled===false&&S.includes(q.symbol)&&validTime(q.timestamp)&&q.timestamp<=t&&t-q.timestamp<=2&&Number.isFinite(q.bid)&&Number.isFinite(q.ask)&&q.bid>0&&q.ask>q.bid&&fingerprint(q)!==null;
}
export function createFusionStore({query,clock=()=>Math.floor(Date.now()/1000)}){
 async function reserve({symbol,at,maxPerDay=8,intervalSeconds=3600}){
  if(!S.includes(symbol)||!validTime(at)||Math.abs(at-clock())>5)throw Error('INVALID_AB_RESERVATION');
  const r=await query('SELECT agentic_research.reserve_fusion_ab($1,$2,$3,$4) AS reserved',[symbol,at,maxPerDay,intervalSeconds]);
  return r.rows[0]?.reserved===true;
 }
 async function fail({symbol,at}){
  await query("UPDATE agentic_research.fusion_ab_samples SET state='FAILED' WHERE symbol=$1 AND reserved_at=$2 AND state='RESERVED'",[symbol,at]);
 }
 async function save({symbol,at,observedAt,baseline,fusion,quote}){
  if(!S.includes(symbol)||!validTime(at)||!validTime(observedAt)||observedAt<at||observedAt-at>180||!good(baseline)||!good(fusion)||quote?.symbol!==symbol||!fresh(quote,observedAt))throw Error('INVALID_AB_PAIR');
  const r=await query("UPDATE agentic_research.fusion_ab_samples SET state='PENDING', observed_at=$3, baseline_tick_at=$4, baseline_mid=$5, feed_fingerprint=$6, baseline_stance=$7, fusion_stance=$8, baseline_confidence=$9, fusion_confidence=$10 WHERE symbol=$1 AND reserved_at=$2 AND state='RESERVED'",[symbol,at,observedAt,quote.timestamp,(quote.bid+quote.ask)/2,fingerprint(quote),baseline.stance,fusion.stance,baseline.confidence,fusion.confidence]);
  return r.rowCount===1;
 }
 async function observe(q){
  const t=clock();
  if(!fresh(q,t))return {scored:0,expired:0};
  const r=await query("UPDATE agentic_research.fusion_ab_samples SET state='SCORED',outcome_at=$3,direction=CASE WHEN $4>baseline_mid THEN 'UP' WHEN $4<baseline_mid THEN 'DOWN' ELSE 'FLAT' END WHERE symbol=$1 AND state='PENDING' AND feed_fingerprint=$2 AND $3 BETWEEN observed_at+3600 AND observed_at+3720",[q.symbol,fingerprint(q),q.timestamp,(q.bid+q.ask)/2]);
  const e=await query("UPDATE agentic_research.fusion_ab_samples SET state='EXPIRED' WHERE symbol=$1 AND ((state='PENDING' AND observed_at+3720<$2) OR (state='RESERVED' AND reserved_at+180<$2))",[q.symbol,t]);
  return {scored:r.rowCount,expired:e.rowCount};
 }
 async function report(){
  const t=clock();
  const counts=await query("SELECT state,count(*)::int AS n,count(*) FILTER(WHERE reserved_at >= $1 AND reserved_at < $1+86400)::int AS today FROM agentic_research.fusion_ab_samples GROUP BY state",[t-t%86400]);
  const r=await query("SELECT symbol,observed_at,outcome_at,direction,baseline_stance,fusion_stance FROM agentic_research.fusion_ab_samples WHERE state='SCORED' ORDER BY observed_at DESC LIMIT 500",[]);
  const rows=r.rows.map(x=>({symbol:x.symbol,observedAt:Number(x.observed_at),outcomeAt:Number(x.outcome_at),direction:x.direction,baseline:{stance:x.baseline_stance},fusion:{stance:x.fusion_stance},verifiedFutureBrokerOutcome:true}));
  const n=Object.fromEntries(counts.rows.map(x=>[x.state,x.n]));
  return {storage:'ISOLATED_POSTGRESQL',budgetScope:'DURABLE_UTC_DAY',usedToday:counts.rows.reduce((a,x)=>a+x.today,0),attempted:counts.rows.reduce((a,x)=>a+x.n,0),pending:n.PENDING||0,scored:n.SCORED||0,failed:n.FAILED||0,expired:n.EXPIRED||0,reserved:n.RESERVED||0,retainedScoringWindow:500,...scoreFusionPairs(rows),ordersCreated:0,liveTradingEnabled:false};
 }
 return {reserve,fail,save,observe,report};
}
