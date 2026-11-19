// Phase 9 — read-only quality assessment. Never grants trading permissions.
// Distinguishes missing sensor, stale/partial quotes, AI inactivity and failed persistence.
const MARKETS=['XAUUSD','BTCUSD'];
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const parseTime=x=>typeof x==='string'?Date.parse(x)/1000:null;
export function assessIsolatedQuality({sensor={},autoBrain={},model={},journal={},
 durable=null,forwardWriteFailures=0,now=Math.floor(Date.now()/1000)}={}){
 const marketStates={};
 const connected=sensor.authentication==='HMAC_SHA256_CONFIGURED';
 const aiEnabled=autoBrain.enabled===true;
 const dbReady=journal.status==='CONNECTED'&&journal.persistenceConnected===true;
 const validClock=Number.isSafeInteger(now)&&now>0;
 for(const symbol of MARKETS){
  const current=sensor.markets?.[symbol];
  const issues=[];
  if(!connected)issues.push('SENSOR_AUTH_NOT_CONFIGURED');
  if(!current)issues.push('NO_VERIFIED_SENSOR_OBSERVATION');
  else{
   if(current.status!=='SENSOR_OBSERVED')issues.push('SENSOR_NOT_RECENTLY_OBSERVED');
   if(current.multiTimeframeVerified!==true)issues.push('UNVERIFIED_MULTI_TIMEFRAME');
   if(!finite(current.quoteAgeSeconds)||current.quoteAgeSeconds<0||
     current.quoteAgeSeconds>2)issues.push('BROKER_QUOTE_STALE');
   const received=parseTime(current.receivedAt);
   if(!validClock||!finite(received)||received>now||now-received>10)
    issues.push('SENSOR_HEARTBEAT_STALE');
  }
  if(!aiEnabled)issues.push('AUTO_RESEARCH_DISABLED');
  if(model.status!=='READY_FOR_VERIFIED_DEMO_CONTEXT')issues.push('AI_RESEARCH_NOT_CONFIGURED');
  if(!dbReady)issues.push('RESEARCH_POSTGRES_NOT_CONNECTED');
  if(durable===null)issues.push('DURABLE_METRICS_NOT_VERIFIED');
  if(!Number.isSafeInteger(forwardWriteFailures)||forwardWriteFailures>0)
   issues.push('FORWARD_JOURNAL_WRITE_FAILURES');
  marketStates[symbol]={
   status:issues.length?'BLOCKED':'READY_TO_OBSERVE_ONLY',
   reasons:[...new Set(issues)],
   sensorVerified:current?.multiTimeframeVerified===true&&
      current.status==='SENSOR_OBSERVED',
   modelConfigured:model.status==='READY_FOR_VERIFIED_DEMO_CONTEXT',
   hasForwardSamples:!!durable?.markets?.[symbol]?.scored,
   tradeAllowed:false
  };
 }
 const globalIssues=[];
 if(!validClock)globalIssues.push('INVALID_MONITOR_CLOCK');
 if(!dbReady)globalIssues.push('RESEARCH_POSTGRES_NOT_CONNECTED');
 if(durable===null)globalIssues.push('DURABLE_METRICS_NOT_VERIFIED');
 if(forwardWriteFailures>0)globalIssues.push('FORWARD_JOURNAL_WRITE_FAILURES');
 return {status:MARKETS.every(s=>marketStates[s].status==='READY_TO_OBSERVE_ONLY')?
  'RESEARCH_OBSERVATION_READY':'RESEARCH_OBSERVATION_BLOCKED',
  markets:marketStates,globalReasons:globalIssues,
  inspectionTime:validClock?new Date(now*1000).toISOString():null,
  readinessMeaning:'OBSERVATION_ONLY_NOT_BROKER_EXECUTION_PROOF',
  brokerDealsVerified:false,tradeAllowed:false,executionAllowed:false,
  ordersCreated:0,liveTradingEnabled:false};
}
