// Deterministic features from validated, CLOSED, broker DEMO candles only.
// Research evidence; no price forecasts, no trade recommendation or order.
const round=n=>Number.isFinite(n)?Number(n.toPrecision(8)):null;
function ema(values,period){
 if(values.length<period)return null;
 let out=values.slice(0,period).reduce((a,b)=>a+b,0)/period;
 const a=2/(period+1);
 for(let i=period;i<values.length;i++)out=values[i]*a+out*(1-a);
 return round(out);
}
function rsi(values,period=14){
 if(values.length<period+1)return null;
 let gain=0,loss=0;
 for(let i=1;i<=period;i++){
  const diff=values[i]-values[i-1];gain+=Math.max(0,diff);loss+=Math.max(0,-diff);
 }
 gain/=period;loss/=period;
 for(let i=period+1;i<values.length;i++){
  const diff=values[i]-values[i-1];
  gain=(gain*(period-1)+Math.max(0,diff))/period;
  loss=(loss*(period-1)+Math.max(0,-diff))/period;
 }
 return round(loss===0?(gain===0?50:100):100-100/(1+gain/loss));
}
function atr(bars,period=14){
 if(bars.length<period+1)return null;
 const tr=[];
 for(let i=1;i<bars.length;i++){
  const c=bars[i],prev=bars[i-1].close;
  tr.push(Math.max(c.high-c.low,Math.abs(c.high-prev),Math.abs(c.low-prev)));
 }
 return round(tr.slice(-period).reduce((a,b)=>a+b,0)/period);
}
export function calculateClosedCandleFeatures(bars){
 if(!Array.isArray(bars)||!bars.length)return {status:'NO_CLOSED_CANDLES'};
 if(bars.some((b,i)=>!b||!Number.isSafeInteger(b.time)||
  ![b.open,b.high,b.low,b.close].every(x=>Number.isFinite(x)&&x>0)||
  b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||
  (i>0&&b.time<=bars[i-1].time)))return {status:'INVALID_CANDLES'};
 const closes=bars.map(b=>b.close),last=bars.at(-1);
 const e8=ema(closes,8),e21=ema(closes,21),e200=ema(closes,200);
 const recent=bars.slice(-20);
 return {status:bars.length>=22?'INDICATORS_AVAILABLE':'INSUFFICIENT_HISTORY',
  candles:bars.length,lastClose:round(last.close),lastClosedBarStart:last.time,
  ema8:e8,ema21:e21,ema200:e200,rsi14:rsi(closes),atr14:atr(bars),
  prior20High:recent.length===20?round(Math.max(...recent.map(b=>b.high))):null,
  prior20Low:recent.length===20?round(Math.min(...recent.map(b=>b.low))):null,
  emaDirection:e8===null||e21===null?'UNVERIFIED':e8>e21?'UP':e8<e21?'DOWN':'FLAT',
  ema200Verified:e200!==null};
}
export function multiTimeframeFeatures(snapshot){
 return Object.fromEntries(['M5','M15','H1','H4'].map(tf=>[
  tf,calculateClosedCandleFeatures(snapshot['candles'+tf])]));
}
