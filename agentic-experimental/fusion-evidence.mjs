// Isolated research evidence, not the production FUSION implementation.
// No order routes, no votes that override the AI, no fabricated volume.
import {calculateClosedCandleFeatures} from './market-features.mjs';
const round=x=>Number.isFinite(x)?Number(x.toPrecision(8)):null;
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
function emaSeries(a,n){
 if(a.length<n)return [];
 let v=mean(a.slice(0,n));const out=[v],k=2/(n+1);
 for(const x of a.slice(n)){v+=k*(x-v);out.push(v);}
 return out;
}
// Wilder ATR(10), multiplier 3, final bands carried forward from closed bars.
export function supertrend(bars,period=10,multiplier=3){
 if(bars.length<period+1)return null;
 const tr=bars.slice(1).map((b,i)=>Math.max(b.high-b.low,Math.abs(b.high-bars[i].close),Math.abs(b.low-bars[i].close)));
 let atr=mean(tr.slice(0,period)),upper,lower,line,direction;
 for(let i=period;i<bars.length;i++){
  if(i>period)atr=(atr*(period-1)+tr[i-1])/period;
  const b=bars[i],mid=(b.high+b.low)/2,bu=mid+multiplier*atr,bl=mid-multiplier*atr;
  if(i===period){upper=bu;lower=bl;direction='DOWN';line=upper;continue;}
  const prev=bars[i-1].close;
  upper=bu<upper||prev>upper?bu:upper;
  lower=bl>lower||prev<lower?bl:lower;
  direction=direction==='DOWN'?(b.close>upper?'UP':'DOWN'):(b.close<lower?'DOWN':'UP');
  line=direction==='UP'?lower:upper;
 }
 return {period,multiplier,direction,line:round(line),atr:round(atr)};
}
// Rolling closed-bar VWAP approximation using typical price. Never mix volume types.
export function rollingVwap(bars,period=20){
 if(!Array.isArray(bars)||bars.length<period)return {vwap:null,vwapReason:'INSUFFICIENT_HISTORY'};
 const window=bars.slice(-period);
 const complete=key=>window.every(b=>Number.isSafeInteger(b[key])&&b[key]>0);
 const key=complete('realVolume')?'realVolume':complete('tickVolume')?'tickVolume':null;
 if(!key)return {vwap:null,vwapReason:'VERIFIED_VOLUME_NOT_REQUIRED_OR_AVAILABLE'};
 const total=window.reduce((a,b)=>a+b[key],0);
 const price=window.reduce((a,b)=>a+(b.high+b.low+b.close)/3*b[key],0)/total;
 if(!Number.isFinite(price)||price<=0)return {vwap:null,vwapReason:'INVALID_WEIGHTED_PRICE'};
 return {vwap:{value:round(price),period,method:'ROLLING_CLOSED_BAR_TYPICAL_PRICE',volumeSource:key==='realVolume'?'BROKER_REPORTED_REAL_VOLUME':'BROKER_TICK_ACTIVITY_PROXY',closeRelative:window.at(-1).close>price?'ABOVE':window.at(-1).close<price?'BELOW':'AT'},vwapReason:null};
}
export function frameEvidence(bars){
 const f=calculateClosedCandleFeatures(bars);
 if(f.status!=='INDICATORS_AVAILABLE')return {status:f.status};
 const last=bars.at(-1),prev=bars.at(-2),c=bars.map(b=>b.close);
 const channel=n=>{
  if(bars.length<=n)return null;
  const prior=bars.slice(-n-1,-1),high=Math.max(...prior.map(b=>b.high)),low=Math.min(...prior.map(b=>b.low));
  return {high:round(high),low:round(low),closeBreak:last.close>high?'ABOVE':last.close<low?'BELOW':'INSIDE'};
 };
 const tail=c.slice(-20),mid=mean(tail),sd=Math.sqrt(mean(tail.map(x=>(x-mid)**2)));
 const fast=emaSeries(c,12),slow=emaSeries(c,26);
 const macd=slow.map((x,i)=>fast[i+14]-x),signal=emaSeries(macd,9);
 const stochBars=bars.slice(-14),hi=Math.max(...stochBars.map(b=>b.high)),lo=Math.min(...stochBars.map(b=>b.low));
 const range=last.high-last.low;
 return {status:'RESEARCH_EVIDENCE_ONLY',trend:{emaDirection:f.emaDirection,ema200:f.ema200,rsi14:f.rsi14,atr14:f.atr14},
  turtle20:channel(20),turtle55:channel(55),
  bollinger20:{middle:round(mid),upper:round(mid+2*sd),lower:round(mid-2*sd),z:sd>0?round((last.close-mid)/sd):null},
  macd:signal.length?{line:round(macd.at(-1)),signal:round(signal.at(-1)),histogram:round(macd.at(-1)-signal.at(-1))}:null,
  stochasticK14:hi>lo?round(100*(last.close-lo)/(hi-lo)):null,
  priceAction:{bodyFraction:range>0?round(Math.abs(last.close-last.open)/range):null,
   direction:last.close>last.open?'UP':last.close<last.open?'DOWN':'FLAT',
   previousHighBroken:last.close>prev.high,previousLowBroken:last.close<prev.low},
  ...rollingVwap(bars),
  supertrend:supertrend(bars)};
}
export function buildFusionEvidence(snapshot){
 return {version:'FUSION_STYLE_EVIDENCE_V3',advisoryOnly:true,fullProductionFusion:false,
  frames:Object.fromEntries(['M5','M15','H1','H4'].map(tf=>[tf,frameEvidence(snapshot?.['candles'+tf])]))};
}
