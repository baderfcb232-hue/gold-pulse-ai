import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchBtcReference,parseKlines,parseBookTicker} from './binance-market.mjs';
import {createShadowFeedRunner} from './shadow-feed-runner.mjs';
const now=1762819500;
function rows(seconds){
 const start=Math.floor(now/seconds)*seconds-seconds*3;
 return Array.from({length:4},(_,i)=>{const t=(start+i*seconds)*1000;return [t,'100','103','99','102','0',t+seconds*1000-1];});
}
const fixtures={'5m':rows(300),'15m':rows(900),'1h':rows(3600),'4h':rows(14400)};
const fetcher=async url=>({ok:true,json:async()=>url.includes('bookTicker')?{bidPrice:'101',askPrice:'101.1'}:fixtures[new URL(url).searchParams.get('interval')]});
test('BTC public feed marks data broker-incompatible and non-executable',async()=>{
 const result=await fetchBtcReference({now,fetcher});
 assert.equal(result.executable,false);assert.equal(result.brokerCompatible,false);
 assert.deepEqual(Object.keys(result.bars),['M5','M15','H1','H4']);
 assert.equal(result.quote.timestampKind,'local_observed_at');
});
test('unfinished candles excluded',()=>{const x=rows(300);x[3][0]=now*1000;x[3][6]=now*1000+300000-1;assert.equal(parseKlines(x,300,now).length,3);});
test('candle gaps fail closed',()=>{const x=rows(300);x[2][0]+=300000;x[2][6]+=300000;assert.throws(()=>parseKlines(x,300,now),/KLINE_GAP/);});
test('invalid candles fail closed',()=>{const x=rows(300);x[0][3]='105';assert.throws(()=>parseKlines(x,300,now),/INVALID_KLINE_ROW/);});
test('inverted quotes rejected',()=>assert.throws(()=>parseBookTicker({bidPrice:'101',askPrice:'100'},now),/INVALID_BID_ASK/));
test('upstream errors propagated',async()=>assert.rejects(()=>fetchBtcReference({now,fetcher:async()=>({ok:false,status:451})}),/REFERENCE_FEED_HTTP_451/));
const input={symbol:'BTCUSD',source:'BINANCE_SPOT_BTCUSDT_REFERENCE_ONLY',executable:false,brokerCompatible:false,
 bars:{M5:[{time:now-600,close:101},{time:now-300,close:102}]}};
const scheduler={consider:()=>({reason:'M5_CLOSED',callAI:true}),report:()=>({callsToday:1})};
test('runner never executes AI or orders',async()=>{
 const runner=createShadowFeedRunner({load:async()=>input,clock:()=>now,scheduler});
 assert.equal((await runner.poll()).status,'OBSERVED');
 assert.equal(runner.report().analysisExecuted,false);assert.equal(runner.report().executionAllowed,false);
});
test('runner refuses a forged source',async()=>{
 const runner=createShadowFeedRunner({load:async()=>({...input,source:'FORGED'}),clock:()=>now,scheduler});
 assert.equal((await runner.poll()).code,'UNTRUSTED_REFERENCE_SOURCE');
});
test('runner traps upstream failure',async()=>{
 const runner=createShadowFeedRunner({load:async()=>{throw Error('UPSTREAM_DOWN')},clock:()=>now,scheduler});
 assert.equal((await runner.poll()).status,'ERROR');assert.equal(runner.report().status,'FEED_ERROR');
});
test('runner prevents simultaneous polls',async()=>{
 let resolve;const runner=createShadowFeedRunner({load:()=>new Promise(r=>{resolve=r}),clock:()=>now,scheduler});
 const one=runner.poll();assert.equal((await runner.poll()).status,'BUSY');resolve(input);await one;
});
