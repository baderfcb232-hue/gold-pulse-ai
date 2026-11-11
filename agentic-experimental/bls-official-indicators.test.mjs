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
test('no-key batch of three official series uses one POST',async()=>{
 const requests=[];
 const data=await fetchBlsIndicators({now,fetcher:async (url,opts)=>{
  requests.push({url,opts});return {ok:true,json:async()=>({status:'REQUEST_SUCCEEDED',
    Results:{series:BLS_SERIES.map(s=>response(s.id).Results.series[0])}})};
 }});
 assert.equal(data.length,3);assert.equal(requests.length,1);
 assert.equal(requests[0].url,'https://api.bls.gov/publicAPI/v1/timeseries/data/');
 assert.equal(requests[0].opts.method,'POST');
 assert.deepEqual(JSON.parse(requests[0].opts.body).seriesid,BLS_SERIES.map(x=>x.id));
});
test('BLS quota response is identified without exposing upstream message',async()=>{
 await assert.rejects(()=>fetchBlsIndicators({now,fetcher:async()=>({ok:true,
  json:async()=>({status:'REQUEST_NOT_PROCESSED',message:['Daily limit exceeded']})})}),/BLS_RATE_OR_DAILY_LIMIT/);
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

test('optional registered BLS v2 uses isolated API key only in request body',async()=>{
 const requests=[];
 const data=await fetchBlsIndicators({now,registrationKey:'test-registration-key',fetcher:async(url,options)=>{
  requests.push({url,body:JSON.parse(options.body)});
  return {ok:true,json:async()=>({status:'REQUEST_SUCCEEDED',Results:{series:BLS_SERIES.map(s=>response(s.id).Results.series[0])}})};
 }});
 assert.equal(data.length,3);
 assert.equal(requests[0].url,'https://api.bls.gov/publicAPI/v2/timeseries/data/');
 assert.equal(requests[0].body.registrationkey,'test-registration-key');
 assert.equal(requests.length,1);
});

test('BLS v1 official documented Results array is accepted for all three series',async()=>{
 const result={status:'REQUEST_SUCCEEDED',Results:[{series:BLS_SERIES.map(s=>response(s.id).Results.series[0])}]};
 const data=await fetchBlsIndicators({now,registrationKey:'',fetcher:async()=>({ok:true,json:async()=>result})});
 assert.equal(data.length,3);
 assert.equal(data[0].seriesId,'CUUR0000SA0');
 assert.equal(data[1].seriesId,'LNS14000000');
 assert.equal(data[2].seriesId,'CES0000000001');
 assert.equal(data.every(x=>x.eligibleForTrading===false),true);
});
test('BLS recognized Results array is never mislabeled rejected request',async()=>{
 const raw={status:'REQUEST_SUCCEEDED',Results:[{series:[response('CUUR0000SA0').Results.series[0]]}]};
 const {describeBlsFailure}=await import('./bls-official-indicators.mjs');
 assert.equal(describeBlsFailure(raw),null);
});
