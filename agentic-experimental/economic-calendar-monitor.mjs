import {fetchCalendarReference} from './news-reference.mjs';
import {parseComparable} from './news-surprise.mjs';
// In-memory point-in-time snapshots; never infer first-release time from vendor LastUpdate.
// Research only. No trades, AI requests, or signals. Restarts clear prior baselines.
export function previewEconomicEvent(event) {
 const a=parseComparable(event.actualRaw),f=parseComparable(event.forecastRaw),p=parseComparable(event.previousRaw);
 const comparable=!!a&&!!f&&a.unit===f.unit;
 return {id:event.id,title:event.title,eventAt:event.eventAt,
  actualRaw:event.actualRaw,forecastRaw:event.forecastRaw,previousRaw:event.previousRaw,
  comparison:comparable?{difference:a.value-f.value,unit:a.unit,
   direction:a.value>f.value?'ABOVE_FORECAST':a.value<f.value?'BELOW_FORECAST':'IN_LINE'}:null,
  previousComparable:!!p&&!!a&&p.unit===a.unit,
  source:'TRADING_ECONOMICS_CALENDAR_REFERENCE',
  releaseTimestampVerified:false,forecastPointInTimeVerified:false,
  marketImpact:'UNKNOWN',eligibleForAutoTrade:false,signal:'WAIT',
  status:comparable?'UNVERIFIED_RESEARCH_PREVIEW':'INCOMPLETE_DATA'};
}
export function createEconomicCalendarMonitor({key,load=fetchCalendarReference,
 clock=()=>Math.floor(Date.now()/1000),maxSnapshots=300}={}){
 let busy=false,lastAttempt=null,lastSuccess=null,lastError=null;
 let count=0,events=[],observedReleaseCount=0;
 const before=new Map(),released=new Map();
 async function poll(){
  if(!key)return {status:'NOT_CONFIGURED'};
  if(busy)return {status:'BUSY'};
  busy=true;const now=clock();lastAttempt=new Date(now*1000).toISOString();
  try{
   const result=await load({key,now});
   if(result.source!=='TRADING_ECONOMICS_CALENDAR_REFERENCE'||result.verifiedForImmediateTrigger!==false||
      !Array.isArray(result.events)||result.events.length>100)throw Error('CALENDAR_UNTRUSTED_SOURCE');
   const safe=result.events.filter(e=>e&&/^[0-9]{1,30}$/.test(e.id||'')&&
     Number.isSafeInteger(e.eventAt)&&e.eventAt<=now+86400&&e.eventAt>=now-14*86400&&
     typeof e.title==='string'&&e.title.length<=160&&
     typeof e.actualRaw!=='object'&&typeof e.forecastRaw!=='object');
   const out=[];
   for(const e of safe){
     const candidate=previewEconomicEvent(e);
     const id=e.id+':'+e.eventAt;
     const actual=parseComparable(e.actualRaw),forecast=parseComparable(e.forecastRaw);
     const forecastKnownBefore=forecast&&now<e.eventAt&&
       // Evidence of pre-release forecast without an actual published yet
       !actual;
     if(forecastKnownBefore&&!before.has(id)){
       before.set(id,{forecastRaw:e.forecastRaw,observedAt:now,eventAt:e.eventAt});
     }
     const baseline=before.get(id);
     const baselineValue=parseComparable(baseline?.forecastRaw);
     const hasProvenBaseline=!!baseline&&baseline.observedAt<e.eventAt&&
       baselineValue&&actual&&baselineValue.unit===actual.unit;
     const firstObserved=actual&&now>=e.eventAt&&!released.has(id);
     if(firstObserved){
       released.set(id,{firstObservedAt:now,withBaseline:!!hasProvenBaseline});
       observedReleaseCount++;
     }
     const observation=released.get(id);
     const difference=hasProvenBaseline?actual.value-baselineValue.value:null;
     candidate.pointInTime=hasProvenBaseline?{
       status:'FORECAST_SNAPSHOT_RECORDED_BEFORE_RELEASE',
       forecastAsObserved:baseline.forecastRaw,
       forecastObservedAt:new Date(baseline.observedAt*1000).toISOString(),
       firstActualObservedAt:observation?new Date(observation.firstObservedAt*1000).toISOString():null,
       difference,direction:difference>0?'ABOVE_FORECAST':difference<0?'BELOW_FORECAST':'IN_LINE',
       unit:baselineValue.unit,providerLatencyUnverified:true
     }:{status:baseline?'AWAITING_COMPARABLE_ACTUAL':'NO_PRE_RELEASE_FORECAST_SNAPSHOT'};
     candidate.forecastPointInTimeVerified=!!hasProvenBaseline;
     candidate.releaseTimestampVerified=false;
     candidate.actualFirstObservedAt=observation?new Date(observation.firstObservedAt*1000).toISOString():null;
     // Existing vendor forecast may be updated after the release: never treat it as the baseline.
     if(!hasProvenBaseline&&actual)candidate.comparison=null;
     candidate.status=hasProvenBaseline?'POINT_IN_TIME_RESEARCH_ONLY':candidate.status;
     candidate.marketImpact='UNKNOWN';candidate.signal='WAIT';candidate.eligibleForAutoTrade=false;
     out.push(candidate);
   }
   count=out.length;events=out.slice(0,20);
   // Retain only bounded in-memory evidence for this process lifetime.
   while(before.size>maxSnapshots)before.delete(before.keys().next().value);
   while(released.size>maxSnapshots)released.delete(released.keys().next().value);
   lastSuccess=new Date(now*1000).toISOString();lastError=null;
   return {status:'OBSERVED',count,observedReleaseCount};
  }catch(e){lastError=String(e?.message||e).slice(0,100);return {status:'ERROR',reason:lastError};}
  finally{busy=false;}
 }
 function report(){return {status:!key?'NOT_CONFIGURED':lastError?'FEED_ERROR':lastSuccess?'OBSERVING':'NOT_CHECKED',
  source:'TRADING_ECONOMICS_CALENDAR_REFERENCE',lastAttempt,lastSuccess,lastError,count,events,
  preReleaseSnapshots:before.size,observedReleases:observedReleaseCount,
  persistence:'VOLATILE_MEMORY_ONLY',releaseTimestampVerified:false,
  realTimeSurpriseEnabled:false,autoTradingEnabled:false,aiAnalysisEnabled:false};}
 return {poll,report};
}
