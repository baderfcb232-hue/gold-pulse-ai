import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBlsResponse,fetchBlsIndicators,createBlsOfficialMonitor,BLS_SERIES} from './bls-official-indicators.mjs';
const now=1800000000;
const response=(id)=>({status:'REQUEST_SUCCEEDED',Results:{series:[{seriesID:id,data:[
 {year:'2026',period:'M09',value:'321.7'},{year:'2026',period:'M08',value:'320.1'},
 {year:'2026',period:'M13',value:'999999'}
]}]}});
test('official BLS numbers produce research-only observations',()=>{
 const v=parseBlsResponse(response('CUUR0000SA0'),'CUUR0000SA0',now);
 assert.equal(v.latestValue,321.7);assert.equal(v.previousValue,320.1);
 assert.equal(v.forecast,null);assert.equal(v.eligibleForTrading,false);
});
test('future or malformed response rejected',()=>{
 assert.throws(()=>parseBlsResponse({},'CUUR0000SA0',now),/BLS_INVALID_RESPONSE/);
 assert.throws(()=>parseBlsResponse(response('BAD'),'CUUR0000SA0',now),/BLS_MISSING_SERIES/);
});
test('no-key three official series load with fixed host',async()=>{
 const urls=[];
 const data=await fetchBlsIndicators({now,fetcher:async url=>{
  urls.push(url);return {ok:true,json:async()=>response(url.split('/').at(-1))};
 }});
 assert.equal(data.length,3);assert.equal(urls.length,3);
 assert.ok(urls.every(u=>u.startsWith('https://api.bls.gov/publicAPI/v1/timeseries/data/')));
});
test('monitor never claims surprise readiness',async()=>{
 const monitor=createBlsOfficialMonitor({clock:()=>now,load:async()=>BLS_SERIES.map(x=>parseBlsResponse(response(x.id),x.id,now))});
 assert.equal((await monitor.poll()).status,'OBSERVED');
 assert.equal(monitor.report().actualVsForecastReady,false);
 assert.equal(monitor.report().autoTradingEnabled,false);
});
test('upstream 403 does not fabricate data',async()=>{
 const monitor=createBlsOfficialMonitor({clock:()=>now,load:async()=>{throw Error('BLS_HTTP_403')}});
 assert.equal((await monitor.poll()).status,'ERROR');
 assert.equal(monitor.report().series.length,0);
});
