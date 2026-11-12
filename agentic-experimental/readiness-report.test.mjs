import test from 'node:test';
import assert from 'node:assert/strict';
import {buildExperimentReadiness} from './readiness-report.mjs';
test('readiness does not mistake BLS outage or synthetic tests for actual trading',()=>{
 const s=buildExperimentReadiness({bls:{status:'FEED_ERROR',lastError:'BLS_RATE_OR_DAILY_LIMIT'},
  brain:{status:'READY_FOR_VERIFIED_DEMO_CONTEXT'},demo:{brokerConnected:false},
  journal:{persistenceConnected:true},smoke:{status:'SYNTHETIC_SELF_TEST_PASSED'}});
 assert.equal(s.status,'EXPERIMENTAL_NOT_TRADE_READY');
 assert.ok(s.blockers.includes('DEMO_BROKER_SENSOR'));
 assert.ok(s.blockers.includes('FXSTREET_LIVE_NEWS'));
 assert.equal(s.steps.find(x=>x.id==='SHADOW_PIPELINE').status,'SYNTHETIC_TEST_PASS');
 assert.equal(s.liveTradeAllowed,false);
 assert.equal(s.demoTradeAllowed,false);
});
test('all optional inputs present still never authorize trading',()=>{
 const s=buildExperimentReadiness({bls:{status:'OBSERVING'},
  brain:{status:'READY_FOR_VERIFIED_DEMO_CONTEXT'},demo:{brokerConnected:true},
  journal:{persistenceConnected:true},smoke:{status:'SYNTHETIC_SELF_TEST_PASSED'},
  fxStreetAuthorized:true,officialReleaseVerified:true});
 assert.equal(s.ordersCreated,0);
 assert.equal(s.demoTradeAllowed,false);
 assert.equal(s.productionChanged,false);
});

test('working FRED historical substitute does not assert realtime news readiness',()=>{
 const s=buildExperimentReadiness({bls:{status:'FEED_ERROR',lastError:'BLS_AUTHORIZATION_FAILED'},
  fred:{status:'OBSERVING_HISTORICAL'},brain:{status:'READY_FOR_VERIFIED_DEMO_CONTEXT'},
  demo:{brokerConnected:false},journal:{persistenceConnected:true},
  smoke:{status:'SYNTHETIC_SELF_TEST_PASSED'}});
 const historical=s.steps.find(x=>x.id==='HISTORICAL_ECONOMIC_DATA');
 assert.equal(historical.status,'FRED_REFERENCE_READY');
 assert.equal(historical.source,'FRED_BLS_HISTORICAL_REFERENCE');
 assert.ok(s.blockers.includes('FXSTREET_LIVE_NEWS'));
 assert.equal(s.demoTradeAllowed,false);
});

test('demo intent channel armed does not imply broker fill or independent verification',()=>{
 const r=buildExperimentReadiness({brain:{status:'READY_FOR_VERIFIED_DEMO_CONTEXT'},
  autoBrain:{enabled:true,completed:4},demo:{brokerConnected:true},
  execution:{enabled:true,executorOnline:true,filledAcks:1},
  journal:{persistenceConnected:true},smoke:{status:'SYNTHETIC_SELF_TEST_PASSED'}});
 assert.equal(r.steps.find(x=>x.id==='DEMO_EXECUTOR_AUTH').status,'CONNECTED');
 assert.equal(r.steps.find(x=>x.id==='DEMO_BROKER_FILL_VERIFICATION').status,'UNVERIFIED');
 assert.equal(r.demoExecutorRecentlyOnline,true);
 assert.equal(r.eaReportedFillsWithDealReference,1);
 assert.equal(r.independentlyVerifiedBrokerFills,0);
 assert.equal(r.demoTradeAllowed,false);
});
test('registered but offline executor remains blocked in readiness even with active research',()=>{
 const r=buildExperimentReadiness({brain:{status:'READY_FOR_VERIFIED_DEMO_CONTEXT'},
  autoBrain:{enabled:true,completed:12},demo:{brokerConnected:true},
  execution:{enabled:true,executorRegistered:true,executorOnline:false},
  journal:{persistenceConnected:true}});
 const exec=r.steps.find(x=>x.id==='DEMO_EXECUTOR_AUTH');
 assert.equal(exec.status,'WAITING_FOR_EXECUTOR_POLL');
 assert.equal(r.demoExecutorRecentlyOnline,false);
 assert.equal(r.ordersCreated,0);
});
