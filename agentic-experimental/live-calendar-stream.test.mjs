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
