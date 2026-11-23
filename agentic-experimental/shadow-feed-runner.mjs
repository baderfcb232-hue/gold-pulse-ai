import {fetchBtcReference} from './binance-market.mjs';
import {HybridScheduler} from './hybrid-scheduler.mjs';
// Read-only observation. Binance reference is NEVER broker-execution market data.
// Respect public vendor 418/429 throttling: retrying every minute can extend bans.
export function createShadowFeedRunner({load=fetchBtcReference,clock=()=>Math.floor(Date.now()/1000),
  scheduler=new HybridScheduler(),historyLimit=30}={}){
  let busy=false,lastAttempt=null,lastSuccess=null,lastError=null,lastObservation=null;
  let rateLimitHits=0,blockedUntil=0;
  const entries=[];
  async function poll(){
    if(busy)return {status:'BUSY'};
    const now=clock();
    if(now<blockedUntil)return {status:'SKIPPED',code:'REFERENCE_PROVIDER_RATE_LIMIT_BACKOFF',
      nextAttemptAt:new Date(blockedUntil*1000).toISOString()};
    busy=true;lastAttempt=new Date(now*1000).toISOString();
    try{
      const input=await load({now:clock()});
      if(input.source!=='BINANCE_SPOT_BTCUSDT_REFERENCE_ONLY'||input.executable!==false||
        input.brokerCompatible!==false||input.symbol!=='BTCUSD')throw Error('UNTRUSTED_REFERENCE_SOURCE');
      const verdict=scheduler.consider({...input,news:[],atrM5:undefined});
      lastSuccess=new Date(clock()*1000).toISOString();lastError=null;
      rateLimitHits=0;blockedUntil=0;
      lastObservation={time:lastSuccess,symbol:'BTCUSDT',source:input.source,
        lastM5:input.bars.M5.at(-1).time,lastClose:input.bars.M5.at(-1).close,
        trigger:verdict.reason,eligibleForResearch:verdict.callAI===true,
        analysisExecuted:false,tradingEnabled:false};
      entries.push(lastObservation);if(entries.length>historyLimit)entries.shift();
      return {status:'OBSERVED',observation:lastObservation};
    }catch(e){
      lastError=String(e?.message||e).slice(0,140);
      if(lastError==='REFERENCE_FEED_HTTP_418'||lastError==='REFERENCE_FEED_HTTP_429'){
        rateLimitHits++;
        // Minimum 30min, then exponential backoff up to 6h. No ban workaround,
        // no alternate Binance hosts, and no synthetic/fallback execution prices.
        const waitSeconds=Math.min(21600,1800*2**Math.min(rateLimitHits-1,4));
        blockedUntil=clock()+waitSeconds;
        return {status:'BACKOFF',code:lastError,
          nextAttemptAt:new Date(blockedUntil*1000).toISOString()};
      }
      return {status:'ERROR',code:lastError};
    }finally{busy=false;}
  }
  function report(){
    const now=clock();
    return {status:blockedUntil>now?'REFERENCE_PROVIDER_RATE_LIMIT_BACKOFF':
      lastError?'FEED_ERROR':lastSuccess?'OBSERVING':'NOT_STARTED',
      source:'BINANCE_SPOT_BTCUSDT_REFERENCE_ONLY',market:'BTCUSDT spot (not MT5 BTCUSD)',
      gold:'NO_ISOLATED_FEED',news:'NO_VERIFIED_PROVIDER',
      quoteFrequency:'60s snapshots (not second-by-second)',
      analysisExecuted:false,executionAllowed:false,
      aiRequestsFromWorker:0,lastAttempt,lastSuccess,lastError,lastObservation,
      observations:entries.length,scheduler:scheduler.report(),
      rateLimitHits,nextAttemptAt:blockedUntil>now?
        new Date(blockedUntil*1000).toISOString():null};
  }
  return {poll,report};
}
