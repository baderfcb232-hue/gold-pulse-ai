import {fetchBtcReference} from './binance-market.mjs';
import {HybridScheduler} from './hybrid-scheduler.mjs';
// Read-only observation. No AI calls, trade actions, alerts, or broker integration.
export function createShadowFeedRunner({load=fetchBtcReference,clock=()=>Math.floor(Date.now()/1000),
  scheduler=new HybridScheduler(),historyLimit=30}={}){
  let busy=false, lastAttempt=null,lastSuccess=null,lastError=null,lastObservation=null;
  const entries=[];
  async function poll(){
    if(busy)return {status:'BUSY'};
    busy=true;lastAttempt=new Date(clock()*1000).toISOString();
    try{
      const input=await load({now:clock()});
      if(input.source!=='BINANCE_SPOT_BTCUSDT_REFERENCE_ONLY'||input.executable!==false||
        input.brokerCompatible!==false||input.symbol!=='BTCUSD')throw Error('UNTRUSTED_REFERENCE_SOURCE');
      const verdict=scheduler.consider({...input,news:[],atrM5:undefined});
      lastSuccess=new Date(clock()*1000).toISOString();lastError=null;
      lastObservation={time:lastSuccess,symbol:'BTCUSDT',source:input.source,
        lastM5:input.bars.M5.at(-1).time,lastClose:input.bars.M5.at(-1).close,
        trigger:verdict.reason,eligibleForResearch:verdict.callAI===true,
        analysisExecuted:false,tradingEnabled:false};
      entries.push(lastObservation);if(entries.length>historyLimit)entries.shift();
      return {status:'OBSERVED',observation:lastObservation};
    }catch(e){lastError=String(e?.message||e).slice(0,140);return {status:'ERROR',code:lastError};}
    finally{busy=false;}
  }
  function report(){return {status:lastError?'FEED_ERROR':lastSuccess?'OBSERVING':'NOT_STARTED',
    source:'BINANCE_SPOT_BTCUSDT_REFERENCE_ONLY',market:'BTCUSDT spot (not MT5 BTCUSD)',
    gold:'NO_ISOLATED_FEED',news:'NO_VERIFIED_PROVIDER',
    quoteFrequency:'60s snapshots (not second-by-second)',
    analysisExecuted:false,executionAllowed:false,
    aiRequestsFromWorker:0,lastAttempt,lastSuccess,lastError,lastObservation,
    observations:entries.length,scheduler:scheduler.report()};}
  return {poll,report};
}
