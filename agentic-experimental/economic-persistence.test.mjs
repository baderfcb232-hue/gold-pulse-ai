import test from 'node:test';
import assert from 'node:assert/strict';
import {createEconomicCalendarMonitor} from './economic-calendar-monitor.mjs';
const eventAt=1800000600,source='TRADING_ECONOMICS_CALENDAR_REFERENCE';
test('calendar restart recovers pre-release forecast and first actual from journal',async()=>{
 const forecasts=new Map(),actuals=new Map();
 const journal={
  firstForecast:async({id})=>forecasts.get(id)||null,
  saveForecast:async({id,raw,observedAt})=>{if(!forecasts.has(id))forecasts.set(id,{raw,observedAt});return {inserted:true}},
  firstActual:async({id})=>actuals.get(id)||null,
  saveActual:async({id,raw,observedAt})=>{if(!actuals.has(id))actuals.set(id,{raw,observedAt});return {inserted:true}}
 };
 let now=eventAt-120,actualRaw='',forecastRaw='150K';
 const load=async()=>({source,verifiedForImmediateTrigger:false,events:[{
   id:'77',title:'NFP',eventAt,actualRaw,forecastRaw,previousRaw:'120K'
 }]});
 const first=createEconomicCalendarMonitor({key:'mock',load,clock:()=>now,journalProvider:()=>journal});
 assert.equal((await first.poll()).status,'OBSERVED');
 assert.equal(forecasts.get('77').raw,'150K');
 now=eventAt+60;actualRaw='180K';forecastRaw='250K';
 const restarted=createEconomicCalendarMonitor({key:'mock',load,clock:()=>now,journalProvider:()=>journal});
 assert.equal((await restarted.poll()).status,'OBSERVED');
 const report=restarted.report();
 assert.equal(report.persistence,'ISOLATED_POSTGRES_JOURNAL');
 assert.equal(report.events[0].pointInTime.forecastAsObserved,'150K');
 assert.equal(report.events[0].pointInTime.difference,30000);
 assert.equal(report.events[0].signal,'WAIT');
 assert.equal(report.events[0].eligibleForAutoTrade,false);
});
test('journal failure is visible and blocks research result',async()=>{
 const monitor=createEconomicCalendarMonitor({key:'mock',clock:()=>eventAt+50,
  journalProvider:()=>({firstForecast:async()=>{throw Error('JOURNAL_DOWN')}}),
  load:async()=>({source,verifiedForImmediateTrigger:false,
   events:[{id:'77',title:'NFP',eventAt,actualRaw:'180K',forecastRaw:'150K'}]})});
 assert.equal((await monitor.poll()).status,'ERROR');
 assert.equal(monitor.report().status,'FEED_ERROR');
});
