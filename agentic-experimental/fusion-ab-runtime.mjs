// Bounded prospective shadow A/B. Never submits an intent or invokes a broker.
import {scoreFusionPairs} from './fusion-ab-evaluation.mjs';
const symbols=['XAUUSD','BTCUSD'];
const good=r=>r?.status==='RESEARCH_ANALYSIS_ONLY'&&['BUY_WATCH','SELL_WATCH','WAIT'].includes(r.plan?.stance)&&Number.isFinite(r.plan.confidence)&&r.plan.confidence>=0&&r.plan.confidence<=1;
export function createFusionRuntime({enabled=false,brains={},clock=()=>Math.floor(Date.now()/1000),maxPerDay=8,intervalSeconds=3600,quoteProvider=()=>null,onEvent=()=>{},storeProvider=null}={}){
 if(!Number.isInteger(maxPerDay)||maxPerDay<1||maxPerDay>16||!Number.isInteger(intervalSeconds)||intervalSeconds<1800)throw Error('INVALID_AB_BUDGET');
 const last={},busy=new Set(),pending=new Map(),rows=[],lastObserve={};
 let storageFailures=0;
 let day=null,used=0,attempted=0,paired=0,failed=0,expired=0;
 const log=(symbol,event)=>{try{onEvent(symbol,event)}catch{}};
 const fresh=(s,symbol,t)=>s?.symbol===symbol&&s.accountType==='DEMO'&&s.environment==='EXPERIMENTAL_NABD_AGENTIC'&&typeof s.brokerServer==='string'&&s.brokerServer.toLowerCase().includes('demo')&&!s.brokerServer.toLowerCase().includes('synthetic')&&Number.isSafeInteger(s.timestamp)&&s.timestamp<=t&&t-s.timestamp<=2&&Number.isFinite(s.bid)&&Number.isFinite(s.ask)&&s.bid>0&&s.ask>s.bid;
 function start(ctx,primary){
  const t=clock(),symbol=ctx?.symbol,d=Math.floor(t/86400);
  if(!enabled||!symbols.includes(symbol)||!ctx.fusionEvidence||ctx.feedType!=='MT5_DEMO_BROKER'||ctx.accountType!=='DEMO'||!ctx.candlesVerified||!ctx.multiTimeframeVerified||!Number.isSafeInteger(ctx.observedAt)||ctx.observedAt>t||t-ctx.observedAt>5||!brains[symbol]||busy.has(symbol))return false;
  if(storeProvider){
   const store=storeProvider();if(!store)return false;
   busy.add(symbol);
   const base=structuredClone(ctx);delete base.fusionEvidence;
   // Observe rejection even if the database reservation is delayed.
   const safePrimary=Promise.resolve(primary).then(value=>({ok:true,value}),()=>({ok:false}));
   void (async()=>{
    let reserved=false;
    try{
     reserved=await store.reserve({symbol,at:t,maxPerDay,intervalSeconds});if(!reserved)return;
     if(clock()-ctx.observedAt>5){await store.fail({symbol,at:t});return;}
     const [a,b]=await Promise.all([Promise.resolve().then(()=>brains[symbol].analyze(base)),safePrimary]);
     const at=clock(),q=quoteProvider(symbol);
     if(!good(a)||!b.ok||!good(b.value)||!fresh(q,symbol,at)){await store.fail({symbol,at:t});log(symbol,'PAIR_FAILED');return;}
     const saved=await store.save({symbol,at:t,observedAt:at,baseline:a.plan,fusion:b.value.plan,quote:q});
     if(saved)log(symbol,'PAIR_RECORDED');else await store.fail({symbol,at:t});
    }catch{storageFailures++;if(reserved)try{await store.fail({symbol,at:t});}catch{};log(symbol,'PAIR_FAILED');}
    finally{busy.delete(symbol);}
   })();return true;
  }
  if(day!==d){day=d;used=0;}
  if(used>=maxPerDay||t-(last[symbol]??-Infinity)<intervalSeconds||pending.size>=32)return false;
  used++;attempted++;last[symbol]=t;busy.add(symbol);
  const base=structuredClone(ctx);delete base.fusionEvidence;
  // Run baseline concurrently with the primary request on exactly the same context.
  void Promise.allSettled([Promise.resolve().then(()=>brains[symbol].analyze(base)),primary]).then(([a,b])=>{
   if(a.status!=='fulfilled'||b.status!=='fulfilled'||!good(a.value)||!good(b.value)){failed++;log(symbol,'PAIR_FAILED');return;}
   const at=clock(),q=quoteProvider(symbol);
   // Anchor both predictions to the same fresh broker price after BOTH outputs exist.
   if(!fresh(q,symbol,at)){failed++;log(symbol,'PAIR_NO_FRESH_ANCHOR');return;}
   const p={symbol,observedAt:at,baseline:{stance:a.value.plan.stance},fusion:{stance:b.value.plan.stance},baselinePrice:(q.bid+q.ask)/2,baselineQuoteAt:q.timestamp,brokerServer:q.brokerServer,brokerSymbol:q.brokerSymbol,accountLogin:q.accountLogin};
   pending.set(symbol+':'+at,p);paired++;log(symbol,'PAIR_RECORDED');
  }).catch(()=>{failed++;log(symbol,'PAIR_FAILED');}).finally(()=>busy.delete(symbol));
  return true;
 }
 function observe(q){
  const t=clock();
  if(storeProvider){
   const store=storeProvider();if(!enabled||!store||!fresh(q,q?.symbol,t)||!symbols.includes(q.symbol)||t-(lastObserve[q.symbol]??-Infinity)<10)return;
   lastObserve[q.symbol]=t;
   void store.observe(q).then(r=>{if(r.scored)log(q.symbol,'PAIR_SCORED');}).catch(()=>{storageFailures++;});return;
  }
  for(const [id,p] of pending){
   if(t>p.observedAt+3720){pending.delete(id);expired++;continue;}
   if(!fresh(q,p.symbol,t)||q.timestamp<p.observedAt+3600||q.timestamp>p.observedAt+3720||q.brokerServer!==p.brokerServer||q.brokerSymbol!==p.brokerSymbol||q.accountLogin!==p.accountLogin)continue;
   const end=(q.bid+q.ask)/2;
   rows.push({...p,outcomeAt:q.timestamp,verifiedFutureBrokerOutcome:true,direction:end>p.baselinePrice?'UP':end<p.baselinePrice?'DOWN':'FLAT'});
   if(rows.length>500)rows.shift();pending.delete(id);log(p.symbol,'PAIR_SCORED');
  }
 }
 async function durableReport(){
  const store=storeProvider?.();
  if(!store)return {status:'WAITING_ISOLATED_DATABASE',enabled,storageFailures,executionAllowed:false,ordersCreated:0};
  try{return {...await store.report(),status:enabled?'SAMPLING_ENABLED':'DISABLED',enabled,maxPerDay,intervalSeconds,storageFailures};}
  catch{return {status:'DATABASE_REPORT_FAILED',enabled,storageFailures,executionAllowed:false,ordersCreated:0};}
 }
 function report(){return {status:enabled?'SAMPLING_ENABLED':'DISABLED',enabled,maxPerDay,intervalSeconds,usedToday:day===Math.floor(clock()/86400)?used:0,attempted,paired,failed,expired,pending:pending.size,scored:rows.length,retention:'IN_MEMORY_RESETS_ON_RESTART',budgetScope:'PER_PROCESS_UTC_DAY',...scoreFusionPairs(rows),ordersCreated:0,liveTradingEnabled:false};}
 return {start,observe,report,durableReport};
}
