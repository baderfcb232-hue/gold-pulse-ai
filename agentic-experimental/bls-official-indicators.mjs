// Official BLS public API v1: free, limited to 25 requests/day without registration.
// Released observations only; no forecast/surprise or verified first-release latency.
export const BLS_SERIES=Object.freeze([
 {id:'CUUR0000SA0',name:'CPI-U all items U.S. city average',unit:'INDEX'},
 {id:'LNS14000000',name:'Civilian unemployment rate',unit:'PERCENT'},
 {id:'CES0000000001',name:'Total nonfarm payroll employment',unit:'THOUSANDS'}
]);
const URL='https://api.bls.gov/publicAPI/v1/timeseries/data/';
export function shiftMonth(period,months){
 if(!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(period)||!Number.isInteger(months))throw Error('BLS_INVALID_PERIOD');
 const [year,month]=period.split('-').map(Number);
 const d=new Date(Date.UTC(year,month-1+months,1));
 return d.toISOString().slice(0,7);
}
export function parseBlsResponse(raw,seriesId,now){
 if(raw?.status!=='REQUEST_SUCCEEDED'||!Array.isArray(raw?.Results?.series))
   throw Error('BLS_INVALID_RESPONSE');
 const series=raw.Results.series.find(s=>s.seriesID===seriesId);
 if(!series||!Array.isArray(series.data))throw Error('BLS_MISSING_SERIES');
 const meta=BLS_SERIES.find(s=>s.id===seriesId);
 if(!meta)throw Error('BLS_UNKNOWN_SERIES');
 const observations=series.data.filter(x=>/^\d{4}$/.test(String(x.year))&&
  /^M(0[1-9]|1[0-2])$/.test(String(x.period))&&
  /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(String(x.value).replace(/,/g,'')))
 .map(x=>({period:x.year+'-'+x.period.slice(1),value:Number(String(x.value).replace(/,/g,''))}))
 .filter(x=>Number.isFinite(x.value)).sort((a,b)=>b.period.localeCompare(a.period)).slice(0,18);
 if(!observations.length)throw Error('BLS_NO_NUMERIC_OBSERVATION');
 const latest=observations[0];
 const previous=observations.find(o=>o.period===shiftMonth(latest.period,-1));
 const yearAgo=observations.find(o=>o.period===shiftMonth(latest.period,-12));
 const payrollChange=seriesId==='CES0000000001'&&previous?Math.round((latest.value-previous.value)*1000):null;
 const cpiYearOverYear=seriesId==='CUUR0000SA0'&&yearAgo&&yearAgo.value>0?
   (latest.value/yearAgo.value-1)*100:null;
 return {source:'BLS_PUBLIC_DATA_API_V1',seriesId,name:meta.name,unit:meta.unit,
  period:latest.period,latestValue:latest.value,previousValue:previous?.value??null,
  previousPeriod:previous?.period??null,yearAgoValue:yearAgo?.value??null,
  nfpMonthlyChangePersons:payrollChange,cpiYearOverYearPercent:cpiYearOverYear,
  derivedDataPresent:seriesId==='CES0000000001'?payrollChange!==null:
    seriesId==='CUUR0000SA0'?cpiYearOverYear!==null:true,
  observedAt:new Date(now*1000).toISOString(),forecast:null,actualReleaseTimeVerified:false,
  revisionStatus:'UNVERIFIED',comparisonToForecast:null,marketImpact:'UNKNOWN',
  isRealTime:false,eligibleForTrading:false};
}
export async function fetchBlsIndicators({fetcher=fetch,now=Math.floor(Date.now()/1000)}={}){
 const out=[];
 // Public v1 requests each series separately. Kept to 3 calls per poll, 4h cadence.
 for(const row of BLS_SERIES){
  const response=await fetcher(URL+row.id,{
   method:'GET',headers:{accept:'application/json'},redirect:'error',
   signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('BLS_HTTP_'+response.status);
  out.push(parseBlsResponse(await response.json(),row.id,now));
 }
 return out;
}
export function createBlsOfficialMonitor({load=fetchBlsIndicators,
 clock=()=>Math.floor(Date.now()/1000)}={}){
 let busy=false,lastAttempt=null,lastSuccess=null,lastError=null,series=[];
 async function poll(){
  if(busy)return {status:'BUSY'};
  busy=true;lastAttempt=new Date(clock()*1000).toISOString();
  try{
   const data=await load({now:clock()});
   if(!Array.isArray(data)||data.length!==BLS_SERIES.length||
      data.some((d,i)=>d.source!=='BLS_PUBLIC_DATA_API_V1'||
        d.seriesId!==BLS_SERIES[i].id||d.eligibleForTrading!==false||
        d.actualReleaseTimeVerified!==false||!Number.isFinite(d.latestValue)))
     throw Error('BLS_UNTRUSTED_DATA');
   series=data;lastSuccess=new Date(clock()*1000).toISOString();lastError=null;
   return {status:'OBSERVED',count:series.length};
  }catch(e){lastError=String(e?.message||e).slice(0,100);return {status:'ERROR',code:lastError};}
  finally{busy=false;}
 }
 return {poll,report:()=>({status:lastError?'FEED_ERROR':lastSuccess?'OBSERVING':'NOT_CHECKED',
  source:'BLS_PUBLIC_DATA_API_V1',lastAttempt,lastSuccess,lastError,series,
  cadence:'EVERY_4_HOURS',providerQuota:'UNREGISTERED_25_REQUESTS_PER_DAY',
  firstPublicationVerified:false,forecastsAvailable:false,
  actualVsForecastReady:false,autoTradingEnabled:false,aiAnalysisEnabled:false})};
}
