import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createDemoHistoryIngest} from './demo-history-ingest.mjs';

const now=1800000000,secret='mql5-demo-history-test-secret-0123456789abcdef';
const snapshot={
 source:'ISOLATED_DEMO_MT5_HISTORY_VERIFIER',
 accountType:'DEMO',accountLogin:1234567,
 brokerServer:'JustMarkets-Demo',observedAt:now,
 symbols:{XAUUSD:'XAUUSD.m',BTCUSD:'BTCUSD.m'},deals:[]
};
const sensor=s=>({accountType:'DEMO',accountLogin:1234567,
 brokerServer:'JustMarkets-Demo',brokerSymbol:s==='XAUUSD'?'XAUUSD.m':'BTCUSD.m'});
const deal={symbol:'BTCUSD',dealTicket:90011,orderTicket:10012,
 brokerSymbol:'BTCUSD.m',side:'BUY',entry:'IN',dealAt:now-2,
 volume:0.02,stop:59800.2,target:60700.4};
const sign=(object,ts=now)=>{const body=JSON.stringify(object),timestamp=String(ts);
 return {body,timestamp,mac:createHmac('sha256',secret)
  .update(timestamp+'\n'+body).digest('hex'),secure:true}};
const build=options=>createDemoHistoryIngest({
 secret,clock:()=>now,quoteProvider:sensor,...options});

test('history API disabled without isolated secret, never creates orders',()=>{
 const h=createDemoHistoryIngest({clock:()=>now});
 assert.equal(h.report().status,'NOT_CONFIGURED');
 assert.equal(h.receive(sign(snapshot)).status,'REJECTED');
 assert.equal(h.report().ordersSupported,false);
});

test('signed read-only MQL5 heartbeat cannot prove a deal without existing intent',()=>{
 let called=0;
 const h=build({matchHistory:()=>{called++;return {matched:5}}});
 const r=h.receive(sign(snapshot));
 assert.equal(r.status,'OBSERVED');
 assert.equal(r.ordersCreated,0);assert.equal(r.matched,0);
 assert.equal(called,0);
 assert.equal(h.report().accepted,1);
 assert.equal(h.report().matchedTotal,0);
});

test('signed history is never valid over HTTP, forged signature or LIVE broker',()=>{
 const h=build();
 assert.equal(h.receive({...sign(snapshot),secure:false}).code,'HTTPS_REQUIRED');
 assert.equal(h.receive({...sign(snapshot),mac:'f'.repeat(64)}).code,'INVALID_SIGNATURE');
 assert.equal(h.receive(sign({...snapshot,accountType:'LIVE'})).code,'INVALID_HISTORY_PROVENANCE');
 assert.equal(h.receive(sign({...snapshot,brokerServer:'JustMarkets-Live'})).status,'REJECTED');
 assert.equal(h.report().matchedTotal,0);
});

test('reject other accounts or broker symbol mapping before inspecting deals',()=>{
 let matched=0;
 const h=build({matchHistory:()=>{matched++;return {matched:1}}});
 assert.equal(h.receive(sign({...snapshot,accountLogin:333,deals:[deal]})).code,
  'HISTORY_SENSOR_ACCOUNT_MISMATCH');
 assert.equal(h.receive(sign({...snapshot,symbols:{...snapshot.symbols,BTCUSD:'BTCUSD'},deals:[deal]})).code,
  'INVALID_HISTORY_DEAL');
 assert.equal(matched,0);
});

test('reject missing price guards, wrong timestamps, forged deal ticket and replay',()=>{
 const h=build({matchHistory:()=>({matched:0})});
 assert.equal(h.receive(sign({...snapshot,deals:[{...deal,stop:0}]})).code,
  'INVALID_HISTORY_DEAL');
 assert.equal(h.receive(sign({...snapshot,deals:[{...deal,dealAt:now-1000}]})).code,
  'INVALID_HISTORY_DEAL');
 assert.equal(h.receive(sign(snapshot,now-20)).code,'HISTORY_REQUEST_EXPIRED');
 assert.equal(h.receive(sign(snapshot)).status,'OBSERVED');
 assert.equal(h.receive(sign(snapshot)).code,'HISTORY_REPLAY');
});

test('only a broker/account-matching signed record is supplied to strict ACK comparator',()=>{
 const matched=[];
 const h=build({matchHistory:(deals,broker)=>{matched.push({deals,broker});
  return {matched:0,reason:'NO_MATCHING_DEMO_DEAL'};}});
 const result=h.receive(sign({...snapshot,deals:[deal]}));
 assert.equal(result.status,'OBSERVED');
 assert.equal(result.matched,0);
 assert.equal(matched.length,1);
 assert.equal(matched[0].deals[0].dealTicket,90011);
 assert.equal(matched[0].broker.brokerSymbol,'BTCUSD.m');
 assert.equal(h.report().matchedTotal,0);
});

test('MQL5 reader has no order sending/position modification calls',()=>{
 const source=readFileSync(new URL('./NABD_Demo_History_Verifier.mq5',import.meta.url),'utf8');
 for(const call of ['OrderSend','OrderSendAsync','OrderModify','PositionClose','PositionModify','Buy','Sell']){
  assert.equal(new RegExp('\\b'+call+'\\s*\\(').test(source),false,'unsafe call '+call);
 }
 assert.match(source,/ACCOUNT_TRADE_MODE_DEMO/);
 assert.match(source,/HistoryDealGetInteger/);
 assert.match(source,/HistoryOrderGetDouble/);
 assert.match(source,/InpEnableHistoryUpload\s*= false/);
 assert.match(source,/nabd-agentic-ai-test\.onrender\.com/);
});
