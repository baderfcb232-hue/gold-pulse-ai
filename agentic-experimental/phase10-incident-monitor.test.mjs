import test from 'node:test';
import assert from 'node:assert/strict';
import {createIncidentMonitor} from './phase10-incident-monitor.mjs';
let now=1800000000;
const blocked=(reason='BROKER_QUOTE_STALE')=>({markets:{
 XAUUSD:{status:'BLOCKED',reasons:[reason]},
 BTCUSD:{status:'READY_TO_OBSERVE_ONLY',reasons:[]}}});
const healthy=()=>({markets:Object.fromEntries(['XAUUSD','BTCUSD'].map(x=>
 [x,{status:'READY_TO_OBSERVE_ONLY',reasons:[]}]))});
const stamp=t=>new Date(t*1000).toISOString();
test('records one incident, keeps gold and BTC separate, no orders',()=>{
 now=1800000000;const m=createIncidentMonitor({clock:()=>now});
 m.ingest(blocked());m.ingest(blocked());
 const r=m.report();
 assert.equal(r.counters.opened,1);assert.equal(r.active.length,1);
 assert.equal(r.active[0].symbol,'XAUUSD');
 assert.equal(r.executionAllowed,false);
 assert.equal(r.automaticRemediation,false);
 assert.equal(r.restartsTriggered,0);
});
test('never claims recovery from repeated GET on same snapshot',()=>{
 now=1800000000;const m=createIncidentMonitor({clock:()=>now});
 m.ingest(blocked());now++;
 m.ingest(healthy(),{observations:{XAUUSD:stamp(now)}});
 m.ingest(healthy(),{observations:{XAUUSD:stamp(now)}});
 assert.equal(m.report().active.length,1);
 assert.equal(m.report().active[0].recoveryObservations,1);
 now++;m.ingest(healthy(),{observations:{XAUUSD:stamp(now)}});
 assert.equal(m.report().active.length,0);
 assert.equal(m.report().counters.resolved,1);
});
test('new failure clears prior recovery evidence',()=>{
 now=1800000000;const m=createIncidentMonitor({clock:()=>now});
 m.ingest(blocked());now++;
 m.ingest(healthy(),{observations:{XAUUSD:stamp(now)}});
 m.ingest(blocked('SENSOR_HEARTBEAT_STALE'));
 now++;m.ingest(healthy(),{observations:{XAUUSD:stamp(now)}});
 assert.equal(m.report().active.length,1);
 assert.equal(m.report().active[0].recoveryObservations,1);
});
test('missing quality result opens a safe incident; invalid reasons are redacted',()=>{
 now=1800000000;const m=createIncidentMonitor({clock:()=>now,maxHistory:1});
 m.ingest({markets:{XAUUSD:{status:'BLOCKED',reasons:['password=secret']}}});
 const r=m.report();
 assert.equal(r.active.length,2);
 assert.equal(r.active[0].reasons[0],'UNVERIFIED_REASON');
 assert.equal(JSON.stringify(r).includes('password=secret'),false);
 assert.equal(r.events.length,1);
});
test('empty heartbeat never resolves otherwise healthy results',()=>{
 now=1800000000;const m=createIncidentMonitor({clock:()=>now});
 m.ingest(blocked());m.ingest(healthy());
 assert.equal(m.report().counters.resolved,0);
});
