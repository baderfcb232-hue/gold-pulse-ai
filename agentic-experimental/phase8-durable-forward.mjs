// Phase 8: immutable baseline and one-time forward outcome in the ISOLATED journal.
// No production imports, broker credentials, trading or simulated fills.
import {classifyEmaBaseline} from './phase7-strategy-comparison.mjs';
const SYMBOLS=['XAUUSD','BTCUSD'];
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const safeQuote=(s,now)=>s?.environment==='EXPERIMENTAL_NABD_AGENTIC'&&
 s.accountType==='DEMO'&&s.executionEnabled===false&&
 typeof s.brokerServer==='string'&&s.brokerServer.toLowerCase().includes('demo')&&
 !s.brokerServer.toLowerCase().includes('synthetic')&&
 SYMBOLS.includes(s.symbol)&&Number.isSafeInteger(s.timestamp)&&
 s.timestamp<=now&&now-s.timestamp<=2&&
 finite(s.bid)&&finite(s.ask)&&s.bid>0&&s.ask>s.bid;
const roundMid=s=>(s.bid+s.ask)/2;
export function createDurableForwardStore({query,clock=()=>Math.floor(Date.now()/1000),graceSeconds=120}={}){
 if(typeof query!=='function')throw Error('DATABASE_QUERY_REQUIRED');
 if(!Number.isSafeInteger(graceSeconds)||graceSeconds<1||graceSeconds>600)
  throw Error('INVALID_GRACE_SECONDS');
 async function save({symbol,closedBarTime,plan,features,broker}={}){
  const now=clock();
  if(!SYMBOLS.includes(symbol)||broker?.symbol!==symbol||!safeQuote(broker,now)||
   !plan||!['BUY_WATCH','SELL_WATCH','WAIT'].includes(plan.stance)||
   !finite(plan.confidence)||plan.confidence<0||plan.confidence>1||
   !Number.isSafeInteger(plan.timeHorizonMinutes)||plan.timeHorizonMinutes<1||
   plan.timeHorizonMinutes>60||!Number.isSafeInteger(closedBarTime)||
   closedBarTime<=0||closedBarTime>now)
   return {inserted:false,reason:'INVALID_VERIFIED_FORWARD_BASELINE'};
  if(plan.stance==='WAIT')return {inserted:false,reason:'AI_WAIT_NOT_DIRECTIONAL'};
  const ema=classifyEmaBaseline(features);
  const agreement=ema.stance==='UNVERIFIED'?'UNVERIFIED':
   ema.stance===plan.stance?'AGREED':'DISAGREED';
  const r=await query(
   'INSERT INTO agentic_research.demo_forward_evaluations (symbol,closed_bar_at,predicted_at,baseline_tick_at,horizon_at,baseline_mid,ai_stance,confidence,ema_stance,agreement) VALUES ($1,to_timestamp($2),to_timestamp($3),to_timestamp($4),to_timestamp($5),$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING RETURNING symbol',
   [symbol,closedBarTime,now,broker.timestamp,now+plan.timeHorizonMinutes*60,
    roundMid(broker),plan.stance,plan.confidence,ema.stance,agreement]);
  return {inserted:r.rowCount===1,reason:r.rowCount===1?null:'DUPLICATE_CLOSED_BAR'};
 }
 async function observe(broker){
  const now=clock();
  if(!safeQuote(broker,now))return {accepted:false,reason:'INVALID_DEMO_FORWARD_TICK'};
  const mid=roundMid(broker);
  // First only forward observation >= due timestamp, no historical price replay.
  // Atomic WHERE PENDING prevents double scoring after concurrent requests/restarts.
  const r=await query(
   `UPDATE agentic_research.demo_forward_evaluations
       SET outcome_status=CASE WHEN $3 <= horizon_at + ($4::integer * interval '1 second')
             THEN 'SCORED' ELSE 'EXPIRED' END,
           outcome_tick_at=to_timestamp($3),
           direction=CASE WHEN $3 <= horizon_at + ($4::integer * interval '1 second')
             THEN CASE WHEN $2 > baseline_mid THEN 'UP'
                       WHEN $2 < baseline_mid THEN 'DOWN' ELSE 'FLAT' END
             ELSE NULL END,
           hit=CASE WHEN $3 <= horizon_at + ($4::integer * interval '1 second')
             THEN CASE WHEN $2=baseline_mid THEN FALSE
                       WHEN ai_stance='BUY_WATCH' THEN $2>baseline_mid
                       ELSE $2<baseline_mid END
             ELSE NULL END
     WHERE symbol=$1 AND outcome_status='PENDING'
       AND baseline_tick_at < to_timestamp($3)
       AND horizon_at <= to_timestamp($3)
       AND to_timestamp($3) <= to_timestamp($5)
     RETURNING outcome_status`,
   [broker.symbol,mid,broker.timestamp,graceSeconds,now]);
  const statuses=r.rows||[];
  return {accepted:true,scored:statuses.filter(x=>x.outcome_status==='SCORED').length,
   expired:statuses.filter(x=>x.outcome_status==='EXPIRED').length};
 }
 async function report(){
  const r=await query(`SELECT symbol,
    count(*)::integer AS recorded,
    count(*) FILTER (WHERE outcome_status='PENDING')::integer AS pending,
    count(*) FILTER (WHERE outcome_status='SCORED')::integer AS scored,
    count(*) FILTER (WHERE outcome_status='EXPIRED')::integer AS expired,
    count(*) FILTER (WHERE hit=TRUE)::integer AS hits,
    count(*) FILTER (WHERE agreement='AGREED')::integer AS agreements,
    count(*) FILTER (WHERE agreement IN ('AGREED','DISAGREED'))::integer AS comparable
    FROM agentic_research.demo_forward_evaluations GROUP BY symbol`,[]);
  const markets={};
  for(const symbol of SYMBOLS){
   const row=r.rows?.find(x=>x.symbol===symbol)||{};
   const num=k=>Number(row[k]||0);
   const scored=num('scored'),comparable=num('comparable'),hits=num('hits');
   markets[symbol]={recorded:num('recorded'),pending:num('pending'),
    scored,expired:num('expired'),hits,
    directionalHitRate:scored>=30?Math.round(hits/scored*10000)/100:null,
    agreements:num('agreements'),comparable,
    emaAgreementRate:comparable>=30?Math.round(num('agreements')/comparable*10000)/100:null,
    sampleThreshold:30,insufficientSamples:scored<30};
  }
  return {status:'ISOLATED_POSTGRES_PERSISTED_RESEARCH',markets,
   persistence:'POSTGRES_TRANSACTIONAL_FIRST_WRITER_WINS',
   scope:'ISOLATED_RESEARCH_DATABASE_ONLY',comparator:'EMA_PROXY_NOT_FULL_FUSION',
   brokerExecutionVerified:false,profitabilityMeasured:false,
   transactionCostsIncluded:false,executionAllowed:false,ordersCreated:0};
 }
 return {save,observe,report};
}
