import test from 'node:test';
import assert from 'node:assert/strict';
import {createShadowFeedRunner} from './shadow-feed-runner.mjs';

const good={source:'BINANCE_SPOT_BTCUSDT_REFERENCE_ONLY',executable:false,
 brokerCompatible:false,symbol:'BTCUSD',bars:{M5:[{time:1770000000,close:90000}]},quote:{bid:90000,ask:90001}};

test('HTTP 418 enters vendor-respecting 30 minute backoff instead of hammering each minute',async()=>{
 let time=1800000000,calls=0;
 const feed=createShadowFeedRunner({
  clock:()=>time,
  load:async()=>{calls++;throw Error('REFERENCE_FEED_HTTP_418');}
 });
 const first=await feed.poll();
 assert.equal(first.status,'BACKOFF');
 assert.equal(first.code,'REFERENCE_FEED_HTTP_418');
 assert.equal(feed.report().status,'REFERENCE_PROVIDER_RATE_LIMIT_BACKOFF');
 time+=60;
 assert.equal((await feed.poll()).status,'SKIPPED');
 assert.equal(calls,1,'no retry while vendor ban is active');
 time+=1800;
 assert.equal((await feed.poll()).status,'BACKOFF');
 assert.equal(calls,2);
 assert.equal(feed.report().rateLimitHits,2);
 assert.equal(new Date(feed.report().nextAttemptAt).getTime()/1000-time,3600);
});

test('HTTP 429 backoff grows but caps at six hours',async()=>{
 let time=1800000000;
 const feed=createShadowFeedRunner({
  clock:()=>time,load:async()=>{throw Error('REFERENCE_FEED_HTTP_429');}
 });
 for(let i=0;i<7;i++){
  const r=await feed.poll();
  assert.equal(r.status,'BACKOFF');
  const next=Date.parse(r.nextAttemptAt)/1000;
  assert(next-time>=1800 && next-time<=21600);
  time=next;
 }
 assert.equal(feed.report().rateLimitHits,7);
 const r=await feed.poll();
 assert.equal(Date.parse(r.nextAttemptAt)/1000-time,21600);
});

test('successful polling after backoff resets penalty and stays read-only',async()=>{
 let time=1800000000,calls=0;
 const feed=createShadowFeedRunner({
  clock:()=>time,
  load:async()=>{calls++;if(calls===1)throw Error('REFERENCE_FEED_HTTP_418');return good;},
  scheduler:{consider:()=>({reason:'RESEARCH_ONLY',callAI:false}),report:()=>({})}
 });
 assert.equal((await feed.poll()).status,'BACKOFF');
 time+=1800;
 const observed=await feed.poll();
 assert.equal(observed.status,'OBSERVED');
 assert.equal(observed.observation.tradingEnabled,false);
 assert.equal(observed.observation.analysisExecuted,false);
 assert.equal(feed.report().rateLimitHits,0);
 assert.equal(feed.report().nextAttemptAt,null);
 assert.equal(feed.report().executionAllowed,false);
});

test('ordinary network failures remain observable without vendor ban backoff',async()=>{
 const feed=createShadowFeedRunner({
  clock:()=>1800000000,load:async()=>{throw Error('ECONNRESET');}
 });
 assert.equal((await feed.poll()).status,'ERROR');
 assert.equal(feed.report().lastError,'ECONNRESET');
 assert.equal(feed.report().rateLimitHits,0);
});
