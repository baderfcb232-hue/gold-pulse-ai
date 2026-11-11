// Official BLS public API v1: free, limited to 25 requests/day without registration.
// Released observations only; no forecast/surprise or verified first-release latency.
export const BLS_SERIES=Object.freeze([
 {id:'CUUR0000SA0',name:'CPI-U all items U.S. city average',unit:'INDEX'},
 {id:'LNS14000000',name:'Civilian unemployment rate',unit:'PERCENT'},
 {id:'CES0000000001',name:'Total nonfarm payroll employment',unit:'THOUSANDS'}
]);
const V1_URL='https://api.bls.gov/publicAPI/v1/timeseries/data/';
const V2_URL='https://api.bls.gov/publicAPI/v2/timeseries/data/';
export function shiftMonth(period,months){
 if(!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(period)||!Number.isInteger(months))throw Error('BLS_INVALID_PERIOD');
 const [year,month]=period.split('-').map(Number);
 const d=new Date(Date.UTC(year,month-1+months,1));
 return d.toISOString().slice(0,7);
}
export function blsSeriesFromResponse(raw){
 const results=raw?.Results;
 if(Array.isArray(results))return results.flatMap(x=>Array.isArray(x?.series)?x.series:[]);
 if(results&&Array.isArray(results.series))return results.series;
 return null;
}
export function parseBlsResponse(raw,seriesId,now){
 const rows=blsSeriesFromResponse(raw);
 if(raw?.status!=='REQUEST_SUCCEEDED'||!rows)throw Error('BLS_INVALID_RESPONSE');
 const series=rows.find(s=>s.seriesID===seriesId);
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
export function describeBlsFailure(raw){
 if(raw?.status==='REQUEST_SUCCEEDED'&&blsSeriesFromResponse(raw))return null;
 const messages=(Array.isArray(raw?.message)?raw.message.map(String).join(' '):
  typeof raw?.message==='string'?raw.message:'').toLowerCase();
 if(/limit|quota|too many|exceed|rate/.test(messages))return 'BLS_RATE_OR_DAILY_LIMIT';
 if(/registration|authorization|api key|invalid key|unauthorized/.test(messages))return 'BLS_AUTHORIZATION_FAILED';
 if(/syntax|malformed|invalid request|bad request|json/.test(messages))return 'BLS_REQUEST_FORMAT_REJECTED';
 if(/forbidden|access denied|blocked|firewall/.test(messages))return 'BLS_ACCESS_BLOCKED';
 if(/locked|unavailable|maintenance|temporary/.test(messages))return 'BLS_UPSTREAM_TEMPORARILY_UNAVAILABLE';
 const status=typeof raw?.status==='string'&&/^[A-Z_]{3,60}$/.test(raw.status)?raw.status:'UNKNOWN_STATUS';
 return 'BLS_UPSTREAM_REJECTED_'+status;
}
export async function fetchBlsIndicators({fetcher=fetch,now=Math.floor(Date.now()/1000),
 registrationKey=process.env.NABD_TEST_BLS_REGISTRATION_KEY}={}){
 // The official v1 API allows up to 25 series in ONE POST. One request instead
 // of three makes restarts and free/shared-IP quotas less likely to break.
 const response=await fetcher(registrationKey?V2_URL:V1_URL,{
  method:'POST',headers:{accept:'application/json','content-type':'application/json'},
  body:JSON.stringify({...{seriesid:BLS_SERIES.map(x=>x.id)},
   ...(registrationKey?{registrationkey:registrationKey}: {})}),
  redirect:'error',signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error('BLS_HTTP_'+response.status);
 const raw=await response.json();
 const reason=describeBlsFailure(raw);
 if(reason)throw Error(reason);
 return BLS_SERIES.map(row=>parseBlsResponse(raw,row.id,now));
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
  cadence:'EVERY_4_HOURS',providerQuota:process.env.NABD_TEST_BLS_REGISTRATION_KEY?
    'REGISTERED_500_REQUESTS_PER_DAY':'UNREGISTERED_25_REQUESTS_PER_DAY',
  firstPublicationVerified:false,forecastsAvailable:false,
  actualVsForecastReady:false,autoTradingEnabled:false,aiAnalysisEnabled:false})};
}
