import test from 'node:test';
import assert from 'node:assert/strict';
import {previewEconomicEvent,createEconomicCalendarMonitor} from './economic-calendar-monitor.mjs';
const event={id:'123',title:'CPI',eventAt:1800000000,actualRaw:'3.2%',forecastRaw:'3.0%',previousRaw:'2.9%'};
const time=1800000100;
test('actual vs forecast yields a preview, not a trade decision',()=>{
 const s=previewEconomicEvent(event);
 assert.equal(s.comparison.direction,'ABOVE_FORECAST');
 assert.ok(Math.abs(s.comparison.difference-0.2)<1e-8);
 assert.equal(s.eligibleForAutoTrade,false);
 assert.equal(s.releaseTimestampVerified,false);
 assert.equal(s.signal,'WAIT');
});
test('missing forecast blocks surprise preview',()=>{
 const s=previewEconomicEvent({...event,forecastRaw:'N/A'});
 assert.equal(s.status,'INCOMPLETE_DATA');assert.equal(s.comparison,null);
});
test('incompatible units block comparison',()=>{
 const s=previewEconomicEvent({...event,actualRaw:'3%',forecastRaw:'300K'});
 assert.equal(s.comparison,null);
});
test('unconfigured source explicitly blocked',async()=>{
 const m=createEconomicCalendarMonitor();
 assert.equal((await m.poll()).status,'NOT_CONFIGURED');
 assert.equal(m.report().realTimeSurpriseEnabled,false);
});
test('configured mock source exposes only safe snapshots',async()=>{
 const m=createEconomicCalendarMonitor({key:'mock',clock:()=>time,load:async()=>({
 source:'TRADING_ECONOMICS_CALENDAR_REFERENCE',verifiedForImmediateTrigger:false,events:[event]})});
 assert.equal((await m.poll()).status,'OBSERVED');
 assert.equal(m.report().count,1);
 assert.equal(m.report().autoTradingEnabled,false);
});
test('vendor claim of verified triggers is rejected',async()=>{
 const m=createEconomicCalendarMonitor({key:'mock',clock:()=>time,load:async()=>({
 source:'TRADING_ECONOMICS_CALENDAR_REFERENCE',verifiedForImmediateTrigger:true,events:[event]})});
 assert.equal((await m.poll()).status,'ERROR');
 assert.equal(m.report().status,'FEED_ERROR');
});
test('calendar upstream failure stays visible',async()=>{
 const m=createEconomicCalendarMonitor({key:'mock',clock:()=>time,load:async()=>{throw Error('HTTP_429')}});
 assert.equal((await m.poll()).status,'ERROR');
 assert.equal(m.report().lastError,'HTTP_429');
});
