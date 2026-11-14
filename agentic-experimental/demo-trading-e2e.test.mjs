import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createDemoIngest,signDemoEnvelope} from './demo-ingest.mjs';
import {createDemoAutoBrain} from './demo-auto-brain.mjs';
import {createDemoTradeIntents} from './demo-trade-intents.mjs';
import {HybridScheduler} from './hybrid-scheduler.mjs';

const t=1800000000;
const sensorSecret='separate-demo-sensor-integration-test-secret';
const execSecret='separate-demo-executor-integration-test-secret';
const mac=(key,wire)=>createHmac('sha256',key).update(wire).digest('hex');
function frame(duration,count){
 const end=Math.floor(t/duration)*duration-duration;
 return Array.from({length:count},(_,i)=>{
  const start=end-(count-i-1)*duration;
  const base=100+i*.05+.5*Math.sin(i*.8);
  return {time:start,open:base-.1,high:base+1,low:base-1,close:base};
 });
}
function snapshot(){
 const m5=frame(300,220),price=m5.at(-1).close;
 return {environment:'EXPERIMENTAL_NABD_AGENTIC',accountType:'DEMO',executionEnabled:false,
  symbol:'XAUUSD',brokerServer:'Isolated-JustMarkets-Demo',brokerSymbol:'XAUUSD.m',accountLogin:3214567,
  timestamp:t-1,bid:price+.02,ask:price+.12,tickSize:.01,tickValue:1,contractSize:1,
  candlesM5:m5,candlesM15:frame(900,64),candlesH1:frame(3600,48),
  candlesH4:frame(14400,32)};
}
function signedPull(login=3214567,server='Isolated-JustMarkets-Demo'){
 const body=JSON.stringify({source:'ISOLATED_DEMO_TRADE_EXECUTOR',accountType:'DEMO',
  accountLogin:login,brokerServer:server,symbols:['XAUUSD','BTCUSD'],brokerSymbols:{XAUUSD:'XAUUSD.m',BTCUSD:'BTCUSD.m'},capturedAt:t});
 return {body,timestamp:String(t),mac:mac(execSecret,t+'\n'+body),secure:true};
}
function compose({journalResult={inserted:true},stance='BUY_WATCH',confidence=.92,accountType='DEMO'}={}){
 const s={...snapshot(),accountType};
 const ingest=createDemoIngest({secret:sensorSecret,clock:()=>t});
 const serialized=JSON.stringify({source:'ISOLATED_MT5_DEMO_SENSOR',
  capturedAt:t,ordersSupported:false,symbols:{XAUUSD:s}});
 const result=ingest.receive({body:serialized,timestamp:String(t),
  signature:signDemoEnvelope(sensorSecret,t,serialized),secure:true});
 const orders=createDemoTradeIntents({enabled:true,secret:execSecret,clock:()=>t,
  quoteProvider:sym=>ingest.getLatest(sym)});
 let saved=0,called=0;
 const brains={XAUUSD:{analyze:async ctx=>{
   called++;
   assert.equal(ctx.technicalEvidence.M5.ema200Verified,true);
   assert.equal(ctx.accountType,'DEMO');
   return {status:'RESEARCH_ANALYSIS_ONLY',plan:{
    stance,confidence,thesis:'confirmed multi-timeframe trend'}};}}};
 const brain=createDemoAutoBrain({brains,scheduler:new HybridScheduler(),
  clock:()=>t,enabled:true,
  journalProvider:()=>({saveAnalysis:async()=>{saved++;return journalResult;}}),
  onPlan:args=>orders.consider(args)});
 return {ingest,result,orders,brain,get called(){return called},get saved(){return saved}};
}
test('isolated signed Demo bars produce one auditable WATCH intent for simulated MT5 pickup',async()=>{
 const system=compose();
 assert.equal(system.result.status,'OBSERVED');
 assert.equal(system.brain.onSnapshot(system.ingest.getLatest('XAUUSD')).scheduled,true);
 await system.brain.flush();
 assert.equal(system.called,1);assert.equal(system.saved,1);
 assert.equal(system.orders.report().created,1);
 const res=system.orders.pull(signedPull());
 assert.equal(res.status,'INTENT_DELIVERED');
 assert.match(res.wire,/^V1\|XAUUSD-/);
 assert.equal(system.orders.pull(signedPull()).status,'NO_INTENT');
 assert.equal(system.orders.report().serverPlacesOrders,false);
 assert.equal(system.orders.report().brokerIndependentlyVerifiedFills,0);
});
test('no persisted journal means no Demo order even with high-confidence WATCH',async()=>{
 const system=compose({journalResult:{inserted:false}});
 system.brain.onSnapshot(system.ingest.getLatest('XAUUSD'));await system.brain.flush();
 assert.equal(system.saved,1);assert.equal(system.orders.report().created,0);
 assert.equal(system.orders.pull(signedPull()).status,'NO_INTENT');
});
test('WAIT, low-confidence and LIVE provenance never produce a Demo order',async()=>{
 for(const opts of [{stance:'WAIT'}, {confidence:.7}, {accountType:'LIVE'}]){
  const x=compose(opts);
  if(opts.accountType==='LIVE'){assert.equal(x.result.status,'REJECTED');continue}
  x.brain.onSnapshot(x.ingest.getLatest('XAUUSD'));await x.brain.flush();
  assert.equal(x.orders.report().created,0);
 }
});
test('wrong Demo broker identity cannot receive an existing signed intent',async()=>{
 const system=compose();
 system.brain.onSnapshot(system.ingest.getLatest('XAUUSD'));await system.brain.flush();
 assert.equal(system.orders.report().created,1);
 const denied=system.orders.pull(signedPull(3214567,'OtherBroker-Demo'));
 assert.equal(denied.status,'BROKER_MISMATCH');
 assert.equal(system.orders.report().delivered,0);
 assert.equal(system.orders.pull(signedPull()).status,'INTENT_DELIVERED');
});

test('full simulated AI -> saved journal -> signed intent -> executor pickup -> signed ACK stays unverified by broker',async()=>{
 const system=compose();
 assert.equal(system.result.status,'OBSERVED');
 assert.equal(system.brain.onSnapshot(system.ingest.getLatest('XAUUSD')).scheduled,true);
 await system.brain.flush();
 assert.equal(system.saved,1);
 assert.equal(system.orders.report().created,1);
 const delivered=system.orders.pull(signedPull());
 assert.equal(delivered.status,'INTENT_DELIVERED');
 assert.equal(system.orders.report().delivered,1);
 const ackBody=JSON.stringify({id:'XAUUSD-'+(t-300),status:'FILLED',
  accountType:'DEMO',accountLogin:3214567,occurredAt:t,
  brokerDealTicket:2326494437,tradeRetcode:10009,executedVolume:.02});
 const ack={body:ackBody,timestamp:String(t),mac:mac(execSecret,t+'\\n'+ackBody),secure:true};
 assert.equal(system.orders.ack(ack).status,'RECORDED');
 assert.equal(system.orders.report().brokerAcks,1);
 assert.equal(system.orders.report().filledAcks,1);
 assert.equal(system.orders.report().brokerIndependentlyVerifiedFills,0,
  'An EA-reported deal number is not independent broker verification');
 assert.equal(system.orders.ack(ack).status,'DUPLICATE');
 assert.equal(system.orders.report().brokerAcks,1);
});
