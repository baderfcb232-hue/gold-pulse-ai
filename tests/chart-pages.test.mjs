import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../server.mjs';
import {brokerChartPath,closedBrokerCandles,brokerChartFresh,rsi14,atr14} from '../public/chart-pages.js';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const NOW=1793980800;
const rows=Array.from({length:40},(_,i)=>({time:NOW-(40-i)*300,open:2000+i,high:2001+i,low:1999+i,close:2000.5+i}));

test('standalone broker pages have separate fixed symbol routes and responsive shared presentation',()=>{
 for(const [file,symbol] of [['chart-gold.html','XAUUSD'],['chart-bitcoin.html','BTCUSD']]){
  const h=read('public/'+file);
  assert.match(h,new RegExp('data-chart-symbol="'+symbol+'"'));
  assert.match(h,/href="\/charts\/gold"/);
  assert.match(h,/href="\/charts\/bitcoin"/);
  assert.match(h,/href="\/dashboard"/);
  assert.match(h,/id="chart-canvas"/);
  assert.match(h,/data-chart-tf="M5"/);
  assert.match(h,/data-chart-tf="M15"/);
  assert.match(h,/data-chart-tf="H1"/);
  assert.match(h,/data-chart-tf="H4"/);
  assert.match(h,/data-chart-mode="mt5"/);
  assert.match(h,/data-chart-mode="reference"/);
  assert.match(h,/chart-pages\.css/);
  assert.match(h,/chart-pages\.js/);
  assert.doesNotMatch(h,/OrderSend|password=|auth_token=/);
 }
 const css=read('public/chart-pages.css');
 assert.match(css,/@media\(max-width:760px\)/);
 assert.match(css,/\[data-nabd-theme="dark"\]/);
});

test('broker chart routes never accept unsupported symbols/timeframes or unrelated price feeds',()=>{
 assert.equal(brokerChartPath('XAUUSD','M5'),'/api/market/broker-candles?symbol=XAUUSD&tf=M5');
 assert.equal(brokerChartPath('BTCUSD','H4'),'/api/market/broker-candles?symbol=BTCUSD&tf=H4');
 assert.throws(()=>brokerChartPath('BTCUSDT','M15'),RangeError);
 assert.throws(()=>brokerChartPath('XAUUSD','M1'),RangeError);
 assert.equal(closedBrokerCandles({symbol:'BTCUSD',tf:'M15',candle_kind:'EXCHANGE_AND_OBSERVATIONS',candles:rows},'BTCUSD','M15'),null);
 assert.equal(closedBrokerCandles({symbol:'XAUUSD',tf:'M15',candle_kind:'BROKER_OHLC',candles:rows},'BTCUSD','M15'),null);
 const valid=closedBrokerCandles({symbol:'XAUUSD',tf:'M15',candle_kind:'BROKER_OHLC',candles:[...rows,{time:100,open:1,close:2,low:3,high:4}]},'XAUUSD','M15');
 assert.equal(valid.candles.length,40);
});

test('quote freshness explicitly requires broker LIVE, quote timestamp and receipt freshness',()=>{
 const sample={connection:'LIVE',received_at:NOW-2,quote:{time:NOW-2}};
 assert.equal(brokerChartFresh(sample,NOW,10),true);
 assert.equal(brokerChartFresh({...sample,connection:'STALE'},NOW,10),false);
 assert.equal(brokerChartFresh({...sample,received_at:NOW-120},NOW,10),false);
 assert.equal(brokerChartFresh({...sample,quote:{time:NOW-120}},NOW,10),false);
 assert.equal(brokerChartFresh(null,NOW,10),false);
});

test('read-only RSI and ATR calculations use only genuine OHLC, not recommendation probability',()=>{
 assert.equal(Math.round(rsi14(rows)),100);
 assert.ok(atr14(rows)>0);
 assert.equal(rsi14(rows.slice(0,14)),null);
 assert.equal(atr14(rows.slice(0,14)),null);
 assert.equal(rsi14(Array.from({length:20},(_,i)=>({...rows[0],close:5}))),50);
});

test('routes and assets respond from NABD server without enabling trading or fabricating candles',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'nabd-phase7-'));
 const app=createApplication({dataDir:dir});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;
 for(const [route,symbol] of [['/charts/gold','XAUUSD'],['/charts/bitcoin','BTCUSD']]){
  const res=await fetch(base+route);
  assert.equal(res.status,200);
  assert.match(res.headers.get('content-type'),/text\/html/);
  assert.match(await res.text(),new RegExp('data-chart-symbol="'+symbol+'"'));
 }
 for(const [route,mime] of [['/chart-pages.js','text/javascript'],['/chart-pages.css','text/css']]){
  const res=await fetch(base+route);
  assert.equal(res.status,200);
  assert.match(res.headers.get('content-type'),new RegExp(mime));
 }
 const noBroker=await fetch(base+'/api/market/broker-candles?symbol=XAUUSD&tf=M15');
 assert.equal(noBroker.status,503);
 const payload=await noBroker.json();
 assert.match(payload.error,/No MT5 broker candles/);
});

test('chart UI distinguishes real broker candles from opt-in external reference without execution changes',()=>{
 const js=read('public/chart-pages.js'),html=read('public/index.html'),live=read('public/live.js');
 assert.match(js,/brokerChartPath\(symbol,requestedTf\)/);
 assert.match(js,/drawBrokerCandles\(canvas,input,\[\]\)/);
 assert.match(js,/summarizeAnalysisMarket/);
 assert.match(js,/chart\.quote/);
 assert.match(js,/TradingView/);
 assert.match(js,/source/i);
 assert.match(js,/localStorage\.setItem\('nabd:dashboard:theme'/);
 assert.match(js,/localStorage\.setItem\('nabd:dashboard:language'/);
 assert.match(html,/id="dedicated-chart-link"/);
 assert.match(live,/dedicated-chart-link'\)\.href = symbol === 'BTCUSD' \? '\/charts\/bitcoin' : '\/charts\/gold'/);
 for(const f of ['public/chart-pages.js','public/chart-pages.css','public/chart-gold.html','public/chart-bitcoin.html']){
  assert.doesNotMatch(read(f),/\/api\/commands|OrderSend|\/api\/bridge\/next|\/api\/risk-settings|\/api\/mt5\/order/);
 }
 for(const file of ['public/landing.html','public/landing-en.html']){
  const content=read(file);
  assert.match(content,/href="\/charts\/gold"/);
  assert.match(content,/href="\/charts\/bitcoin"/);
 }
});
