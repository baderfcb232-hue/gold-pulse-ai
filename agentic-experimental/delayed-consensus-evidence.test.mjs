import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDelayedCalendar,createDelayedCalendarMonitor} from './delayed-consensus.mjs';
const now=1794399000;
const row=(actual,forecast,previous)=>({country:'US',impact:'High',title:'NFP',
 datetime_utc:'2026-11-11T10:30:00Z',actual,forecast,previous,status:'printed'});
test('counts observed complete and incomplete triples',async()=>{
 const m=createDelayedCalendarMonitor({clock:()=>now,load:async()=>parseDelayedCalendar({
 meta:{delay_sec:3600},data:{events:[
 row('180K','150K','120K'),row('3.1%',null,'3.0%'),row('1.2%','1.0%',null),
 row(null,'140K','120K'),row('not released','135K','100K')
 ]}},{now})});
 const r=await m.poll();
 assert.equal(r.status,'OBSERVING_DELAYED_REFERENCE');
 assert.equal(r.evidence.events,5);
 assert.equal(r.evidence.allThreeComparable,1);
 assert.equal(r.evidence.actualPresent,3);
 assert.equal(r.evidence.forecastPresent,4);
 assert.equal(r.evidence.previousPresent,4);
 assert.equal(m.report().verificationLevel,'VENDOR_OBSERVATION_ONLY');
 assert.equal(m.report().tradingEnabled,false);
});
test('numeric provider fields are not silently dropped',()=>{
 const d=parseDelayedCalendar({data:{events:[row(3.2,3.0,2.9)]}},{now});
 assert.equal(d.events[0].actualRaw,'3.2');
 assert.equal(d.events[0].forecastRaw,'3');
 assert.equal(d.events[0].previousRaw,'2.9');
});
test('provider outage clears evidence instead of retaining stale triples',async()=>{
 let fail=false;
 const m=createDelayedCalendarMonitor({clock:()=>now,load:async()=>{if(fail)throw Error('UNAVAILABLE');
 return parseDelayedCalendar({data:{events:[row('180K','150K','120K')]}},{now});}});
 await m.poll();assert.equal(m.report().evidence.allThreeComparable,1);
 fail=true;await m.poll();assert.equal(m.report().status,'FEED_ERROR');
 assert.equal(m.report().evidence.allThreeComparable,0);
});
