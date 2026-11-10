import test from 'node:test';
import assert from 'node:assert/strict';
import {createEconomicCalendarMonitor} from './economic-calendar-monitor.mjs';
const eventAt=1800000300;
let now=eventAt-120,actualRaw='';
const snapshot=()=>({source:'TRADING_ECONOMICS_CALENDAR_REFERENCE',verifiedForImmediateTrigger:false,events:[{
 id:'77',title:'Employment Situation',eventAt,actualRaw,forecastRaw:'150K',previousRaw:'120K'}]});
test('pre-release forecast is preserved for research on later actual',async()=>{
 let time=eventAt-120,value='';
 const m=createEconomicCalendarMonitor({key:'MOCK',clock:()=>time,load:async()=>({
  source:'TRADING_ECONOMICS_CALENDAR_REFERENCE',verifiedForImmediateTrigger:false,
  events:[{id:'77',title:'NFP',eventAt,actualRaw:value,forecastRaw:time<eventAt?'150K':'250K',previousRaw:'120K'}]})});
 await m.poll();assert.equal(m.report().preReleaseSnapshots,1);
 time=eventAt+60;value='180K';await m.poll();
 const e=m.report().events[0];assert.equal(e.pointInTime.difference,30000);
 assert.equal(e.pointInTime.forecastAsObserved,'150K');
 assert.equal(e.actualFirstObservedAt,new Date(time*1000).toISOString());
 assert.equal(e.eligibleForAutoTrade,false);assert.equal(e.releaseTimestampVerified,false);
});
test('first seen after release does not trust revised forecast',async()=>{
 const m=createEconomicCalendarMonitor({key:'MOCK',clock:()=>eventAt+30,load:async()=>({
  ...snapshot(),events:[{id:'77',title:'NFP',eventAt,actualRaw:'180K',forecastRaw:'170K'}]})});
 await m.poll();const e=m.report().events[0];
 assert.equal(e.pointInTime.status,'NO_PRE_RELEASE_FORECAST_SNAPSHOT');
 assert.equal(e.comparison,null);assert.equal(e.signal,'WAIT');
});
test('provider failures retain error',async()=>{
 const m=createEconomicCalendarMonitor({key:'MOCK',clock:()=>eventAt+30,load:async()=>{throw Error('NO_PROVIDER_ACCESS')}});
 assert.equal((await m.poll()).status,'ERROR');assert.equal(m.report().status,'FEED_ERROR');
});
test('no calendar key means no fabricated releases',async()=>{
 const m=createEconomicCalendarMonitor();
 assert.equal((await m.poll()).status,'NOT_CONFIGURED');
 assert.equal(m.report().events.length,0);assert.equal(m.report().autoTradingEnabled,false);
});
test('restarts clear volatile snapshots',async()=>{
 const m=createEconomicCalendarMonitor({key:'MOCK',clock:()=>eventAt+30,load:async()=>snapshot()});
 assert.equal(m.report().preReleaseSnapshots,0);
});
