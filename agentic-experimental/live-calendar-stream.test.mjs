import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStreamCalendarMessage,createLiveCalendarStream} from './live-calendar-stream.mjs';
const now=1794400200,at=1794400140;
const base={topic:'calendar',country:'United States',importance:3,
 calendarId:'334445',event:'Consumer Price Index',date:new Date(at*1000).toISOString(),
 actual:'3.2%',forecast:'3.0%',previous:'2.9%'};
test('parse live event fields without promising independent latency',()=>{
 const r=parseStreamCalendarMessage(JSON.stringify(base),now);
 assert.equal(r.accepted,true);
 assert.equal(r.event.allThreeComparable,true);
 assert.equal(r.event.comparison.direction,'ABOVE_FORECAST');
 assert.equal(r.event.officialPublicationTimestampVerified,false);
 assert.equal(r.event.eligibleForExecution,false);
});
test('reject wrong topic, lower importance, country and malformed data',()=>{
 for(const b of [{...base,topic:'news'},{...base,importance:1},{...base,country:'GB'},
 {...base,date:'not date'},{...base,calendarId:'oops'}])
  assert.equal(parseStreamCalendarMessage(b,now).accepted,false);
 assert.equal(parseStreamCalendarMessage('invalid',now).accepted,false);
});
test('no credentials causes no WebSocket connection',()=>{
 let called=false;
 const s=createLiveCalendarStream({key:'',secret:'',wsFactory:()=>{called=true;}});
 s.connect();assert.equal(called,false);
 assert.equal(s.report().status,'NOT_CONFIGURED');
 assert.equal(s.report().realtimeNewsTradingEnabled,false);
});
test('socket subscribes to calendar, never to orders',()=>{
 const listeners=new Map(),sent=[];
 const socket={addEventListener:(k,f)=>listeners.set(k,f),send:(s)=>sent.push(JSON.parse(s)),close:()=>{}};
 const s=createLiveCalendarStream({key:'test-key',secret:'test-secret',
 wsFactory:()=>socket,clock:()=>now});
 s.connect();listeners.get('open')();
 assert.deepEqual(sent,[{topic:'subscribe',to:'calendar'}]);
 assert.equal(s.report().status,'SUBSCRIBED_UNVERIFIED');
 assert.equal(s.report().tradeExecutionEnabled,false);s.stop();
});
test('observing incoming event remains research-only',async()=>{
 const listeners=new Map();
 const socket={addEventListener:(k,f)=>listeners.set(k,f),send:()=>{},close:()=>{}};
 const s=createLiveCalendarStream({key:'test-key',secret:'test-secret',
 wsFactory:()=>socket,clock:()=>now});
 s.connect();listeners.get('open')();listeners.get('message')({data:JSON.stringify(base)});
 await new Promise(resolve=>setImmediate(resolve));
 const v=s.report();
 assert.equal(v.acceptedEvents,1);
 assert.equal(v.allThreeComparableEvents,1);
 assert.equal(v.latestEvents[0].eligibleForExecution,false);
 assert.equal(v.independentlyMeasuredLatency,false);s.stop();
});

test('parses actual Trading Economics stream documentation example including trailing-space Forecast key',()=>{
 const event={topic:'calendar',country:'United States',category:'Inflation Expectations',event:'Consumer Inflation Expectations',
  calendarId:'324314',importance:'3',date:new Date(at*1000).toISOString(),
  actual:'3.8%',previous:'4.1%',teforecast:'3.9%', 'forecast ':'3.7%'};
 const r=parseStreamCalendarMessage(event,now);
 assert.equal(r.accepted,true);
 assert.equal(r.event.forecastRaw,'3.7%');
 assert.equal(r.event.allThreeComparable,true);
 assert.equal(r.event.comparison.direction,'ABOVE_FORECAST');
 assert.equal(r.event.eligibleForExecution,false);
});
test('does not replace absent consensus Forecast with TEForecast or null placeholder',()=>{
 const event={...base,forecast:'None',teforecast:'3.0%'};
 const r=parseStreamCalendarMessage(event,now);
 assert.equal(r.accepted,true);
 assert.equal(r.event.hasForecast,false);
 assert.equal(r.event.allThreeComparable,false);
 assert.equal(r.event.forecastRaw,null);
});

test('configuration report identifies missing streaming entitlements without leaking credentials',()=>{
 const stream=createLiveCalendarStream({key:'',secret:'',wsFactory:()=>{throw Error('should not run')}});
 stream.connect();
 const report=stream.report();
 assert.equal(report.authorizationState,'CREDENTIALS_MISSING');
 assert.deepEqual(report.missingConfiguration,['NABD_TEST_TRADING_ECONOMICS_STREAM_KEY','NABD_TEST_TRADING_ECONOMICS_STREAM_SECRET']);
 assert.equal(report.noKeyAlternativeRealTimeConsensusAvailable,false);
 assert.equal(report.realtimeNewsTradingEnabled,false);
});

test('early Actual and conflicting normalized Forecast fields are rejected',()=>{
 const earlier=parseStreamCalendarMessage({...base,date:new Date((now+60)*1000).toISOString()},now);
 assert.equal(earlier.accepted,false);
 assert.equal(earlier.reason,'ACTUAL_BEFORE_SCHEDULE');
 const contradictory=parseStreamCalendarMessage({...base,'forecast ':'9.9%'},now);
 assert.equal(contradictory.reason,'CONFLICTING_FIELDS');
});
test('after-release Forecast revision cannot replace immutable first pre-release observation',async()=>{
 const release=now+120;
 let time=now;
 const messages=new Map(),stored=new Map();
 const journal={
  async saveForecast(e){await new Promise(resolve=>setImmediate(resolve));if(!stored.has(e.id))stored.set(e.id,{raw:e.raw,observedAt:e.observedAt});},
  async saveActual(){},
  async firstForecast(e){return stored.get(e.id)||null;}
 };
 const socket={addEventListener:(kind,fn)=>messages.set(kind,fn),send:()=>{},close:()=>{}};
 const stream=createLiveCalendarStream({key:'test',secret:'test',clock:()=>time,
  journalProvider:()=>journal,wsFactory:()=>socket});
 const event={...base,date:new Date(release*1000).toISOString(),actual:'',forecast:'3.0%'};
 stream.connect();messages.get('open')();
 messages.get('message')({data:JSON.stringify(event)});
 time=release+2;
 messages.get('message')({data:JSON.stringify({...event,actual:'3.5%',forecast:'3.4%'})});
 // First message must finish saving its historical baseline before second is recorded.
 for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));
 const observed=stream.report().latestEvents[0];
 assert.equal(observed.forecastAsObservedBeforeRelease,'3.0%');
 assert.equal(observed.comparisonStatus,'PRE_RELEASE_FORECAST_RECORDED');
 assert.ok(Math.abs(observed.comparison.difference-0.5)<1e-8);
 assert.equal(observed.eligibleForExecution,false);
 stream.stop();
});
test('Actual seen without pre-release forecast never gets a trusted surprise',async()=>{
 const listeners=new Map();
 const socket={addEventListener:(k,fn)=>listeners.set(k,fn),send:()=>{},close:()=>{}};
 const stream=createLiveCalendarStream({key:'test',secret:'test',clock:()=>now,wsFactory:()=>socket});
 stream.connect();listeners.get('open')();
 listeners.get('message')({data:JSON.stringify({...base,forecast:'3.1%'})});
 for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));
 const row=stream.report().latestEvents[0];
 assert.equal(row.comparison,null);
 assert.equal(row.comparisonStatus,'NO_POINT_IN_TIME_BASELINE');
 assert.equal(row.eligibleForExecution,false);stream.stop();
});
