// Public reference spot only, without inventing M5 candles or broker spread.
export const SOURCE='XAUS_INDICATIVE_SPOT_ONLY';
export function parsePublicGoldSpot(data,now=Math.floor(Date.now()/1000)){
  const p=Number(data?.spot_usd_oz),asOf=Date.parse(data?.data_state?.as_of||''),
    updated=Date.parse(data?.updated_at||'');
  if(!Number.isFinite(p)||p<=0)throw Error('GOLD_PRICE_INVALID');
  if(data?.data_state?.status!=='fresh'||data?.stale===true)throw Error('GOLD_SOURCE_STALE');
  if(!Number.isFinite(asOf)||!Number.isFinite(updated))throw Error('GOLD_TIME_MISSING');
  if(asOf>now*1000+10000||updated>now*1000+10000||
    now*1000-asOf>120000||now*1000-updated>120000)throw Error('GOLD_PRICE_STALE');
  return {source:SOURCE,symbol:'XAUUSD',price:p,asOf:new Date(asOf).toISOString(),
    observedAt:new Date(now*1000).toISOString(),indicative:true,
    m5Available:false,brokerCompatible:false,executable:false};
}
export async function fetchPublicGoldSpot({fetcher=fetch,now=Math.floor(Date.now()/1000)}={}){
  const response=await fetcher('https://xaus.com/api/v1/spot?compact=1',{
    method:'GET',headers:{accept:'application/json'},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('GOLD_HTTP_'+response.status);
  return parsePublicGoldSpot(await response.json(),now);
}
export function createPublicGoldObserver({load=fetchPublicGoldSpot,clock=()=>Math.floor(Date.now()/1000)}={}){
  let busy=false,lastAttempt=null,lastSuccess=null,lastError=null,lastPrice=null,lastAsOf=null;
  let failures=0,nextAttemptAt=0;
  async function poll(){
    if(busy)return {status:'BUSY'};
    if(clock()<nextAttemptAt)return {status:'BACKOFF',retryAt:new Date(nextAttemptAt*1000).toISOString()};
    busy=true;lastAttempt=new Date(clock()*1000).toISOString();
    try{
      const data=await load({now:clock()});
      if(data.source!==SOURCE||data.executable!==false||data.brokerCompatible!==false||
        data.m5Available!==false||data.symbol!=='XAUUSD')throw Error('GOLD_UNTRUSTED_SOURCE');
      lastSuccess=new Date(clock()*1000).toISOString();lastPrice=data.price;lastAsOf=data.asOf;lastError=null;failures=0;nextAttemptAt=0;
      return {status:'OBSERVED_REFERENCE'};
    }catch(e){lastError=String(e?.message||e).slice(0,100);failures++;nextAttemptAt=clock()+Math.min(900,60*2**Math.min(failures-1,4));return {status:'ERROR',code:lastError};}
    finally{busy=false;}
  }
  return {poll,report:()=>({status:lastError?'FEED_ERROR':lastSuccess?'OBSERVING_REFERENCE':'NOT_STARTED',
    source:SOURCE,symbol:'XAUUSD',lastAttempt,lastSuccess,lastError,lastPrice,lastAsOf,
    lastPriceIsFresh:!lastError&&lastAsOf!==null&&clock()*1000-Date.parse(lastAsOf)<=120000,
    consecutiveFailures:failures,nextRetryAt:nextAttemptAt?new Date(nextAttemptAt*1000).toISOString():null,
    m5Available:false,analysisEligible:false,tradingEnabled:false})};
}
