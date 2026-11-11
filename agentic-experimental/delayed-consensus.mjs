// Optional public delayed calendar research. Helious no-key tier is delayed, not live.
// No autonomous execution. Data accuracy/provenance not independently confirmed.
import {parseComparable} from './news-surprise.mjs';
const url='https://api.helious.io/v1/calendar?days_back=1&days_ahead=7&country=US';
export function parseDelayedCalendar(payload,{now=Math.floor(Date.now()/1000)}={}){
 if(!payload||!Array.isArray(payload.data?.events))throw Error('DELAYED_CALENDAR_SCHEMA_INVALID');
 const delay=Number(payload.meta?.delay_sec);
 // Free tier may be delayed by roughly one hour; never assert real-time even if metadata is missing/zero.
 const events=payload.data.events.slice(0,250).filter(x=>x?.country==='US'&&x?.impact==='High'&&typeof x?.title==='string').map(x=>{
  const scheduledAt=Date.parse(x.datetime_utc)/1000;
  if(!Number.isFinite(scheduledAt)||scheduledAt>now+10*86400||scheduledAt<now-3*86400)return null;
  const a=parseComparable(String(x.actual??'')),f=parseComparable(String(x.forecast??'')),p=parseComparable(String(x.previous??''));
  const comparable=!!a&&!!f&&a.unit===f.unit;
  return {title:x.title.slice(0,160),scheduledAt,
    actualRaw:typeof x.actual==='string'||typeof x.actual==='number'?String(x.actual).slice(0,50):null,
    forecastRaw:typeof x.forecast==='string'||typeof x.forecast==='number'?String(x.forecast).slice(0,50):null,
    previousRaw:typeof x.previous==='string'||typeof x.previous==='number'?String(x.previous).slice(0,50):null,
    status:x.status==='printed'?'PRINTED_REFERENCE':'SCHEDULED_REFERENCE',
    comparison:comparable?{difference:a.value-f.value,unit:a.unit,direction:a.value>f.value?'ABOVE_FORECAST':a.value<f.value?'BELOW_FORECAST':'IN_LINE'}:null,
    previousComparable:!!p&&!!a&&p.unit===a.unit,
    consensusSource:'THIRD_PARTY_UNVERIFIED',source:'HELIOUS_DELAYED_REFERENCE',
    forecastPointInTimeVerified:false,firstPublicationVerified:false,
    marketImpact:'UNKNOWN',tradeEligible:false};
 }).filter(Boolean).slice(0,60);
 return {source:'HELIOUS_DELAYED_REFERENCE',events,
  reportedDelaySeconds:Number.isFinite(delay)&&delay>=0?delay:null,
  live:false,researchOnly:true,autoTradeEnabled:false};
}
export async function fetchDelayedCalendar({fetcher=fetch,now=Math.floor(Date.now()/1000)}={}){
 const r=await fetcher(url,{headers:{accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error('DELAYED_CALENDAR_HTTP_'+r.status);
 return parseDelayedCalendar(await r.json(),{now});
}
export function createDelayedCalendarMonitor({load=fetchDelayedCalendar,clock=()=>Math.floor(Date.now()/1000)}={}){
 let status='NOT_CHECKED',lastSuccess=null,lastError=null,events=[],reportedDelaySeconds=null;
 const count=(list)=>{
  const actual=list.filter(x=>x.actualRaw!==null&&parseComparable(x.actualRaw)).length;
  const forecast=list.filter(x=>x.forecastRaw!==null&&parseComparable(x.forecastRaw)).length;
  const previous=list.filter(x=>x.previousRaw!==null&&parseComparable(x.previousRaw)).length;
  const complete=list.filter(x=>{
    const a=parseComparable(x.actualRaw),f=parseComparable(x.forecastRaw),p=parseComparable(x.previousRaw);
    return !!a&&!!f&&!!p&&a.unit===f.unit&&a.unit===p.unit;
  }).length;
  return {events:list.length,actualPresent:actual,forecastPresent:forecast,previousPresent:previous,allThreeComparable:complete,
   delayedProviderVerified:true,officialIndependentVerification:false,realTimeVerified:false};
 };
 async function poll(){
  try{
   const data=await load({now:clock()});
   if(data.source!=='HELIOUS_DELAYED_REFERENCE'||data.autoTradeEnabled!==false||!Array.isArray(data.events))throw Error('UNSAFE_DELAYED_CALENDAR');
   events=data.events;reportedDelaySeconds=data.reportedDelaySeconds;
   status='OBSERVING_DELAYED_REFERENCE';lastSuccess=new Date(clock()*1000).toISOString();lastError=null;
  }catch(e){status='FEED_ERROR';lastError=String(e?.message||e).slice(0,100);events=[];}
  return {status,eventCount:events.length,evidence:count(events)};
 }
 return {poll,report:()=>({status,source:'HELIOUS_DELAYED_REFERENCE',lastSuccess,lastError,events,
   evidence:count(events),verificationLevel:'VENDOR_OBSERVATION_ONLY',
   reportedDelaySeconds,realTime:false,researchOnly:true,
   forecastPointInTimeVerified:false,independentActualVerification:false,
   tradingEnabled:false,newsTriggerEnabled:false})};
}
