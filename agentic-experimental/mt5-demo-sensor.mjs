// Accepts test envelopes only through an injected function, not an HTTP route.
// This is a contract validator for future ISOLATED MT5 demo sensor, not a broker bridge.
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const valid=x=>Number.isSafeInteger(x)&&x>0;
export function validateIsolatedDemoSnapshot(snapshot,now){
 const errors=[];
 if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))
  return {status:'REJECTED',errors:['INVALID_ENVELOPE'],safe:null};
 if(snapshot.environment!=='EXPERIMENTAL_NABD_AGENTIC'||
    snapshot.accountType!=='DEMO'||snapshot.executionEnabled!==false)
  errors.push('NOT_ISOLATED_DEMO_ONLY');
 if(!['XAUUSD','BTCUSD'].includes(snapshot.symbol))errors.push('UNSUPPORTED_SYMBOL');
 if(typeof snapshot.brokerServer!=='string'||!snapshot.brokerServer.toLowerCase().includes('demo')||
    snapshot.brokerServer.length>100)errors.push('DEMO_BROKER_NOT_PROVEN');
 if(!valid(snapshot.timestamp)||!valid(now)||snapshot.timestamp>now||now-snapshot.timestamp>2)
  errors.push('QUOTE_TOO_OLD');
 if(!finite(snapshot.bid)||!finite(snapshot.ask)||snapshot.bid<=0||snapshot.ask<=snapshot.bid)
  errors.push('INVALID_BID_ASK');
 if(!finite(snapshot.tickSize)||snapshot.tickSize<=0||!finite(snapshot.tickValue)||
    snapshot.tickValue<=0||!finite(snapshot.contractSize)||snapshot.contractSize<=0)
  errors.push('MISSING_BROKER_CONTRACT');
 if(!Array.isArray(snapshot.candlesM5)||snapshot.candlesM5.length<2||
    snapshot.candlesM5.length>500)errors.push('INSUFFICIENT_DEMO_CANDLES');
 else if(snapshot.candlesM5.some(c=>!valid(c.time)||![c.open,c.high,c.low,c.close].every(finite)||
    c.low<=0||c.low>Math.min(c.open,c.close)||c.high<Math.max(c.open,c.close)))
  errors.push('INVALID_DEMO_CANDLES');
 if(errors.length)return {status:'REJECTED',errors,safe:null};
 return {status:'VALIDATED_RESEARCH_SENSOR',errors:[],safe:{
  environment:snapshot.environment,accountType:'DEMO',symbol:snapshot.symbol,
  brokerServer:snapshot.brokerServer,timestamp:snapshot.timestamp,
  bid:snapshot.bid,ask:snapshot.ask,tickSize:snapshot.tickSize,
  tickValue:snapshot.tickValue,contractSize:snapshot.contractSize,
  candlesM5:snapshot.candlesM5.slice(-100)},
  executionAllowed:false,ordersSupported:false};
}
export function demoSensorReadiness(){
 return {status:'AWAITING_ISOLATED_DEMO_SENSOR',acceptedMethod:'INJECTED_TEST_DATA_ONLY',
   httpIngestEnabled:false,accountCredentialsAccepted:false,
   requiresSeparateDemoCredentials:true,brokerConnected:false,
   ordersSupported:false,liveAccountSupported:false,productionBridgeAccessible:false};
}
