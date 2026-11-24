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
  vwap:null,vwapReason:'VERIFIED_VOLUME_NOT_REQUIRED_OR_AVAILABLE',
  supertrend:null,supertrendReason:'NOT_IMPLEMENTED_IN_THIS_ADAPTER'};
}
export function buildFusionEvidence(snapshot){
 return {version:'FUSION_STYLE_EVIDENCE_V1',advisoryOnly:true,fullProductionFusion:false,
  frames:Object.fromEntries(['M5','M15','H1','H4'].map(tf=>[tf,frameEvidence(snapshot?.['candles'+tf])]))};
}
