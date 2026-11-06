import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {summarizeAnalysisMarket} from '../public/analysis-ribbon.js';

const NOW=1793980800;
const market=(symbol='XAUUSD',extra={})=>({
 symbol,connection:'LIVE',quoteTtl:symbol==='XAUUSD'?90:20,
 quote:{price:2026,time:NOW-3},received_at:NOW-3,
 candle_kind:'BROKER_OHLC',source:'MT5 · JustMarkets-Demo',
 analysis:{status:'SCANNING',score:75,checks:[{name:'EMA M15 direction',pass:true}],
  frames:{M15:{direction:'BUY'},H1:{direction:'SELL'}},
  reason_label:'انتظار توافق الاتجاه',readinessChecks:[],entrySafetyChecks:[]},
 ...extra
});
test('phase 6 independently shows each market frame bias without calling it a trade',()=>{
 const result=summarizeAnalysisMarket(market(),{nowSeconds:NOW,serverTime:NOW,locale:'ar'});
 assert.equal(result.state,'scan');
 assert.equal(result.status,'مراقبة الشروط');
 assert.equal(result.frames,'M15 ↑ · H1 ↓');
 assert.equal(result.score,'توافق 75/100');
 assert.equal(result.reason,'انتظار توافق الاتجاه');
 assert.equal(result.fresh,true);
 const bitcoin=summarizeAnalysisMarket(market('BTCUSD',{analysis:{status:'NEWS_BLOCK',reason_label:'توقف بسبب الأخبار',checks:[],frames:{}}}),{nowSeconds:NOW,serverTime:NOW,locale:'ar'});
 assert.equal(bitcoin.state,'news');
 assert.equal(bitcoin.score,'—');
 assert.equal(bitcoin.frames,'—');
});
test('stale quote and stale server snapshots cannot advertise old readiness or indicator values',()=>{
 const stale=summarizeAnalysisMarket(market('XAUUSD',{connection:'STALE',
  analysis:{status:'READY',score:100,checks:[{pass:true}],frames:{M15:{direction:'BUY'}}}}),{nowSeconds:NOW,serverTime:NOW});
 assert.equal(stale.state,'stale');
 assert.equal(stale.score,'—');
 assert.equal(stale.frames,'—');
 const serverStale=summarizeAnalysisMarket(market(),{nowSeconds:NOW,serverTime:NOW-50});
 assert.equal(serverStale.state,'stale');
 const absent=summarizeAnalysisMarket(null,{nowSeconds:NOW,serverTime:NOW});
 assert.equal(absent.state,'unavailable');
 assert.equal(absent.score,'—');
});
test('score 100 is not entry approval when an independent safety or readiness gate fails',()=>{
 const blocked=summarizeAnalysisMarket(market('BTCUSD',{
  analysis:{status:'SCANNING',score:100,checks:[{name:'EMA',pass:true}],
  frames:{M15:{direction:'BUY'}},readinessChecks:[{name:'سعر حديث',pass:false}],
  entrySafetyChecks:[{name:'مسافة وقف الخسارة مناسبة',pass:false}]}
 }),{nowSeconds:NOW,serverTime:NOW});
 assert.equal(blocked.state,'blocked');
 assert.equal(blocked.status,'شروط الدخول غير مكتملة');
 assert.equal(blocked.score,'توافق 100/100');
 assert.equal(blocked.reason,'مسافة وقف الخسارة مناسبة');
 assert.equal(blocked.fresh,true);
});
test('signals are only described as published if current, server-ready, and unblocked; never as broker fills',()=>{
 const a={status:'READY',score:89,checks:[{name:'MACD',pass:true}],frames:{M15:{direction:'BUY'}},entrySafetyChecks:[]};
 const m=market('XAUUSD',{analysis:a});
 const merelyAligned=summarizeAnalysisMarket(m,{nowSeconds:NOW,serverTime:NOW,locale:'ar'});
 assert.equal(merelyAligned.state,'ready');
 assert.equal(merelyAligned.status,'شروط متوافقة');
 const publicSignal=summarizeAnalysisMarket({...m,currentSignal:{id:'signal-1',expires_at:NOW+60}},{nowSeconds:NOW,serverTime:NOW,locale:'en'});
 assert.equal(publicSignal.state,'signal');
 assert.equal(publicSignal.status,'Published signal');
 assert.equal(publicSignal.score,'Alignment 89/100');
 assert.equal(publicSignal.frames,'M15 ↑');
 const expires=summarizeAnalysisMarket({...m,currentSignal:{id:'old',expires_at:NOW-1}},{nowSeconds:NOW,serverTime:NOW});
 assert.equal(expires.state,'ready');
});
test('ribbon uses existing read-only market snapshots, has two symbols and works across screen sizes',()=>{
 const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
 const html=read('public/index.html'),live=read('public/live.js'),script=read('public/analysis-ribbon.js'),css=read('public/analysis-ribbon.css'),server=read('server.mjs');
 assert.match(html,/id="nabd-analysis-ribbon"/);
 assert.match(html,/data-analysis-market="XAUUSD"/);
 assert.match(html,/data-analysis-market="BTCUSD"/);
 assert.ok(html.indexOf('id="nabd-news-ticker"')<html.indexOf('id="nabd-analysis-ribbon"'));
 assert.ok(html.indexOf('id="nabd-analysis-ribbon"')<html.indexOf('class="page-heading"'));
 assert.match(live,/updateAnalysisRibbon\(next\)/);
 assert.match(live,/initAnalysisRibbon\(\)/);
 assert.match(server,/'\/analysis-ribbon\.js':'analysis-ribbon\.js'/);
 assert.match(server,/'\/analysis-ribbon\.css':'analysis-ribbon\.css'/);
 assert.match(css,/@media\(max-width:650px\)/);
 assert.match(html,/analysis-ribbon\.css\?v=phase6-1/);
 assert.match(script,/nabd:language-change/);
 assert.match(script,/5000/);
 assert.doesNotMatch(script,/\/api\/commands|OrderSend|\/api\/bridge\/next|\/api\/mt5\/|localStorage/);
});
