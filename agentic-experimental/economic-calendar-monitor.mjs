import {fetchCalendarReference} from './news-reference.mjs';
import {parseComparable} from './news-surprise.mjs';
// Snapshot-based research preview only. Provider LastUpdate != proven release timestamp.
// No AI, no trade triggers, no inferred financial directions.
export function previewEconomicEvent(event) {
 const a=parseComparable(event.actualRaw),f=parseComparable(event.forecastRaw),
  p=parseComparable(event.previousRaw);
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
  clock=()=>Math.floor(Date.now()/1000)}={}){
 let busy=false,lastAttempt=null,lastSuccess=null,lastError=null;
 let count=0,events=[];
 async function poll(){
  if(!key)return {status:'NOT_CONFIGURED'};
  if(busy)return {status:'BUSY'};
  busy=true;lastAttempt=new Date(clock()*1000).toISOString();
  try{
   const result=await load({key,now:clock()});
   if(result.source!=='TRADING_ECONOMICS_CALENDAR_REFERENCE'||
     result.verifiedForImmediateTrigger!==false||
     !Array.isArray(result.events)||result.events.length>100)throw Error('CALENDAR_UNTRUSTED_SOURCE');
   const safe=result.events.filter(e=>e&&/^[0-9]{1,30}$/.test(e.id||'')&&
     Number.isSafeInteger(e.eventAt)&&e.eventAt<=clock()+86400&&
     typeof e.title==='string'&&e.title.length<=160).map(previewEconomicEvent);
   count=safe.length;events=safe.slice(0,20);
   lastSuccess=new Date(clock()*1000).toISOString();lastError=null;
   return {status:'OBSERVED',count};
  }catch(e){lastError=String(e?.message||e).slice(0,100);return {status:'ERROR',reason:lastError};}
  finally{busy=false;}
 }
 function report(){return {status:!key?'NOT_CONFIGURED':lastError?'FEED_ERROR':lastSuccess?'OBSERVING':'NOT_CHECKED',
  source:'TRADING_ECONOMICS_CALENDAR_REFERENCE',lastAttempt,lastSuccess,lastError,count,events,
  releaseTimestampVerified:false,forecastPointInTimeVerified:false,
  realTimeSurpriseEnabled:false,autoTradingEnabled:false,aiAnalysisEnabled:false};}
 return {poll,report};
}
