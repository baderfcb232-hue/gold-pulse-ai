// Read-only point-in-time economic surprise + market reaction research.
// No trading API, no AI requests, no inferred release freshness from vendor LastUpdate.
const finite = x => typeof x==='number' && Number.isFinite(x);
export function parseComparable(value) {
  if(typeof value!=='string')return null;
  const s=value.trim().replace(/,/g,'');
  const m=s.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(%|K|M|B)?$/i);
  if(!m)return null;
  const n=Number(m[1]);
  if(!Number.isFinite(n))return null;
  const unit=(m[2]||'').toUpperCase();
  const scale={K:1e3,M:1e6,B:1e9,'%':1,'':1}[unit];
  return {value:n*scale,unit:unit==='%'?'PERCENT':unit?'COUNT':'NUMBER'};
}
export function calculateSurprise({actual,forecast,previous,actualPublishedAt,forecastKnownAt,now,source}={}) {
  const missing=(reason)=>({status:'UNVERIFIED',reason,signal:'WAIT',autoExecutionAllowed:false});
  if(source!=='TRADING_ECONOMICS_CALENDAR_REFERENCE')return missing('UNKNOWN_EVENT_PROVIDER');
  const a=parseComparable(actual),f=parseComparable(forecast),p=parseComparable(previous);
  if(!a||!f||a.unit!==f.unit)return missing('MISSING_OR_INCOMPARABLE_ACTUAL_FORECAST');
  if(!Number.isSafeInteger(now)||!Number.isSafeInteger(actualPublishedAt)||
    !Number.isSafeInteger(forecastKnownAt)||actualPublishedAt>now||
    forecastKnownAt>actualPublishedAt)return missing('NO_POINT_IN_TIME_PROOF');
  const difference=a.value-f.value;
  return {status:'RESEARCH_ONLY',signal:'WAIT',actual:a.value,forecast:f.value,
    previous:p&&p.unit===a.unit?p.value:null,unit:a.unit,difference,
    direction:difference>0?'ABOVE_FORECAST':difference<0?'BELOW_FORECAST':'IN_LINE',
    releaseTimestampVerified:false,marketImpactDirection:'UNKNOWN',
    autoExecutionAllowed:false};
}
export function assessPriceReaction({candles,eventAt,now,seconds=300}={}) {
  const wait=reason=>({status:'UNAVAILABLE',reason,signal:'WAIT',autoExecutionAllowed:false});
  if(!Number.isSafeInteger(now)||!Number.isSafeInteger(eventAt)||eventAt>now||
     !Number.isSafeInteger(seconds)||seconds<60||
     !Array.isArray(candles))return wait('INVALID_EVENT_OR_CANDLES');
  const sorted=[...candles].sort((a,b)=>a.time-b.time);
  for(let i=0;i<sorted.length;i++){
    const c=sorted[i];
    if(!Number.isSafeInteger(c.time)||c.time+seconds>now||
      ![c.open,c.close,c.high,c.low].every(finite)||
      c.low<=0||c.low>Math.min(c.open,c.close)||c.high<Math.max(c.open,c.close)||
      (i>0&&sorted[i-1].time+seconds!==c.time))return wait('INVALID_OR_GAPPED_CANDLES');
  }
  const before=sorted.filter(c=>c.time+seconds<=eventAt).at(-1);
  const after=sorted.find(c=>c.time>=eventAt&&c.time+seconds<=now);
  if(!before||!after||after.time-eventAt>seconds)return wait('MISSING_PRE_POST_EVENT_CANDLES');
  const pct=(after.close/before.close-1)*100;
  return {status:'REFERENCE_REACTION',signal:'WAIT',from:before.close,to:after.close,
    pctChange:pct,priceDirection:pct>0?'UP':pct<0?'DOWN':'FLAT',
    sourceTimestamp:eventAt,causalAttribution:false,autoExecutionAllowed:false};
}
export function newsResearchReadiness({calendarConfigured=false,verifiedReleaseArchive=false,
  goldBrokerCandles=false,btcBrokerCandles=false,openaiConnected=false}={}){
 const blockers=[];
 if(!calendarConfigured)blockers.push('CALENDAR_PROVIDER_NOT_CONFIGURED');
 if(!verifiedReleaseArchive)blockers.push('RELEASE_TIME_NOT_PROVEN');
 if(!goldBrokerCandles)blockers.push('GOLD_BROKER_CANDLES_MISSING');
 if(!btcBrokerCandles)blockers.push('BTC_BROKER_CANDLES_MISSING');
 if(!openaiConnected)blockers.push('AI_NOT_CONNECTED');
 return {status:blockers.length?'BLOCKED':'RESEARCH_READY',blockers,
   signal:'WAIT',autoExecutionAllowed:false,newsTriggeredTrading:false,
   note:'Research readiness never grants trade permissions'};
}
