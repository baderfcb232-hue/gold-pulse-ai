// Independent OHLC research observations. No orders or execution authority.
const round=x=>Number.isFinite(x)?Number(x.toPrecision(8)):null;
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const valid=(a,d,t)=>Number.isSafeInteger(t)&&Array.isArray(a)&&a.length>0&&a.every((b,i)=>b&&Number.isSafeInteger(b.time)&&b.time>0&&b.time%d===0&&b.time+d<=t&&[b.open,b.high,b.low,b.close].every(x=>Number.isFinite(x)&&x>0)&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)&&(!i||b.time>a[i-1].time))&&t-a.at(-1).time-d<=d*2;
const ny=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function local(t){const p=Object.fromEntries(ny.formatToParts(new Date(t*1000)).map(x=>[x.type,x.value]));return {date:p.year+'-'+p.month+'-'+p.day,minute:Number(p.hour)*60+Number(p.minute)};}
function volumeKey(a){return ['realVolume','tickVolume'].find(k=>a.every(b=>Number.isSafeInteger(b[k])&&b[k]>0));}
const source=k=>k==='realVolume'?'BROKER_REPORTED_REAL_VOLUME':'BROKER_TICK_ACTIVITY_PROXY';
function ema(a,n){if(a.length<n)return null;let x=mean(a.slice(0,n).map(b=>b.close));for(const b of a.slice(n))x+=(b.close-x)*2/(n+1);return x;}
export function frameExtras(bars,d,asOf){
 if(!valid(bars,d,asOf))return null;
 const a=bars,last=a.at(-1),prev=a.at(-2);
 const e=ema(a,12);
 let efficiency=null,chandelier=null,structure=null;
 if(a.length>=21){
  const tail=a.slice(-21),path=tail.slice(1).reduce((s,b,i)=>s+Math.abs(b.close-tail[i].close),0);
  efficiency=path===0?0:round(Math.abs(last.close-tail[0].close)/path);
 }
 if(a.length>=23){
  const tail=a.slice(-22),tr=a.slice(1).map((b,i)=>Math.max(b.high-b.low,Math.abs(b.high-a[i].close),Math.abs(b.low-a[i].close)));
  let atr=mean(tr.slice(0,22));for(const v of tr.slice(22))atr=(atr*21+v)/22;
  chandelier={period:22,multiplier:3,longReference:round(Math.max(...tail.map(b=>b.high))-3*atr),shortReference:round(Math.min(...tail.map(b=>b.low))+3*atr),method:'RAW_CHANDELIER_REFERENCE_NOT_ACTIVE_STOP'};
 }
 // Two right-hand closed candles confirm a pivot BEFORE the evaluated bar.
 if(a.length>=7){
  let hi=null,lo=null;
  for(let i=2;i<a.length-3;i++){
   const b=a[i],neighbors=[a[i-2],a[i-1],a[i+1],a[i+2]];
   if(neighbors.every(x=>b.high>x.high))hi=b.high;
   if(neighbors.every(x=>b.low<x.low))lo=b.low;
  }
  structure={priorConfirmedSwingHigh:round(hi),priorConfirmedSwingLow:round(lo),
   break:hi!==null&&prev.close<=hi&&last.close>hi?'UP':lo!==null&&prev.close>=lo&&last.close<lo?'DOWN':'NONE',
   retest:hi!==null&&prev.close>hi&&last.low<=hi&&last.close>hi?'UP':lo!==null&&prev.close<lo&&last.high>=lo&&last.close<lo?'DOWN':'NONE',
   method:'CONFIRMED_PIVOT_OHLC_PROXY_NOT_ORDER_FLOW'};
 }
 return {ema12:round(e),ema12Relation:e===null?null:last.close>e?'ABOVE':last.close<e?'BELOW':'AT',kaufmanEfficiency20:efficiency,chandelier,structure};
}
export function nySession(bars,asOf){
 const unavailable=reason=>({status:reason,openingRange15:null,firstFive:null,anchoredVwap:null,relativeVolumeAtTime:null,relativeVolumeReason:'NEEDS_AT_LEAST_5_COMPARABLE_PRIOR_SESSIONS'});
 if(!valid(bars,300,asOf))return unavailable('INVALID_OR_STALE_M5');
 const last=bars.at(-1),today=local(last.time);
 if(today.minute<570||today.minute>=960)return unavailable('OUTSIDE_NY_CASH_SESSION');
 const annotated=bars.map(b=>({b,...local(b.time)}));
 const session=annotated.filter(x=>x.date===today.date&&x.minute>=570&&x.minute<960).map(x=>x.b);
 if(!session.length||local(session[0].time).minute!==570||session.some((b,i)=>i&&b.time-session[i-1].time!==300))return unavailable('INCOMPLETE_SESSION_HISTORY');
 const first= session[0],opening= session.slice(0,3);
 const firstIndex=bars.findIndex(b=>b.time===first.time),e=ema(bars.slice(0,firstIndex+1),12);
 let openingRange15=null;
 if(opening.length===3){
  const high=Math.max(...opening.map(b=>b.high)),low=Math.min(...opening.map(b=>b.low));
  openingRange15={high:round(high),low:round(low),closeBreak:session.length===3?'NOT_YET_EVALUATED':last.close>high?'ABOVE':last.close<low?'BELOW':'INSIDE'};
 }
 const k=volumeKey(session);
 let anchoredVwap=null;
 if(k){const total=session.reduce((s,b)=>s+b[k],0);anchoredVwap={value:round(session.reduce((s,b)=>s+(b.high+b.low+b.close)/3*b[k],0)/total),volumeSource:source(k),anchor:first.time,method:'NY_0930_CLOSED_BAR_TYPICAL_PRICE'};}
 const comparable=annotated.filter(x=>x.date<today.date&&x.minute===today.minute).map(x=>x.b).slice(-20);
 const rk=comparable.length>=5?volumeKey([...comparable,last]):null;
 const relativeVolumeAtTime=rk?{ratio:round(last[rk]/mean(comparable.map(b=>b[rk]))),priorSessions:comparable.length,volumeSource:source(rk)}:null;
 return {status:'AVAILABLE',anchor:first.time,openingRange15,firstFive:{close:round(first.close),ema12:round(e),relation:e===null?null:first.close>e?'ABOVE':first.close<e?'BELOW':'AT'},anchoredVwap,relativeVolumeAtTime,relativeVolumeReason:relativeVolumeAtTime?null:comparable.length<5?'NEEDS_AT_LEAST_5_COMPARABLE_PRIOR_SESSIONS':'MISSING_CONSISTENT_VOLUME'};
}
export function sessionStructureEvidence(snapshot){
 const t=snapshot?.timestamp;
 return {version:'SESSION_STRUCTURE_V1',advisoryOnly:true,executionPermission:false,thresholdsValidated:false,
 frames:Object.fromEntries(Object.entries({M5:300,M15:900,H1:3600,H4:14400}).map(([tf,d])=>[tf,frameExtras(snapshot?.['candles'+tf],d,t)])),
 nySession:nySession(snapshot?.candlesM5,t),
 dailyVolatilityBreakout:null,dailyVolatilityReason:'VERIFIED_DAILY_SESSION_OHLC_NOT_IN_SENSOR_CONTRACT'};
}
