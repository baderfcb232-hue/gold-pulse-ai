// Phase 7: independent EMA trend comparator for AI research WATCH plans.
// This is NOT a full FUSION replay. Never infer trading performance from agreement.
const FRAMES=['M5','M15','H1','H4'];
const SYMBOLS=['XAUUSD','BTCUSD'];
const stance=x=>['BUY_WATCH','SELL_WATCH','WAIT'].includes(x);
export function classifyEmaBaseline(features){
 if(!features||typeof features!=='object')return {stance:'UNVERIFIED',reason:'MISSING_TECHNICAL_FEATURES'};
 for(const tf of FRAMES){
  const f=features[tf];
  if(f?.status!=='INDICATORS_AVAILABLE'||
     f.ema200Verified!==true||
     !['UP','DOWN'].includes(f.emaDirection)||
     !Number.isFinite(f.ema200)||!Number.isFinite(f.lastClose))
   return {stance:'UNVERIFIED',reason:'INCOMPLETE_VERIFIED_TIMEFRAMES'};
 }
 const dirs=FRAMES.map(tf=>features[tf].emaDirection);
 if(!dirs.every(d=>d===dirs[0]))return {stance:'WAIT',reason:'EMA_TIMEFRAME_CONFLICT'};
 const direction=dirs[0];
 const m5=features.M5;
 if(direction==='UP'&&m5.lastClose>m5.ema200)
  return {stance:'BUY_WATCH',reason:'MULTIFRAME_EMA_UP'};
 if(direction==='DOWN'&&m5.lastClose<m5.ema200)
  return {stance:'SELL_WATCH',reason:'MULTIFRAME_EMA_DOWN'};
 return {stance:'WAIT',reason:'EMA200_TREND_CONFLICT'};
}
export function createPhase7Comparator({limit=100,clock=()=>Math.floor(Date.now()/1000)}={}){
 if(!Number.isSafeInteger(limit)||limit<1||limit>500)throw Error('INVALID_COMPARATOR_LIMIT');
 const rows=[],seen=new Set();let rejected=0,compared=0,matched=0,disagreed=0,unverified=0,aiWait=0;
 function compare({symbol,closedBarTime,plan,features}={}){
  if(!SYMBOLS.includes(symbol)||!Number.isSafeInteger(closedBarTime)||
    closedBarTime<=0||closedBarTime>clock()||
    !plan||!stance(plan.stance)||
    typeof plan.confidence!=='number'||!Number.isFinite(plan.confidence)||
    plan.confidence<0||plan.confidence>1){
   rejected++;return {accepted:false,reason:'INVALID_AI_COMPARISON'};
  }
  const id=symbol+':'+closedBarTime;
  if(seen.has(id)){rejected++;return {accepted:false,reason:'DUPLICATE_COMPARISON'};}
  if(seen.size>=10000){rejected++;return {accepted:false,reason:'COMPARATOR_CAPACITY_REACHED'};}
  const baseline=classifyEmaBaseline(features);
  const comparable=baseline.stance!=='UNVERIFIED';
  const agreement=comparable?(plan.stance===baseline.stance?'AGREED':'DISAGREED'):'UNVERIFIED';
  seen.add(id);compared++;
  if(agreement==='AGREED')matched++;
  else if(agreement==='DISAGREED')disagreed++;
  else unverified++;
  if(plan.stance==='WAIT')aiWait++;
  const row={symbol,closedBarTime,aiStance:plan.stance,emaBaseline:baseline.stance,
   baselineReason:baseline.reason,agreement};
  rows.push(row);if(rows.length>limit)rows.shift();
  return {accepted:true,...row,executionAllowed:false};
 }
 function report(){
  const markets={};
  for(const symbol of SYMBOLS){
   const sub=rows.filter(x=>x.symbol===symbol),valid=sub.filter(x=>x.agreement!=='UNVERIFIED');
   const agrees=valid.filter(x=>x.agreement==='AGREED').length;
   markets[symbol]={recentComparisons:sub.length,comparable:valid.length,
    agreements:agrees,disagreements:valid.length-agrees,
    agreementRate:valid.length>=30?Math.round(agrees/valid.length*10000)/100:null,
    sampleThreshold:30,insufficientSamples:valid.length<30};
  }
  return {status:'ISOLATED_STRATEGY_COMPARISON_ONLY',
   comparator:'EMA_8_21_200_M5_M15_H1_H4_PROXY_NOT_FULL_FUSION',
   markets,counts:{compared,matched,disagreed,unverified,aiWait,rejected},
   recent:rows.slice(-20).reverse().map(({symbol,aiStance,emaBaseline,baselineReason,agreement})=>
    ({symbol,aiStance,emaBaseline,baselineReason,agreement})),
   history:'IN_MEMORY_BOUNDED',sampleSizeBasedOnRecentWindow:true,
   outOfSampleEffectivenessVerified:false,aiAccuracyMeasuredHere:false,
   backtestVerified:false,tradeProfitabilityVerified:false,
   noAutoStrategySelection:true,ordersCreated:0,executionAllowed:false,
   liveTradingEnabled:false};
 }
 return {compare,report};
}
