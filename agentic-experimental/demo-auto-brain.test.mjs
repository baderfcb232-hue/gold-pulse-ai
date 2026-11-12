import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoAutoBrain} from './demo-auto-brain.mjs';
import {createDemoIngest,signDemoEnvelope} from './demo-ingest.mjs';
import {HybridScheduler} from './hybrid-scheduler.mjs';

const now=1800000000,secret='isolated-tests-hmac-secret-32-bytes-12345';
function bars(duration){
 const t=Math.floor((now-10)/duration)*duration-duration;
 return [t-duration,t].map(time=>({time,open:100,high:101,low:99,close:100.4}));
}
function snapshot(symbol='XAUUSD'){
 return {environment:'EXPERIMENTAL_NABD_AGENTIC',accountType:'DEMO',
  executionEnabled:false,symbol,brokerServer:'Independent-JustMarkets-Demo',
  timestamp:now-1,bid:100,ask:100.2,tickSize:0.01,tickValue:1,contractSize:1,
  candlesM5:bars(300),candlesM15:bars(900),candlesH1:bars(3600),candlesH4:bars(14400)};
}
function ingress(input={}){
 const source={source:'ISOLATED_MT5_DEMO_SENSOR',capturedAt:now,
  ordersSupported:false,symbols:{XAUUSD:snapshot(),...input}};
 const body=JSON.stringify(source);
 const ingest=createDemoIngest({secret,clock:()=>now});
 const verdict=ingest.receive({body,timestamp:String(now),
  signature:signDemoEnvelope(secret,now,body),secure:true});
 return {ingest,verdict};
}
function fakeBrain(log){
 return {analyze:async(ctx)=>{
  log.push(ctx);
  return {status:'RESEARCH_ANALYSIS_ONLY',plan:{stance:'WAIT',confidence:0.6}};}};
}
function runner({brains,enabled=true,spreadLimits}={}){
 return createDemoAutoBrain({brains,scheduler:new HybridScheduler(),
  clock:()=>now,enabled,spreadLimits});
}
test('authenticated real-shape Demo snapshot automatically invokes AI research once per closed M5',async()=>{
 const called=[],{ingest,verdict}=ingress();
 assert.equal(verdict.status,'OBSERVED');
 const ai=runner({brains:{XAUUSD:fakeBrain(called)}});
 const safe=ingest.getLatest('XAUUSD');
 assert.equal(safe.executionEnabled,false);
 assert.equal(ai.onSnapshot(safe).scheduled,true);
 await ai.flush();
 assert.equal(called.length,1);assert.equal(called[0].accountType,'DEMO');
 assert.equal(called[0].candlesH4.length,2);
 assert.equal(called[0].news.classification,'NONE');
 assert.equal(ai.report().lastBySymbol.XAUUSD.stance,'WAIT');
 assert.equal(ai.onSnapshot(safe).reason,'NO_NEW_TRIGGER');
 assert.equal(ai.report().completed,1);
 assert.equal(ai.report().ordersCreated,0);
 assert.equal(ai.report().executionAllowed,false);
});
test('gold and Bitcoin broker snapshots can analyze concurrently without shared busy guard',async()=>{
 const calledG=[],calledB=[];
 const {ingest,verdict}=ingress({BTCUSD:snapshot('BTCUSD')});
 assert.deepEqual(verdict.symbols,['XAUUSD','BTCUSD']);
 const ai=runner({brains:{XAUUSD:fakeBrain(calledG),BTCUSD:fakeBrain(calledB)}});
 assert.equal(ai.onSnapshot(ingest.getLatest('XAUUSD')).scheduled,true);
 assert.equal(ai.onSnapshot(ingest.getLatest('BTCUSD')).scheduled,true);
 await ai.flush();
 assert.equal(calledG.length,1);assert.equal(calledB.length,1);
 assert.equal(ai.report().completed,2);
});
test('disabled auto-research never invokes a model',async()=>{
 const called=[],{ingest}=ingress();
 const ai=runner({brains:{XAUUSD:fakeBrain(called)},enabled:false});
 assert.equal(ai.onSnapshot(ingest.getLatest('XAUUSD')).reason,'AUTO_RESEARCH_DISABLED');
 await ai.flush();assert.equal(called.length,0);
});
test('broker spread is independently capped and cannot be justified by model output',async()=>{
 const called=[],{ingest}=ingress();
 const ai=runner({brains:{XAUUSD:fakeBrain(called)},spreadLimits:{XAUUSD:0.1,BTCUSD:80}});
 assert.equal(ai.onSnapshot(ingest.getLatest('XAUUSD')).scheduled,true);
 await ai.flush();
 assert.equal(called.length,0);
 assert.equal(ai.report().lastBySymbol.XAUUSD.reason,'BROKER_SPREAD_TOO_WIDE');
});
test('invalid LIVE provenance never schedules model calls',async()=>{
 const ai=runner({brains:{XAUUSD:fakeBrain([])}});
 assert.equal(ai.onSnapshot({...snapshot(),accountType:'LIVE'}).reason,'INVALID_BROKER_SNAPSHOT');
 assert.equal(ai.report().ordersCreated,0);
});
test('AI API failures fail closed and are auditable',async()=>{
 const {ingest}=ingress();
 const ai=runner({brains:{XAUUSD:{analyze:async()=>({status:'BLOCKED',
  reasons:['AI_ANALYSIS_FAILED']})}}});
 ai.onSnapshot(ingest.getLatest('XAUUSD'));await ai.flush();
 assert.equal(ai.report().completed,0);
 assert.equal(ai.report().lastBySymbol.XAUUSD.reason,'AI_ANALYSIS_FAILED');
});
