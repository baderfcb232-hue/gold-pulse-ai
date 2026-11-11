import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDelayedCalendar,createDelayedCalendarMonitor} from './delayed-consensus.mjs';
const now=Math.floor(Date.parse('2026-11-11T13:00:00Z')/1000);
const payload={meta:{delay_sec:3600},data:{events:[{
 country:'US',impact:'High',title:'Consumer Price Index',datetime_utc:'2026-11-11T12:30:00Z',
 actual:'3.2%',forecast:'3.0%',previous:'2.9%',status:'printed'
}]}};
test('delayed consensus remains unverified and never tradable',()=>{
 const d=parseDelayedCalendar(payload,{now});
 assert.equal(d.events.length,1);
 assert.equal(d.events[0].comparison.direction,'ABOVE_FORECAST');
 assert.equal(d.events[0].forecastPointInTimeVerified,false);
 assert.equal(d.events[0].tradeEligible,false);
 assert.equal(d.live,false);assert.equal(d.autoTradeEnabled,false);
});
test('invalid vendor responses fail closed',()=>{
 assert.throws(()=>parseDelayedCalendar({}, {now}),/DELAYED_CALENDAR_SCHEMA_INVALID/);
});
test('US high impact filtering and timestamp validation',()=>{
 const data={data:{events:[{...payload.data.events[0],country:'GB'},
   {...payload.data.events[0],impact:'Low'},
   {...payload.data.events[0],datetime_utc:'not-a-date'}]}};
 assert.equal(parseDelayedCalendar(data,{now}).events.length,0);
});
test('unavailable vendor cannot show fake consensus',async()=>{
 const m=createDelayedCalendarMonitor({clock:()=>now,load:async()=>{throw Error('HTTP_403')}});
 assert.equal((await m.poll()).status,'FEED_ERROR');
 assert.equal(m.report().events.length,0);
 assert.equal(m.report().newsTriggerEnabled,false);
});
test('valid observation is still always research only',async()=>{
 const m=createDelayedCalendarMonitor({clock:()=>now,load:async()=>parseDelayedCalendar(payload,{now})});
 assert.equal((await m.poll()).status,'OBSERVING_DELAYED_REFERENCE');
 assert.equal(m.report().realTime,false);
 assert.equal(m.report().independentActualVerification,false);
});
