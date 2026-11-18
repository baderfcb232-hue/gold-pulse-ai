// Phase 6: read-only forward evaluation of DEMO model WATCH decisions.
// Record predictions only after analysis; score only FUTURE, fresh, authenticated
// broker observations, never synthetic/backfilled/revised prices or trade fills.
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const supported=x=>x==='XAUUSD'||x==='BTCUSD';
export function createForwardEvaluation({clock=()=>Math.floor(Date.now()/1000),
 maxPending=100,maxResults=200,graceSeconds=120}={}){
 if(!Number.isSafeInteger(maxPending)||maxPending<1||maxPending>1000||
    !Number.isSafeInteger(maxResults)||maxResults<1||maxResults>2000||
    !Number.isSafeInteger(graceSeconds)||graceSeconds<1||graceSeconds>600)
  throw Error('INVALID_EVALUATION_CONFIG');
 const pending=new Map(),results=[],counts={recorded:0,scored:0,expired:0,skipped:0,wait:0};
 let rejected=0;
 const fresh=(s,t)=>s?.environment==='EXPERIMENTAL_NABD_AGENTIC'&&
  s.accountType==='DEMO'&&s.executionEnabled===false&&
  typeof s.brokerServer==='string'&&s.brokerServer.toLowerCase().includes('demo')&&
  !s.brokerServer.toLowerCase().includes('synthetic')&&
  Number.isSafeInteger(s.timestamp)&&Number.isSafeInteger(t)&&
  s.timestamp<=t&&t-s.timestamp<=2&&
  finite(s.bid)&&finite(s.ask)&&s.bid>0&&s.ask>s.bid;
 const middle=s=>(s.bid+s.ask)/2;
 function record({symbol,plan,broker,closedBarTime}={}){
  const t=clock();
  if(!supported(symbol)||!plan||!['BUY_WATCH','SELL_WATCH','WAIT'].includes(plan.stance)||
    !finite(plan.confidence)||plan.confidence<0||plan.confidence>1||
    !Number.isSafeInteger(closedBarTime)||closedBarTime<=0||closedBarTime>t||
    !Number.isSafeInteger(plan.timeHorizonMinutes)||plan.timeHorizonMinutes<1||
    plan.timeHorizonMinutes>60||!fresh(broker,t)||broker.symbol!==symbol){
   rejected++;return {accepted:false,reason:'UNVERIFIED_FORWARD_BASELINE'};
  }
  // An explicit WAIT is counted, but not misclassified as a winning prediction.
  if(plan.stance==='WAIT'){counts.wait++;return {accepted:true,status:'WAIT_NO_DIRECTIONAL_PREDICTION'};}
  const id=symbol+':'+closedBarTime;
  if(pending.has(id)||results.some(x=>x.id===id)){
   rejected++;return {accepted:false,reason:'DUPLICATE_PREDICTION'};
  }
  // Fail closed on backlog: do not silently replace unresolved future predictions.
  if(pending.size>=maxPending){rejected++;return {accepted:false,reason:'EVALUATION_CAPACITY_REACHED'};}
  pending.set(id,{id,symbol,stance:plan.stance,confidence:plan.confidence,
   predictedAt:t,baselineAt:broker.timestamp,baseline:middle(broker),
   dueAt:t+plan.timeHorizonMinutes*60});
  counts.recorded++;
  return {accepted:true,status:'AWAITING_FUTURE_BROKER_QUOTE'};
 }
 function observe(snapshot){
  const t=clock();
  if(!supported(snapshot?.symbol)||!fresh(snapshot,t)){
   rejected++;return {accepted:false,reason:'INVALID_FUTURE_BROKER_QUOTE'};
  }
  let scored=0,expired=0;
  for(const [id,p] of pending){
   if(p.symbol!==snapshot.symbol||snapshot.timestamp<p.dueAt)continue;
   if(snapshot.timestamp<=p.baselineAt)continue;
   if(snapshot.timestamp>p.dueAt+graceSeconds){
    // No forward outcome can be inferred from a late tick; do not backfill.
    pending.delete(id);counts.expired++;expired++;continue;
   }
   const end=middle(snapshot),delta=(end-p.baseline)/p.baseline;
   const direction=delta>0?'UP':delta<0?'DOWN':'FLAT';
   const hit=direction!=='FLAT'&&
      (p.stance==='BUY_WATCH'?direction==='UP':direction==='DOWN');
   results.push({id,symbol:p.symbol,stance:p.stance,
    confidence:p.confidence,predictedAt:p.predictedAt,observedAt:snapshot.timestamp,
    direction,hit,returnPct:Math.round(delta*10000)/100});
   if(results.length>maxResults)results.shift();
   pending.delete(id);counts.scored++;scored++;
  }
  return {accepted:true,scored,expired};
 }
 function report(){
  const markets={};
  for(const symbol of ['XAUUSD','BTCUSD']){
   const subset=results.filter(x=>x.symbol===symbol),hits=subset.filter(x=>x.hit).length;
   markets[symbol]={scored:subset.length,hits,
    directionalHitRate:subset.length>=30?Math.round(10000*hits/subset.length)/100:null,
    sampleThreshold:30,insufficientSamples:subset.length<30,
    pending:[...pending.values()].filter(x=>x.symbol===symbol).length};
  }
  return {status:'FORWARD_RESEARCH_ONLY',markets,counts:{...counts},rejected,
   recent:results.slice(-20).reverse().map(x=>({
    symbol:x.symbol,stance:x.stance,direction:x.direction,hit:x.hit,
    predictedAt:new Date(x.predictedAt*1000).toISOString(),
    observedAt:new Date(x.observedAt*1000).toISOString()})),
   methodology:'FIRST_FRESH_DEMO_BROKER_TICK_WITHIN_GRACE_SECONDS_AFTER_HORIZON',
   graceSeconds,
   dataRetention:'BOUNDED_IN_MEMORY_RESETS_ON_RESTART',
   historicalBacktest:false,brokerFillsVerified:false,profitabilityMeasured:false,
   transactionCostsIncluded:false,liveTradingEnabled:false,
   executionAllowed:false,ordersCreated:0};
 }
 return {record,observe,report};
}
