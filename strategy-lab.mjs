// NABD Strategy Lab phase 15. Offline ONLY: never sends MT5 orders,
// publishes trading signals, changes the deployed strategy, or connects to Live.
// Historical source metadata comes from the uploader and is NOT broker attestation.
import {backtest} from './backtest.mjs';
import {TF_SECONDS} from './engine.mjs';
const supported=new Set(['XAUUSD','BTCUSD']);
const frames=['M5','M15','H1','H4'];
const fail=message=>{throw Error(message);};
const finitePositive=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;
const average=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
const round=v=>v==null?null:Number(v.toFixed(6));
export function validateLabDataset(dataset){
 if(!dataset||!supported.has(dataset.symbol))fail('Gold XAUUSD or Bitcoin BTCUSD history required');
 const origin=dataset.provenance;
 if(!origin||origin.format!=='MT5_HISTORY_EXPORT'||
   typeof origin.broker!=='string'||origin.broker.trim().length<2||
   typeof origin.server!=='string'||origin.server.trim().length<2||
   !Number.isFinite(origin.exportedAt)||
   /(?:fixture|synthetic|generated|simulat)/i.test(origin.broker+' '+origin.server))
  fail('Explicit declared MT5 broker provenance required; synthetic data is never presented as real history');
 if(!dataset.candles||typeof dataset.candles!=='object')fail('Complete broker timeframes required');
 const counts={},gaps={};
 for(const tf of frames){
  const arr=dataset.candles[tf],step=TF_SECONDS[tf];
  if(!Array.isArray(arr)||arr.length<(tf==='M5'?530:320)||arr.length>500000)
    fail(tf+' requires sufficient non-synthetic broker history');
  let previous=-Infinity,gap=0;
  for(const c of arr){
   if(!c||!Number.isSafeInteger(c.time)||c.time<=previous||
     ![c.open,c.high,c.low,c.close].every(finitePositive)||
     c.low>Math.min(c.open,c.close)||c.high<Math.max(c.open,c.close)||
     c.high<c.low)fail('Invalid / future-leaking or unordered '+tf+' OHLC data');
   if(previous!==-Infinity&&c.time-previous>step*1.5)gap++;
   previous=c.time;
  }
  if(arr.at(-1).time+step>origin.exportedAt)
   fail('Unclosed '+tf+' candle is present after claimed export time');
  counts[tf]=arr.length;gaps[tf]=gap;
 }
 if(!dataset.spec||!finitePositive(dataset.spec.point)||
   !finitePositive(dataset.spec.tick_size)||!finitePositive(dataset.spec.tick_value_loss))
   fail('Broker point/tick size/tick value required for monetary risk metrics');
 for(const field of ['spread_points','commission_per_lot','slippage_points']){
  if(!Number.isFinite(dataset[field])||dataset[field]<0)
   fail('Explicit nonnegative '+field+' assumption required');
 }
 if(!dataset.broker_symbol||typeof dataset.broker_symbol!=='string')
  fail('Exact broker symbol (including .m suffix, if any) required');
 return {counts,gaps,provenanceStatus:'DECLARED_NOT_INDEPENDENTLY_VERIFIED'};
}
function getIndex(rows,time){
 let lo=0,hi=rows.length;
 while(lo<hi){const mid=(lo+hi)>>1;if(rows[mid].time<time)lo=mid+1;else hi=mid;}
 return lo;
}
export function tradeMetrics(report){
 const trades=report.trades||[],risks=trades.map(t=>Number(t.net_r)).filter(Number.isFinite);
 const good=trades.filter(t=>Number(t.net_r)>0),bad=trades.filter(t=>Number(t.net_r)<0);
 const grossGain=good.reduce((n,t)=>n+t.net_r,0),grossLoss=-bad.reduce((n,t)=>n+t.net_r,0);
 const duration=trades.map(t=>t.ended_at-(t.issued_at??t.bar_time)).filter(x=>Number.isFinite(x)&&x>=0);
 const rr=trades.map(t=>{
   const risk=Math.abs(t.entry-t.sl);
   return risk>0?Math.abs(t.tp2-t.entry)/risk:null;
 }).filter(Number.isFinite);
 const buckets={'< -2R':0,'-2..-1R':0,'-1..0R':0,'0..1R':0,'1..2R':0,'>= 2R':0};
 for(const n of risks){
  const k=n< -2?'< -2R':n< -1?'-2..-1R':n<0?'-1..0R':n<1?'0..1R':n<2?'1..2R':'>= 2R';
  buckets[k]++;
 }
 let net=0,peak=0,drawdown=0;
 for(const n of risks){net+=n;peak=Math.max(peak,net);drawdown=Math.max(drawdown,peak-net);}
 return {trades:trades.length,winRate:trades.length?round(good.length/trades.length):null,
  netR:round(net),profitFactor:grossLoss>0?round(grossGain/grossLoss):null,
  maxDrawdownR:round(drawdown),meanDurationSeconds:round(average(duration)),
  meanNetR:round(average(risks)),meanPlannedRR:round(average(rr)),
  netPerLotCurrency:round(trades.reduce((n,t)=>n+Number(t.net_per_lot||0),0)),
  distribution:buckets};
}
function makeWindow(dataset,startIndex,endIndex){
 if(startIndex<220||endIndex-startIndex<25)fail('Insufficient train or out-of-sample bars after warmup');
 const m5=dataset.candles.M5,first=m5[startIndex],last=m5[endIndex-1];
 const candles={M5:m5.slice(startIndex-220,endIndex)};
 for(const tf of frames.slice(1))candles[tf]=dataset.candles[tf].filter(c=>c.time+TF_SECONDS[tf]<=last.time+300);
 return {...dataset,candles,calendar:{status:'disabled',events:[]}};
}
function exec(dataset,timeframePolicy){
 return backtest(dataset,{allowMissingNews:true,timeframePolicy});
}
function normalizeTimes(times,history){
 const start=times?.from==null?history[220].time:Number(times.from);
 const end=times?.to==null?history.at(-1).time+300:Number(times.to);
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=end)fail('Invalid requested time range');
 return {start,end};
}
export function runStrategyLab(dataset,{from,to,timeframe='M5',trainFraction=0.7,stressMultiplier=1.5}={}){
 const quality=validateLabDataset(dataset);
 if(timeframe!=='M5')fail('This engine executes on M5; M15/H1/H4 provide closed-bar context only');
 if(!Number.isFinite(trainFraction)||trainFraction<0.5||trainFraction>0.85)
  fail('Training fraction must be 50–85%');
 if(!Number.isFinite(stressMultiplier)||stressMultiplier<1||stressMultiplier>3)
  fail('Invalid spread, slippage and commission stress multiplier');
 const rows=dataset.candles.M5,{start,end}=normalizeTimes({from,to},rows);
 const first=getIndex(rows,start),last=getIndex(rows,end);
 if(first<220||last-first<80)fail('Not enough closed M5 history for separated training and OOS evaluation');
 // Refuse a requested two-year window when the exported broker data silently
 // covers only a fraction of that period.
 if((from!=null && rows[first]?.time>start+5*86400) ||
    (to!=null && rows[last-1]?.time+300<end-5*86400))
   fail('Requested dates are not covered by this MT5 history');
 for(let i=first+1;i<last;i++)
   if(rows[i].time-rows[i-1].time>7*86400)
     fail('History gap longer than seven days; refresh broker candle archives');
 const split=first+Math.floor((last-first)*trainFraction);
 const windows={development:makeWindow(dataset,first,split),outOfSample:makeWindow(dataset,split,last)};
 const result={};
 for(const [name,data] of Object.entries(windows)){
  result[name]={start:data.candles.M5[220].time,
    end:data.candles.M5.at(-1).time+300,
    baseline:tradeMetrics(exec(data,'STRICT')),
    experimental:tradeMetrics(exec(data,'FLEX_NEUTRAL'))};
 }
 // Sensitivity is evaluated only on held-out bars; the strategy is never
 // optimized or automatically selected using the OOS result.
 const stress={...windows.outOfSample,
  spread_points:dataset.spread_points*stressMultiplier,
  slippage_points:dataset.slippage_points*stressMultiplier,
  commission_per_lot:dataset.commission_per_lot*stressMultiplier};
 result.outOfSample.stress={
  multiplier:stressMultiplier,
  baseline:tradeMetrics(exec(stress,'STRICT')),
  experimental:tradeMetrics(exec(stress,'FLEX_NEUTRAL'))};
 return {kind:'NABD_OFFLINE_STRATEGY_LAB_V1',symbol:dataset.symbol,
  brokerSymbol:dataset.broker_symbol,executionTimeframe:'M5',
  historyFrames:frames,quality:{...quality,broker:dataset.provenance.broker,
    server:dataset.provenance.server,exportedAt:dataset.provenance.exportedAt},
  assumptions:{spreadPoints:dataset.spread_points,slippagePoints:dataset.slippage_points,
    roundTripCommissionPerLot:dataset.commission_per_lot,
    costsStressedBy:stressMultiplier,news:'DISABLED: no authenticated as-of news replay',
    fillModel:'OHLC, stop first when target and stop both touched',
    strategyVersions:'Existing STRICT baseline vs FLEX_NEUTRAL experimental dashboard policy, not MT5 EA',
    tradingEnabled:false,autoApproval:false},
  split:{requestedFrom:start,requestedTo:end,developmentUntil:result.development.end,
    outOfSampleFrom:result.outOfSample.start,nonOverlapping:true},
  results:result,
  warnings:['User-supplied MT5 export provenance is not independently broker-verified',
   'Historical candles may have gaps and broker spread/fees may vary',
   'No historical calendar/news as-of replay; news filter is explicitly disabled',
   'Offline modeled fills differ from real MT5 execution and latency',
   'Normalized 1-lot currency totals are not account P&L or executed trades',
   'Never publish a strategy based solely on backtest performance']};
}
