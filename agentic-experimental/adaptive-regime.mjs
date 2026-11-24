// Advisory only. Closed broker candles; no orders or execution authorization.
const finite=Number.isFinite;
const round=x=>finite(x)?Number(x.toPrecision(6)):null;
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
export function regimeFrame(bars,duration,asOf){
 if(!Number.isSafeInteger(asOf)||!Array.isArray(bars)||bars.length<32)return {status:'UNAVAILABLE'};
 if(bars.some((b,i)=>!b||!Number.isSafeInteger(b.time)||b.time+duration>asOf||b.time%duration!==0||i>0&&b.time<=bars[i-1].time||![b.open,b.high,b.low,b.close].every(x=>finite(x)&&x>0)||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)))return {status:'INVALID_OR_UNCLOSED'};
 if(asOf-bars.at(-1).time-duration>duration*2)return {status:'STALE'};
 const a=bars.slice(-32),last=a.at(-1),prior=a.slice(-21,-1);
 const tr=a.slice(1).map((b,i)=>Math.max(b.high-b.low,Math.abs(b.high-a[i].close),Math.abs(b.low-a[i].close)));
 const atr=mean(tr.slice(-15,-1)),oldAtr=mean(tr.slice(0,14));
 if(!(atr>0&&oldAtr>0))return {status:'UNAVAILABLE'};
 const high=Math.max(...prior.map(b=>b.high)),low=Math.min(...prior.map(b=>b.low));
 const displacement=last.close-a.at(-21).close;
 const path=a.slice(-20).reduce((s,b,i)=>s+Math.abs(b.close-a[a.length-21+i].close),0);
 const efficiency=path>0?Math.abs(displacement)/path:0;
 const volatility=atr/oldAtr,range=last.high-last.low;
 const body=range>0?Math.abs(last.close-last.open)/range:0;
 const above=last.close>high+0.15*atr,below=last.close<low-0.15*atr;
 const rejectedHigh=last.high>high&&last.close<=high,rejectedLow=last.low<low&&last.close>=low;
 const breakout=body>=0.6&&above?'UP_CANDIDATE':body>=0.6&&below?'DOWN_CANDIDATE':'NONE';
 const trend=efficiency>=0.35&&Math.abs(displacement)>=2*atr?(displacement>0?'UP':'DOWN'):'RANGE_OR_MIXED';
 const prior2=a.slice(-22,-2),prev=a.at(-2);
 const ph=Math.max(...prior2.map(b=>b.high)),pl=Math.min(...prior2.map(b=>b.low));
 const retest=prev.close>ph+0.15*atr&&last.low<=ph+0.25*atr&&last.close>ph?'UP_RETEST_CANDIDATE':prev.close<pl-0.15*atr&&last.high>=pl-0.25*atr&&last.close<pl?'DOWN_RETEST_CANDIDATE':'NONE';
 return {status:'AVAILABLE',trend,efficiency:round(efficiency),atr:round(atr),volatilityRatio:round(volatility),priorHigh:round(high),priorLow:round(low),rangeLocation:round((last.close-low)/(high-low||atr)),breakout,retest,rejectedHigh,rejectedLow,bodyFraction:round(body),liquidityNote:'OHLC_SWEEP_PROXY_NOT_ORDER_BOOK'};
}
export function adaptiveEvidence(snapshot){
 const asOf=snapshot?.timestamp,frames=Object.fromEntries(Object.entries({M5:300,M15:900,H1:3600,H4:14400}).map(([tf,d])=>[tf,regimeFrame(snapshot?.['candles'+tf],d,asOf)]));
 const f=frames.M5,h=frames.H1,k=frames.H4,m=frames.M15;
 let regime='UNVERIFIED',candidate='WAIT';
 if(Object.values(frames).every(x=>x.status==='AVAILABLE')){
  if(f.volatilityRatio>1.8||m.volatilityRatio>1.8){regime='VOLATILITY_EXPANSION';}
  else if(h.trend===k.trend&&['UP','DOWN'].includes(h.trend)){
   regime=h.trend==='UP'?'TREND_UP':'TREND_DOWN';
   const direction=h.trend;
   if(f.retest===direction+'_RETEST_CANDIDATE'&&m.trend===direction&&!(direction==='UP'?f.rejectedHigh:f.rejectedLow))candidate='BREAKOUT_RETEST';
   else if(m.trend!== (direction==='UP'?'DOWN':'UP')&&f.breakout==='NONE')candidate='TREND_PULLBACK_RESEARCH';
  }else if(h.trend==='RANGE_OR_MIXED'&&k.trend==='RANGE_OR_MIXED'){regime='RANGE_OR_MIXED';candidate=f.rejectedHigh||f.rejectedLow?'RANGE_REJECTION_RESEARCH':'WAIT';}
  else regime='CONFLICT';
 }
 return {version:'ADAPTIVE_REGIME_V4_1',advisoryOnly:true,regime,candidate,frames,executionPermission:false,thresholdsValidated:false};
}
