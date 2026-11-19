// NABD Phase15: historical PAPER replay of the EXACT experimental AI brain.
// No MT5 link, no bridge, no trading routes, no real news. Historical MT5 export
// is user-declared; prices are MODELED at closed-bar time (not broker tick quotes).
import {createHash} from 'node:crypto';
import {multiTimeframeFeatures} from './market-features.mjs';
import {createResearchBrain} from './research-brain.mjs';
import {validateHistoricalResearchContext} from './historical-replay-context.mjs';
const steps=Object.freeze({M5:300,M15:900,H1:3600,H4:14400});
const frames=Object.keys(steps);
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const good=n=>finite(n)&&n>0;
const fail=reason=>{throw Error(reason);};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const safeRound=n=>finite(n)?Number(n.toFixed(6)):null;
function lowerBound(bars,at){
 let lo=0,hi=bars.length;
 while(lo<hi){const mid=(lo+hi)>>1; if(bars[mid].time<at)lo=mid+1;else hi=mid;}
 return lo;
}
function closedEnd(bars,at,seconds){
 let lo=0,hi=bars.length;
 while(lo<hi){const mid=(lo+hi)>>1; if(bars[mid].time+seconds<=at)lo=mid+1;else hi=mid;}
 return lo;
}
export function validateHistoricalReplayDataset(dataset){
 if(!dataset||!['XAUUSD','BTCUSD'].includes(dataset.symbol))
   fail('Gold XAUUSD or Bitcoin BTCUSD MT5 export required');
 const p=dataset.provenance;
 if(p?.format!=='MT5_HISTORY_EXPORT'||!good(p.exportedAt)||
    typeof p.broker!=='string'||p.broker.trim().length<2||
    typeof p.server!=='string'||p.server.trim().length<2||
    /synthetic|fixture|generated|simulat/i.test(p.broker+' '+p.server)||
    typeof dataset.broker_symbol!=='string'||
    !dataset.broker_symbol.startsWith(dataset.symbol))
   fail('Explicit user-declared historical MT5 broker export required');
 if(!dataset.candles||typeof dataset.candles!=='object')fail('Four broker timeframes required');
 for(const [tf,seconds] of Object.entries(steps)){
  const bars=dataset.candles[tf];
  if(!Array.isArray(bars)||bars.length<(tf==='M5'?700:230)||bars.length>550000)
   fail(tf+' historical candle history incomplete');
  let prior=-Infinity;
  for(const bar of bars){
   if(!bar||!Number.isSafeInteger(bar.time)||bar.time<=prior||
      !['open','high','low','close'].every(field=>good(bar[field]))||
      bar.high<Math.max(bar.open,bar.close)||bar.low>Math.min(bar.open,bar.close))
     fail('Malformed / non-ascending '+tf+' history');
   prior=bar.time;
  }
  if(prior+seconds>p.exportedAt)fail('Open '+tf+' candle after claimed export timestamp');
 }
 if(!good(dataset.spec?.point)||!good(dataset.spec?.tick_size)||
    !good(dataset.spec?.tick_value_loss))
   fail('Broker point, tick size and tick value must be explicit');
 for(const prop of ['spread_points','slippage_points','commission_per_lot'])
  if(!finite(dataset[prop])||dataset[prop]<0)fail('Explicit nonnegative '+prop+' required');
 return {provenance:'USER_DECLARED_UNVERIFIED',closedFrames:frames,brokerSymbol:dataset.broker_symbol};
}
export function buildHistoricalBrainContext(dataset,asOf){
 if(!Number.isSafeInteger(asOf)||asOf<=0)fail('Historical as-of UTC second required');
 const bars={},evidence={};
 for(const [tf,seconds] of Object.entries(steps)){
  const history=dataset.candles[tf],end=closedEnd(history,asOf,seconds);
  const deep=history.slice(Math.max(0,end-220),end);
  if(deep.length<205)fail('WAITING_CLOSED_'+tf+'_HISTORY');
  // Detect missing recent broker history; do not pretend closed but old candles
  // are a fresh price snapshot at the replay timestamp.
  if(asOf-(deep.at(-1).time+seconds)>seconds*2)
   fail('STALE_HISTORICAL_'+tf);
  evidence[tf]=deep;
  bars[tf]=deep.slice(-(tf==='M5'?40:tf==='M15'?32:24));
 }
 const features=multiTimeframeFeatures(Object.fromEntries(
   frames.map(tf=>['candles'+tf,evidence[tf]])));
 if(frames.some(tf=>features[tf].ema200Verified!==true))
  fail('EMA200_UNVERIFIED');
 const closed=dataset.candles.M5[closedEnd(dataset.candles.M5,asOf,300)-1];
 if(!closed||closed.time+300!==asOf)fail('NOT_A_M5_CANDLE_CLOSE');
 const spread=dataset.spread_points*dataset.spec.point;
 if(!good(spread))fail('MODELED_SPREAD_MUST_BE_POSITIVE');
 const context={
  symbol:dataset.symbol,feedType:'MT5_HISTORICAL_PAPER_REPLAY',
  accountType:'PAPER',observedAt:asOf,priceKind:'MODELED_FROM_CLOSED_M5',
  provenanceStatus:'USER_DECLARED_UNVERIFIED',
  bid:closed.close,ask:closed.close+spread,spreadLimit:spread*1.01,
  candlesVerified:true,multiTimeframeVerified:true,
  candlesM5:bars.M5,candlesM15:bars.M15,candlesH1:bars.H1,candlesH4:bars.H4,
  technicalEvidence:multiTimeframeFeatures(Object.fromEntries(
   frames.map(tf=>['candles'+tf,evidence[tf]]))),
  news:{classification:'NONE'}
 };
 const verified=validateHistoricalResearchContext(context,asOf);
 if(verified.status!=='RESEARCH_CONTEXT_READY')
   fail('HISTORICAL_CONTEXT_REJECTED:'+verified.reasons.join(','));
 return context;
}
function selectReplayWindows(dataset,{from,to,folds=3,warmupFraction=0.4,maxCalls=12}={}){
 const bars=dataset.candles.M5;
 if(!Number.isSafeInteger(folds)||folds<2||folds>6||
    !Number.isSafeInteger(maxCalls)||maxCalls<folds||maxCalls>60||
    !finite(warmupFraction)||warmupFraction<0.25||warmupFraction>0.7)
  fail('Replay fold/sampling budget is outside safe limits');
 const start=from==null?bars[300].time:Number(from);
 const end=to==null?bars.at(-1).time+300:Number(to);
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=end)
  fail('Invalid replay date window');
 const first=lowerBound(bars,start),last=lowerBound(bars,end);
 if(first<300||last-first<folds*90)
  fail('Insufficient closed M5 history or warmup for separated folds');
 if((from!=null&&bars[first]?.time>start+5*86400)||
    (to!=null&&bars[last-1]?.time+300<end-5*86400))
  fail('Replay request not covered by historical export');
 for(let i=first+1;i<last;i++){
  if(bars[i].time-bars[i-1].time>7*86400)
   fail('Historical gap longer than seven days');
 }
 const oosStart=first+Math.floor((last-first)*warmupFraction);
 const candidates=Array.from({length:folds},(_,fold)=>{
  const a=oosStart+Math.floor((last-oosStart)*fold/folds),
        b=oosStart+Math.floor((last-oosStart)*(fold+1)/folds);
  if(b-a<30)fail('Insufficient independent fold history');
  return {fold:fold+1,developmentStart:bars[first].time,
   developmentEnd:bars[a-1].time+300,evaluationFrom:bars[a].time+300,
   evaluationTo:bars[b-1].time+300,indices:[a,b]};
 });
 const each=Math.floor(maxCalls/folds),extra=maxCalls%folds;
 let prev=-1;
 const picks=[];
 for(const window of candidates){
  const [firstBar,lastBar]=window.indices;
  const limit=each+(window.fold<=extra?1:0);
  for(let j=0;j<limit;j++){
   // Stratifed deterministic selection across each held-out interval.
   const index=firstBar+Math.floor((j+.5)*(lastBar-firstBar)/limit);
   if(index<=prev||index>=lastBar)fail('Historical samples overlap');
   prev=index;
   picks.push({fold:window.fold,index,asOf:bars[index].time+300});
  }
  delete window.indices;
 }
 return {folds:candidates,picks,from:start,to:end,
  modelSelection:'LOCKED_BEFORE_OOS',trainingPerformed:false,nonOverlapping:true};
}
function forwardObservation(dataset,index,plan){
 if(plan.stance==='WAIT')return {outcome:'WAIT',netPerLot:null,executed:false};
 const side=plan.stance==='BUY_WATCH'?'BUY':'SELL',
   m5=dataset.candles.M5,horizonBars=Math.max(1,Math.ceil(plan.timeHorizonMinutes/5));
 const entryBar=m5[index+1],exitBar=m5[index+horizonBars];
 if(!entryBar||!exitBar||exitBar.time-entryBar.time>(horizonBars+1)*300)
   return {outcome:'HORIZON_DATA_MISSING',netPerLot:null,executed:false};
 const spread=dataset.spread_points*dataset.spec.point,
   slip=dataset.slippage_points*dataset.spec.point;
 const entry=side==='BUY'?entryBar.open+spread+slip:entryBar.open-slip;
 const exit=side==='BUY'?exitBar.close-slip:exitBar.close+spread+slip;
 const gross=(side==='BUY'?1:-1)*(exit-entry);
 const netPerLot=gross/dataset.spec.tick_size*dataset.spec.tick_value_loss-
   dataset.commission_per_lot;
 return {outcome:netPerLot>0?'FAVORABLE_HYPOTHESIS':'UNFAVORABLE_HYPOTHESIS',
  horizonMinutes:horizonBars*5,entryPriceModeled:safeRound(entry),
  exitPriceModeled:safeRound(exit),netPerLot:safeRound(netPerLot),
  executed:false,brokerFillConfirmed:false};
}
export async function replayHistoricalAgentic(dataset,{
 from,to,folds=3,warmupFraction=0.4,maxCalls=12,
 runModel=false,key='',model='gpt-4.1-mini',fetcher
}={}){
 const quality=validateHistoricalReplayDataset(dataset);
 const schedule=selectReplayWindows(dataset,{from,to,folds,warmupFraction,maxCalls});
 if(runModel&&(!key||typeof key!=='string'))
   fail('Explicit isolated AI model key is required for billable replay');
 const samples=[];let simulatedTime=0;
 const brain=createResearchBrain({
  key:runModel?key:'',model,clock:()=>simulatedTime,
  contextMode:'HISTORICAL_PAPER',...(fetcher?{fetcher}:{})
 });
 for(const p of schedule.picks){
  simulatedTime=p.asOf;
  let ctx=null,result=null,forward=null,reason=null;
  try{
   ctx=buildHistoricalBrainContext(dataset,p.asOf);
   if(runModel){
    result=await brain.analyze(ctx);
    if(result.status==='RESEARCH_ANALYSIS_ONLY'&&result.plan)
     forward=forwardObservation(dataset,p.index,result.plan);
    else reason=result.reasons?.join(',')||'AI_ANALYSIS_NOT_COMPLETED';
   }else reason='MODEL_NOT_RUN_OPT_IN_REQUIRED';
  }catch(error){reason=String(error.message||error).slice(0,140);}
  samples.push({fold:p.fold,asOf:p.asOf,symbol:dataset.symbol,
   contextSha256:ctx?hash(ctx):null,contextMode:'HISTORICAL_PAPER',
   stance:result?.plan?.stance||'WAIT',confidence:result?.plan?.confidence??null,
   thesis:result?.plan?.thesis||null,counterThesis:result?.plan?.counterThesis||null,
   evidence:result?.plan?.evidence||[],invalidation:result?.plan?.invalidation||null,
   riskNotes:result?.plan?.riskNotes||null,forward,blockedReason:reason,
   executionAllowed:false,order:null});
 }
 const foldReports=schedule.folds.map(w=>{
  const items=samples.filter(x=>x.fold===w.fold);
  const observed=items.filter(x=>x.forward?.netPerLot!=null);
  const favorable=observed.filter(x=>x.forward.netPerLot>0);
  return {...w,sampled:items.length,modelCompleted:items.filter(x=>x.thesis!=null).length,
   directionalHypotheses:observed.length,waited:items.filter(x=>x.stance==='WAIT').length,
   modeledFavorableShare:observed.length?safeRound(favorable.length/observed.length):null,
   modeledNetPerLot:observed.length?safeRound(observed.reduce((n,x)=>n+x.forward.netPerLot,0)):null};
 });
 return {kind:'NABD_AGENTIC_HISTORICAL_PAPER_DIAGNOSTIC_V1',
  symbol:dataset.symbol,brokerSymbol:dataset.broker_symbol,quality,
  assumedCosts:{spreadPoints:dataset.spread_points,
    slippagePoints:dataset.slippage_points,commissionPerLot:dataset.commission_per_lot},
  schedule:{from:schedule.from,to:schedule.to,foldCount:folds,
    sampleBudget:maxCalls,modelSelection:schedule.modelSelection,
    trainingPerformed:false,nonOverlapping:true},
  brain:{model,actualModelInvoked:runModel,invocationCount:brain.report().runs,
    simulationOnly:true,noOrders:true,brokerConnected:false},
  folds:foldReports,samples,
  warnings:[
   'Historical model evaluation is NOT a reliable profitability backtest: model weights may contain post-period knowledge',
   'User-declared MT5 export is not independently broker attested',
   'Quotes and fills are synthetic close/open-based scenarios with constant spread/slippage/fees',
   'No verified historical economic release-time actual/forecast data; historical news are disabled',
   'Sampled hypothetical directional hypotheses are not EA trades, entries, stops, broker fills or actual PnL',
   'No learning/optimization/tuning occurs on held-out OOS folds; model version and prompt must be pinned externally',
   'Use prospective MT5 Demo paper-forward decisions for credible performance evaluation',
   'No API calls unless runModel is explicitly enabled with an isolated key'
  ],tradingEnabled:false,executionPermission:false,autoApproveStrategy:false};
}
