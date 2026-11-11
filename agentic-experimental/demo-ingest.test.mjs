import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoIngest,signDemoEnvelope} from './demo-ingest.mjs';
const now=1800000000,secret='unit-test-demo-only-32-byte-secret-123456';
const bars=(duration)=>[3,2,1].map(i=>({time:now-duration*i,open:100,high:101,low:99,close:100.3}));
const snapshot={environment:'EXPERIMENTAL_NABD_AGENTIC',accountType:'DEMO',
 executionEnabled:false,symbol:'XAUUSD',brokerServer:'Independent-JustMarkets-Demo',
 timestamp:now-1,bid:100,ask:100.2,tickSize:0.01,tickValue:1,contractSize:1,
 candlesM5:bars(300),candlesM15:bars(900),candlesH1:bars(3600),candlesH4:bars(14400)};
const body=(snap=snapshot)=>JSON.stringify({source:'ISOLATED_MT5_DEMO_SENSOR',
 capturedAt:now,ordersSupported:false,symbols:{XAUUSD:snap}});
const signed=(value)=>({body:value,timestamp:String(now),signature:signDemoEnvelope(secret,now,value)});
test('valid HMAC only accepts fresh dedicated DEMO sensor data',()=>{
 const ingest=createDemoIngest({secret,clock:()=>now});
 const r=ingest.receive(signed(body()));
 assert.equal(r.status,'OBSERVED');assert.equal(r.modelCalled,false);
 assert.equal(ingest.report().markets.XAUUSD.status,'SENSOR_OBSERVED');
 assert.equal(ingest.report().allowTrading,false);
});
test('ingestion disabled without 32-byte secret',()=>{
 const ingest=createDemoIngest({clock:()=>now});
 const r=ingest.receive(signed(body()));
 assert.equal(r.code,'INGEST_DISABLED');
 assert.equal(ingest.report().authentication,'DISABLED');
});
test('rejects unsigned, tampered, stale and HTTP payloads',()=>{
 const ingest=createDemoIngest({secret,clock:()=>now});
 assert.equal(ingest.receive({...signed(body()),signature:'0'.repeat(64)}).code,'SIGNATURE_INVALID');
 assert.equal(ingest.receive({...signed(body()),secure:false}).code,'HTTPS_REQUIRED');
 assert.equal(ingest.receive({...signed(body()),timestamp:String(now-30)}).code,'REQUEST_TOO_OLD');
 assert.equal(ingest.receive({...signed(body()),body:body()+' '}).code,'SIGNATURE_INVALID');
});
test('rejects replay and LIVE account snapshots',()=>{
 const ingest=createDemoIngest({secret,clock:()=>now});
 const request=signed(body());
 assert.equal(ingest.receive(request).status,'OBSERVED');
 assert.equal(ingest.receive(request).code,'REPLAY_DETECTED');
 const live=signed(body({...snapshot,accountType:'LIVE'}));
 assert.equal(ingest.receive(live).code,'MARKET_SNAPSHOT_INVALID');
});
test('rejects out-of-order quotes and a synthetic broker impersonation',()=>{
 let time=now;
 const ingest=createDemoIngest({secret,clock:()=>time});
 assert.equal(ingest.receive(signed(body())).status,'OBSERVED');
 time++;
 const earlier=signed(body({...snapshot,timestamp:now-2}));
 earlier.timestamp=String(time);
 earlier.signature=signDemoEnvelope(secret,time,earlier.body);
 assert.equal(ingest.receive(earlier).code,'OUT_OF_ORDER_BROKER_QUOTE');
 const fake=signed(body({...snapshot,brokerServer:'SYNTHETIC-Demo'}));
 fake.timestamp=String(time);
 fake.signature=signDemoEnvelope(secret,time,fake.body);
 assert.equal(ingest.receive(fake).code,'BROKER_IDENTITY_UNVERIFIED');
});
