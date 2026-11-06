import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {tickerItems,tickerFeedStatus} from '../public/news-ticker.js';

const NOW=1793980800;
const row=(category,title,url,seconds=120)=>({id:url,category,title,url,published_at:NOW-seconds,source_name:'Verified RSS'});
const feed={serverTime:NOW,items:[
 row('GOLD','Gold interest rate update','https://example.org/gold'),
 row('BTC','Bitcoin adoption update','https://example.org/btc',60),
 row('ECON','Unrelated business story','https://example.org/econ',40),
 row('WORLD','Unrelated world story','https://example.org/world',30),
 row('GOLD','Unsafe link','javascript:alert(1)',10),
 row('BTC','Old Bitcoin story','https://example.org/old',8*24*60*60),
 row('GOLD','Future publication','https://example.org/future',-900),
 row('GOLD','Gold interest rate update','https://example.org/gold')
],sources:[{status:'LIVE',last_success:NOW-60}]};

test('gold and Bitcoin ribbon never includes ECON, WORLD, old, future or invalid-source links',()=>{
 const all=tickerItems(feed,'ALL',NOW);
 assert.deepEqual(all.map(x=>x.category),['BTC','GOLD']);
 assert.deepEqual(tickerItems(feed,'GOLD',NOW).map(x=>x.url),['https://example.org/gold']);
 assert.deepEqual(tickerItems(feed,'BTC',NOW).map(x=>x.url),['https://example.org/btc']);
 assert.deepEqual(tickerItems(feed,'WORLD',NOW),[]);
 assert.equal(new Set(all.map(x=>x.url)).size,all.length);
});

test('RSS freshness status never confuses cached headlines with a live feed',()=>{
 assert.equal(tickerFeedStatus(feed,NOW),'LIVE');
 assert.equal(tickerFeedStatus({...feed,sources:[{status:'LIVE',last_success:NOW-3600}]},NOW),'STALE');
 assert.equal(tickerFeedStatus({...feed,sources:[{status:'ERROR',last_success:null}]},NOW),'STALE');
 assert.equal(tickerFeedStatus({...feed,sources:[{status:'PENDING',last_success:null}]},NOW),'PENDING');
 assert.equal(tickerFeedStatus(null,NOW),'UNAVAILABLE');
});

test('news ribbon reuses read-only RSS events, has source timing, safe links and motion controls',()=>{
 const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
 const html=read('public/index.html'),js=read('public/news-ticker.js'),css=read('public/news-ticker.css'),live=read('public/live.js'),server=read('server.mjs');
 assert.match(html,/id="nabd-news-ticker"/);
 assert.match(html,/data-ticker-filter="GOLD"/);
 assert.match(html,/data-ticker-filter="BTC"/);
 assert.match(html,/data-ticker-prev/);
 assert.match(html,/data-ticker-pause/);
 assert.match(html,/data-ticker-next/);
 assert.match(html,/rel="noopener noreferrer"/);
 assert.match(html,/news-ticker\.css/);
 assert.match(live,/initNewsTicker\(/);
 assert.match(live,/updateNewsTicker\(next\)/);
 assert.match(server,/'\/news-ticker\.js':'news-ticker\.js'/);
 assert.match(server,/'\/news-ticker\.css':'news-ticker\.css'/);
 assert.match(js,/published_at/);
 assert.match(js,/source_name/);
 assert.match(js,/last_success/);
 assert.match(css,/prefers-reduced-motion:reduce/);
 for(const source of [js,css]){
  assert.doesNotMatch(source,/\/api\/commands|OrderSend|\/api\/bridge\/next/);
 }
});
