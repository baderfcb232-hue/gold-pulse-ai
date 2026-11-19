import test from 'node:test';
import assert from 'node:assert/strict';
import {assessIsolatedQuality as assess} from './phase9-quality-monitor.mjs';
const now=1800000000;
const observed={status:'SENSOR_OBSERVED',quoteAgeSeconds:1,
 multiTimeframeVerified:true,receivedAt:new Date((now-1)*1000).toISOString()};
const input=()=>({now,sensor:{authentication:'HMAC_SHA256_CONFIGURED',
 markets:{XAUUSD:observed,BTCUSD:observed}},autoBrain:{enabled:true},
 model:{status:'READY_FOR_VERIFIED_DEMO_CONTEXT'},
 journal:{status:'CONNECTED',persistenceConnected:true},
 durable:{markets:{XAUUSD:{scored:0},BTCUSD:{scored:0}}},forwardWriteFailures:0});
test('healthy sensor and journal are observation-only not trade readiness',()=>{
 const r=assess(input());
 assert.equal(r.status,'RESEARCH_OBSERVATION_READY');
 assert.equal(r.markets.XAUUSD.tradeAllowed,false);
 assert.equal(r.executionAllowed,false);assert.equal(r.brokerDealsVerified,false);
 assert.equal(r.markets.XAUUSD.hasForwardSamples,false);
});
test('fresh gold never hides missing Bitcoin sensor',()=>{
 const i=input();delete i.sensor.markets.BTCUSD;
 const r=assess(i);
 assert.equal(r.status,'RESEARCH_OBSERVATION_BLOCKED');
 assert.equal(r.markets.XAUUSD.status,'READY_TO_OBSERVE_ONLY');
 assert.ok(r.markets.BTCUSD.reasons.includes('NO_VERIFIED_SENSOR_OBSERVATION'));
});
test('stale receipt, quote and timeframe are individually reported',()=>{
 const i=input();i.sensor.markets.XAUUSD={...observed,status:'STALE',
  quoteAgeSeconds:11,multiTimeframeVerified:false,
  receivedAt:new Date((now-20)*1000).toISOString()};
 const reasons=assess(i).markets.XAUUSD.reasons;
 for(const s of ['SENSOR_NOT_RECENTLY_OBSERVED','BROKER_QUOTE_STALE',
  'UNVERIFIED_MULTI_TIMEFRAME','SENSOR_HEARTBEAT_STALE'])assert.ok(reasons.includes(s));
});
test('AI disabled and missing database are never treated as empty healthy sample',()=>{
 const i=input();i.autoBrain.enabled=false;i.journal={status:'NOT_CONFIGURED'};
 i.durable=null;
 const r=assess(i);
 assert.ok(r.markets.XAUUSD.reasons.includes('AUTO_RESEARCH_DISABLED'));
 assert.ok(r.markets.BTCUSD.reasons.includes('RESEARCH_POSTGRES_NOT_CONNECTED'));
 assert.ok(r.globalReasons.includes('DURABLE_METRICS_NOT_VERIFIED'));
});
test('failed persistence reports a blocker even when model and sensor work',()=>{
 const i=input();i.forwardWriteFailures=2;
 const r=assess(i);
 assert.ok(r.globalReasons.includes('FORWARD_JOURNAL_WRITE_FAILURES'));
 assert.equal(r.markets.BTCUSD.status,'BLOCKED');
});
