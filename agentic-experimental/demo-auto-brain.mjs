// NABD isolated DEMO -> OpenAI research path. Read-only, fail closed.
// Only accepts snapshots already authenticated + validated by demo-ingest.mjs.
// No MT5 order, signal dispatch, Telegram, or production imports.
import {validateIsolatedDemoSnapshot} from './mt5-demo-sensor.mjs';
import {validateResearchContext} from './research-brain.mjs';
import {multiTimeframeFeatures} from './market-features.mjs';

const utc=t=>new Date(t*1000).toISOString();
const noOrders=Object.freeze({executionAllowed:false,ordersCreated:0,tradeAllowed:false});
const durations=Object.freeze({M5:300,M15:900,H1:3600,H4:14400});
export function createDemoAutoBrain({
 brains={},scheduler,clock=()=>Math.floor(Date.now()/1000),
 enabled=false,spreadLimits={XAUUSD:2.5,BTCUSD:80},journalProvider=()=>null,onAudit=()=>{},onPlan=()=>{}
}={}){
 if(!scheduler||typeof scheduler.consider!=='function')throw Error('SCHEDULER_REQUIRED');
 let scheduled=0,completed=0,blocked=0,persistenceFailures=0;
 const active=new Set(),tasks=new Set(),lastBySymbol={};
 const record=(symbol,stage,details={})=>{
  lastBySymbol[symbol]={stage,at:utc(clock()),...details};
  if(stage!=='SCHEDULED')try{onAudit(symbol,lastBySymbol[symbol]);}catch{}
 };
 async function analyzeOne(s,trigger){
  const symbol=s.symbol,now=clock();
  try{
   // Ingress validation and research-context freshness must BOTH hold.
   const checked=validateIsolatedDemoSnapshot(s,now);
   if(checked.status!=='VALIDATED_RESEARCH_SENSOR'||!checked.safe.multiTimeframeVerified){
    blocked++;record(symbol,'BLOCKED',{reason:'STALE_OR_INVALID_BROKER_SNAPSHOT'});return;
   }
   const clean=checked.safe;
   const ctx={symbol,feedType:'MT5_DEMO_BROKER',observedAt:clean.timestamp,
    bid:clean.bid,ask:clean.ask,spreadLimit:spreadLimits[symbol],
    candlesVerified:true,multiTimeframeVerified:clean.multiTimeframeVerified,
    // Model sees recent price structure plus indicators computed from deeper
    // closed-bar history. Do not pay for 200 raw candles per model call.
    candlesM5:clean.candlesM5.slice(-40),candlesM15:clean.candlesM15.slice(-32),
    candlesH1:clean.candlesH1.slice(-24),candlesH4:clean.candlesH4.slice(-24),
    accountType:'DEMO',
    technicalEvidence:multiTimeframeFeatures(clean),
    // Unlicensed/late economic headlines never become release-time evidence.
    news:{classification:'NONE'}};
   const ready=validateResearchContext(ctx,now);
   if(ready.status!=='RESEARCH_CONTEXT_READY'){
    blocked++;record(symbol,'BLOCKED',{reason:ready.reasons.join(',')});return;
   }
   const brain=brains[symbol];
   if(!brain||typeof brain.analyze!=='function'){
    blocked++;record(symbol,'BLOCKED',{reason:'AI_MODEL_NOT_CONFIGURED'});return;
   }
   const result=await brain.analyze(ctx);
   if(result.status!=='RESEARCH_ANALYSIS_ONLY'||!result.plan){
    blocked++;record(symbol,'BLOCKED',{reason:(result.reasons||['AI_ANALYSIS_FAILED']).join(',')});
   }else{
    completed++;
    record(symbol,'ANALYZED',{stance:result.plan.stance,
     confidence:result.plan.confidence,closedBarAt:utc(trigger.closedBarTime),
     trigger:trigger.reason,reasonSummary:(result.plan.thesis||'').slice(0,180),
     evidenceCount:result.plan.evidence?.length||0,simulationOnly:true});
   }
   const journal=journalProvider();
   let auditable=false;
   if(journal?.saveAnalysis){
    try{
     const saved=await journal.saveAnalysis({symbol,closedBarAt:trigger.closedBarTime,
      trigger:trigger.reason,status:result.status,
      stance:result.plan?.stance||null,
      confidence:result.plan?.confidence??null,
      reasonCodes:result.reasons||[],analyzedAt:clock(),plan:result.plan||null});
     auditable=saved?.inserted===true;
    }catch{persistenceFailures++;record(symbol,'PERSISTENCE_FAILED',
       {reason:'ISOLATED_RESEARCH_JOURNAL_WRITE_FAILED'});}
   }
   // Only a successfully persisted, unique, research-only decision can
   // reach the separate DEMO intent gate. A model never calls a broker.
   if(auditable&&result.status==='RESEARCH_ANALYSIS_ONLY'&&result.plan){
    try{
     onPlan({symbol,plan:result.plan,features:ctx.technicalEvidence,
       closedBarTime:trigger.closedBarTime});
    }catch{blocked++;record(symbol,'BLOCKED',{reason:'DEMO_INTENT_GATE_FAILED'});}
   }
  }catch{
   blocked++;record(symbol,'BLOCKED',{reason:'RESEARCH_RUNTIME_ERROR'});
  }finally{active.delete(symbol);}
 }
 function onSnapshot(s){
  if(!enabled)return {scheduled:false,reason:'AUTO_RESEARCH_DISABLED',...noOrders};
  if(!s||!['XAUUSD','BTCUSD'].includes(s.symbol))
   return {scheduled:false,reason:'UNSUPPORTED_SYMBOL',...noOrders};
  const symbol=s.symbol,now=clock();
  const checked=validateIsolatedDemoSnapshot(s,now);
  if(checked.status!=='VALIDATED_RESEARCH_SENSOR'||!checked.safe.multiTimeframeVerified){
   blocked++;record(symbol,'BLOCKED',{reason:'INVALID_BROKER_SNAPSHOT'});
   return {scheduled:false,reason:'INVALID_BROKER_SNAPSHOT',...noOrders};
  }
  const depth=checked.safe;
  // The MT5 EA sends a tiny signed heartbeat between complete M5 snapshots.
  // A heartbeat must never spend AI tokens on 2-16 bars or consume a candle trigger.
  if(depth.candlesM5.length<205||depth.candlesM15.length<30||
     depth.candlesH1.length<30||depth.candlesH4.length<25)
   return {scheduled:false,reason:'WAITING_DEEP_CLOSED_BARS',...noOrders};
  if(active.has(symbol))return {scheduled:false,reason:'MODEL_BUSY_FOR_SYMBOL',...noOrders};
  const clean=checked.safe;
  const bars=Object.fromEntries(Object.keys(durations).map(tf=>[tf,clean['candles'+tf]]));
  const trigger=scheduler.consider({symbol,now,quote:{bid:clean.bid,ask:clean.ask,
   time:clean.timestamp},bars,news:[]});
  if(!trigger.callAI)return {scheduled:false,reason:trigger.reason,...noOrders};
  active.add(symbol);scheduled++;
  record(symbol,'SCHEDULED',{trigger:trigger.reason,closedBarAt:utc(trigger.closedBarTime)});
  const task=Promise.resolve().then(()=>analyzeOne(s,trigger));
  tasks.add(task);void task.finally(()=>tasks.delete(task));
  return {scheduled:true,reason:trigger.reason,...noOrders};
 }
 async function flush(){await Promise.allSettled([...tasks]);}
 function report(){
  return {status:!enabled?'DISABLED':completed?'SHADOW_ANALYSIS_OBSERVED':
   scheduled?'AWAITING_AI_RESULT':'AWAITING_VERIFIED_M5_TRIGGER',
   enabled,mode:'AUTHENTICATED_DEMO_SHADOW_ONLY',scheduled,completed,blocked,
   persistenceFailures,active:[...active],lastBySymbol,
   newsTradingEnabled:false,brokerOrderRoutes:false,...noOrders};
 }
 return {onSnapshot,report,flush};
}
