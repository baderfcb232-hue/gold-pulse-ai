// Federal Reserve Bank of St. Louis FRED CSV snapshots of historical BLS indicators.
// A separate research reference when public BLS API is inaccessible. NOT a release feed.
// No key, no third-party trading automation and no first-publication guarantees.
const series=Object.freeze([
 {fred:'CPIAUCNS',bls:'CUUR0000SA0',name:'CPI-U all items U.S. city average',unit:'INDEX'},
 {fred:'UNRATE',bls:'LNS14000000',name:'Civilian unemployment rate',unit:'PERCENT'},
 {fred:'PAYEMS',bls:'CES0000000001',name:'Total nonfarm payroll employment',unit:'THOUSANDS'}
]);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const validPeriod=s=>/^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export function parseFredCsv(csv,fredId,now){
 const meta=series.find(s=>s.fred===fredId);
 if(!meta)throw Error('FRED_UNKNOWN_SERIES');
 if(typeof csv!=='string'||csv.length>350000)throw Error('FRED_OVERSIZED_CSV');
 const lines=csv.trim().split(/\r?\n/);
 const header=lines.shift()?.trim().replace(/^\uFEFF/,'');
 if(!['DATE,'+fredId,'observation_date,'+fredId].includes(header))throw Error('FRED_INVALID_HEADER');
 const values=[];
 for(const line of lines){
  const cells=line.trim().split(',');
  if(cells.length!==2||!/^(\d{4})-(\d{2})-01$/.test(cells[0]))continue;
  const period=cells[0].slice(0,7),v=Number(cells[1]);
  if(!validPeriod(period)||cells[1]==='.'||cells[1]===''||!finite(v)||v<=0)continue;
  values.push({period,value:v});
 }
 values.sort((a,b)=>b.period.localeCompare(a.period));
 if(values.length<2)throw Error('FRED_INSUFFICIENT_OBSERVATIONS');
 if(values[0].period>new Date(now*1000).toISOString().slice(0,7))
   throw Error('FRED_FUTURE_OBSERVATION');
 const latest=values[0],previous=values.find(x=>x.period===shiftMonth(latest.period,-1));
 const yearAgo=values.find(x=>x.period===shiftMonth(latest.period,-12));
 return {source:'FRED_BLS_HISTORICAL_REFERENCE',originalPublisher:'US_BLS',
  seriesId:meta.bls,fredSeriesId:fredId,name:meta.name,unit:meta.unit,
  period:latest.period,latestValue:latest.value,previousValue:previous?.value??null,
  previousPeriod:previous?.period??null,yearAgoValue:yearAgo?.value??null,
  nfpMonthlyChangePersons:fredId==='PAYEMS'&&previous?
    Math.round((latest.value-previous.value)*1000):null,
  cpiYearOverYearPercent:fredId==='CPIAUCNS'&&yearAgo?
    (latest.value/yearAgo.value-1)*100:null,
  forecast:null,actualReleaseTimeVerified:false,revisionStatus:'UNVERIFIED',
  comparisonToForecast:null,marketImpact:'UNKNOWN',isRealTime:false,
  eligibleForTrading:false,observedAt:new Date(now*1000).toISOString()};
}
function shiftMonth(period,offset){
 const [y,m]=period.split('-').map(Number);
 return new Date(Date.UTC(y,m-1+offset,1)).toISOString().slice(0,7);
}
export async function fetchFredHistorical({fetcher=fetch,now=Math.floor(Date.now()/1000)}={}){
 const results=[];
 for(const s of series){
  // Published FRED CSV graph export, pinned host and series IDs; no arbitrary URLs.
  const url='https://fred.stlouisfed.org/graph/fredgraph.csv?id='+s.fred;
  const response=await fetcher(url,{method:'GET',redirect:'error',
    headers:{accept:'text/csv'},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('FRED_HTTP_'+response.status);
  const size=Number(response.headers?.get?.('content-length')||0);
  if(size>350000)throw Error('FRED_OVERSIZED_CSV');
  const body=await response.text();
  results.push(parseFredCsv(body,s.fred,now));
 }
 return results;
}
export function createFredHistoricalMonitor({load=fetchFredHistorical,
  clock=()=>Math.floor(Date.now()/1000)}={}){
 let lastAttempt=null,lastSuccess=null,lastError=null,seriesData=[],busy=false;
 async function poll(){
  if(busy)return {status:'BUSY'};
  busy=true;lastAttempt=new Date(clock()*1000).toISOString();
  try{
   const items=await load({now:clock()});
   if(!Array.isArray(items)||items.length!==3||
      items.some((x,i)=>x.seriesId!==series[i].bls||
       x.source!=='FRED_BLS_HISTORICAL_REFERENCE'||x.eligibleForTrading!==false||
       !finite(x.latestValue)))throw Error('FRED_UNVERIFIED_DATA');
   seriesData=items;lastSuccess=new Date(clock()*1000).toISOString();lastError=null;
   return {status:'OBSERVED_HISTORICAL',count:items.length};
  }catch(e){
   lastError=String(e?.message||e).slice(0,90);
   return {status:'ERROR',code:lastError};
  }finally{busy=false}
 }
 return {poll,report:()=>({status:lastError?'FEED_ERROR':lastSuccess?'OBSERVING_HISTORICAL':'NOT_CHECKED',
  source:'FRED_BLS_HISTORICAL_REFERENCE',lastAttempt,lastSuccess,lastError,
  series:seriesData,firstPublicationVerified:false,autoTradingEnabled:false,
  forecastsAvailable:false,licensedNewsSubstitute:false})};
}
