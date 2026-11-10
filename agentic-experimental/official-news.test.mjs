import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOfficialFeed,fetchOfficialHeadlines,createOfficialNewsMonitor} from './official-news.mjs';
const now=Math.floor(Date.parse('2026-11-10T13:00:00Z')/1000);
const pub='Tue, 10 Nov 2026 12:55:00 GMT';
const xml=(url='https://www.federalreserve.gov/newsevents/pressreleases/monetary20261110a.htm')=>
 '<rss><channel><item><title>Federal Reserve issues FOMC statement</title><link>'+url+'</link><pubDate>'+pub+'</pubDate></item></channel></rss>';
test('accept official Fed headline but never trigger execution',()=>{
 const news=parseOfficialFeed(xml(),'FED',now);
 assert.equal(news.length,1);assert.equal(news[0].topicRelevant,true);
 assert.equal(news[0].eligibleForAutoTrading,false);
 assert.equal(news[0].releaseTimestampVerified,false);
});
test('reject spoofed nonofficial link',()=>assert.equal(parseOfficialFeed(xml('https://evil.example/news'),'FED',now).length,0));
test('reject http links',()=>assert.equal(parseOfficialFeed(xml('http://www.federalreserve.gov/unsafe'),'FED',now).length,0));
test('reject invalid XML',()=>assert.throws(()=>parseOfficialFeed('broken','FED',now),/NEWS_INVALID_XML/));
test('reject unknown source',()=>assert.throws(()=>parseOfficialFeed(xml(),'OTHER',now),/NEWS_UNKNOWN_SOURCE/));
test('reject future-dated headlines',()=>assert.equal(parseOfficialFeed(xml().replace(pub,'Wed, 11 Nov 2026 13:00:00 GMT'),'FED',now).length,0));
test('partial provider failure stays explicit',async()=>{
 const result=await fetchOfficialHeadlines({now,fetcher:async url=>url.includes('bls.gov')?{ok:false,status:403}:
  {ok:true,text:async()=>xml()}});
 assert.equal(result[0].status,'OK');assert.equal(result[1].status,'ERROR');
});
test('monitor does not enable AI or trading',async()=>{
 const m=createOfficialNewsMonitor({clock:()=>now,load:async()=>[
  {status:'OK',source:'FED',items:parseOfficialFeed(xml(),'FED',now)},
  {status:'ERROR',source:'BLS',items:[],error:'NEWS_HTTP_403'}]});
 assert.equal((await m.poll()).status,'PARTIAL');
 assert.equal(m.report().automatedNewsTriggerEnabled,false);
 assert.equal(m.report().tradingEnabled,false);
});
