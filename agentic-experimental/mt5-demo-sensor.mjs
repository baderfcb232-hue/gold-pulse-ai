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
 if(snapshot.brokerSymbol!==undefined&&
    (typeof snapshot.brokerSymbol!=='string'||!/^[-A-Za-z0-9._]{1,64}$/.test(snapshot.brokerSymbol)))
  errors.push('INVALID_BROKER_SYMBOL');
 if(snapshot.accountLogin!=null&&(!Number.isSafeInteger(snapshot.accountLogin)||snapshot.accountLogin<=0))
  errors.push('INVALID_DEMO_ACCOUNT_LOGIN');
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
 else if(snapshot.candlesM5.some((c,i)=>!c||!valid(c.time)||![c.open,c.high,c.low,c.close].every(finite)||
    c.low<=0||c.low>Math.min(c.open,c.close)||c.high<Math.max(c.open,c.close)||
    c.time+300>now||i>0&&snapshot.candlesM5[i-1].time>=c.time))
  errors.push('INVALID_DEMO_CANDLES');
 const higherFrames=['M15','H1','H4'];
 let multiTimeframeVerified=true;
 for(const frame of higherFrames){
  const bars=snapshot['candles'+frame];
  const duration={M15:900,H1:3600,H4:14400}[frame];
  if(!Array.isArray(bars)||bars.length<2||bars.length>500){
   multiTimeframeVerified=false;continue;
  }
  if(bars.some((bar,i)=>!valid(bar.time)||![
   bar.open,bar.high,bar.low,bar.close].every(finite)||
   bar.low<=0||bar.low>Math.min(bar.open,bar.close)||
   bar.high<Math.max(bar.open,bar.close)||
   bar.time+duration>now||i>0&&bars[i-1].time>=bar.time)){
   errors.push('INVALID_'+frame+'_CANDLES');
   multiTimeframeVerified=false;
  }
 }
 if(errors.length)return {status:'REJECTED',errors,safe:null};
 return {status:'VALIDATED_RESEARCH_SENSOR',errors:[],safe:{
  environment:snapshot.environment,accountType:'DEMO',symbol:snapshot.symbol,
  brokerServer:snapshot.brokerServer,
  brokerSymbol:typeof snapshot.brokerSymbol==='string'?snapshot.brokerSymbol:null,
  accountLogin:Number.isSafeInteger(snapshot.accountLogin)?snapshot.accountLogin:null,
  timestamp:snapshot.timestamp,
  bid:snapshot.bid,ask:snapshot.ask,tickSize:snapshot.tickSize,
  tickValue:snapshot.tickValue,contractSize:snapshot.contractSize,
  candlesM5:snapshot.candlesM5.slice(-240),
  multiTimeframeVerified,
  candlesM15:multiTimeframeVerified?snapshot.candlesM15.slice(-100):null,
  candlesH1:multiTimeframeVerified?snapshot.candlesH1.slice(-80):null,
  candlesH4:multiTimeframeVerified?snapshot.candlesH4.slice(-60):null},
  executionAllowed:false,ordersSupported:false};
}
export function demoSensorReadiness(){
 return {status:'AWAITING_ISOLATED_DEMO_SENSOR',acceptedMethod:'INJECTED_TEST_DATA_ONLY',
   httpIngestEnabled:false,accountCredentialsAccepted:false,
   requiresSeparateDemoCredentials:true,brokerConnected:false,
   ordersSupported:false,liveAccountSupported:false,productionBridgeAccessible:false};
}
