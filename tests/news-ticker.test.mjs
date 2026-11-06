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

test('thin headline strip stays before the market heading and contains no controls',()=>{
 const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
 const html=read('public/index.html'),js=read('public/news-ticker.js');
 const css=read('public/news-ticker.css'),live=read('public/live.js'),app=read('public/app.js'),server=read('server.mjs');
 const start=html.indexOf('<section class="nabd-news-ticker"');
 const end=html.indexOf('</section>',start);
 assert.ok(start>=0&&end>start);
 assert.ok(start>html.indexOf('<main id="main"'));
 assert.ok(start<html.indexOf('class="page-heading"'));
 const strip=html.slice(start,end+10);
 assert.match(strip,/data-ticker-track/);
 assert.match(strip,/data-ticker-viewport/);
 assert.match(strip,/data-ticker-placeholder/);
 assert.doesNotMatch(strip,/<button\b|<select\b|data-ticker-(?:pause|filter|prev|next)/);
 assert.match(css,/height:38px/);
 assert.match(css,/height:34px/);
 assert.match(css,/@keyframes nabd-news-crawl/);
 assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(js,/tickerItems\(feed,'ALL'/);
 assert.match(js,/source_name/);
 assert.match(js,/published_at/);
 assert.match(js,/cloneNode\(true\)/);
 assert.match(js,/aria-hidden/);
 assert.match(js,/tabIndex=-1/);
 assert.match(js,/\.textContent=item\.title/);
 assert.match(live,/updateNewsTicker\(next\)/);
 assert.match(app,/live\.js\?v=thin-20261106/);
 assert.match(server,/'\/news-ticker\.js':'news-ticker\.js'/);
 for(const source of [js,css]){
  assert.doesNotMatch(source,/\/api\/commands|OrderSend|\/api\/bridge\/next/);
 }
});


test('continuous ticker uses recent gold and Bitcoin news only, supports new headlines automatically',()=>{
  const newest={id:'new-btc',source:'cointelegraph-btc',category:'BTC',title:'A tagged digital asset story',url:'https://cointelegraph.com/news/new',published_at:NOW-10};
  const older={id:'old-btc',source:'coindesk',category:'BTC',title:'Bitcoin market update',url:'https://coindesk.com/news/old',published_at:NOW-1000};
  const aged={id:'stale',source:'coindesk',category:'BTC',title:'Bitcoin stale update',url:'https://coindesk.com/news/aged',published_at:NOW-4*24*3600};
  const unrelated={id:'alt',source:'coindesk',category:'BTC',title:'Ethereum upgrade',url:'https://coindesk.com/news/ethereum',published_at:NOW-50};
  const rows=tickerItems({items:[older,unrelated,aged,newest]},'ALL',NOW);
  assert.deepEqual(rows.map(x=>x.id),['new-btc','old-btc']);
  const after=tickerItems({items:[{...newest,id:'newer',published_at:NOW-1},older]},'ALL',NOW);
  assert.equal(after[0].id,'newer');
});
test('marquee keeps moving after touch and refreshes RSS even with active market stream',()=>{
  const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const js=read('public/news-ticker.js'),css=read('public/news-ticker.css'),live=read('public/live.js');
  assert.match(css,/animation:nabd-news-crawl/);
  assert.match(css,/@media\(hover:hover\) and \(pointer:fine\)/);
  assert.doesNotMatch(css,/:focus-within \.nabd-ticker-track/);
  assert.match(js,/viewport\.clientWidth/);
  assert.match(js,/group\.scrollWidth/);
  assert.match(js,/copy\.tabIndex=-1/);
  assert.match(js,/x\.title,x\.published_at/);
  assert.match(live,/async function refreshHeadlines\(\)/);
  assert.match(live,/setInterval\(\(\) => \{if\(!document\.hidden\)refreshHeadlines\(\);\},45000\)/);
  assert.match(live,/updateNewsTicker\(next\)/);
  assert.doesNotMatch(js,/\/api\/commands|OrderSend/);
});
