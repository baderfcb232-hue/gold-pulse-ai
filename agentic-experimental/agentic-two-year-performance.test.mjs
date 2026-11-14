import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {replayAgenticBacktest} from './agentic-replay-backtest.mjs';

// SYNTHETIC load test ONLY: two years of OHLC, absolutely no broker-history claim.
const start=1704067200; // 2024-01-01 00:00 UTC
const days=732;
const sizes={M5:300,M15:900,H1:3600,H4:14400};
function frame(tf){
 const duration=sizes[tf];
 const count=Math.ceil(days*86400/duration)+1;
 return Array.from({length:count},(_,i)=>{
  const close=100+.0001*i+Math.sin(i*.1)*.2;
  return {time:start+i*duration,open:close,high:close+.4,
   low:close-.4,close};
 });
}
test('730+ day Agentic replay handles synthetic two-year bar depth; does not invent actual fills',()=>{
 const candles=Object.fromEntries(Object.keys(sizes).map(tf=>[tf,frame(tf)]));
 const decisions=[];
 for(let i=3000;i<Math.floor(days*288);i+=288){
  const at=start+i*300;
  decisions.push({analyzedAt:at,closedBarTime:at-300,
   stance:'WAIT',confidence:.5,quoteAt:at-1,bid:100,ask:100.02});
 }
 const market=(symbol)=>({brokerServer:'Synthetic-UnitTest-Demo',
  brokerSymbol:symbol+'.m',
  candles,decisions,
  costs:{spreadPrice:.02,slippagePrice:.01,commissionPerLotRoundTrip:7,
   tickSize:.01,tickValueLoss:1,minLot:.01,maxLot:10,lotStep:.01,
   startingEquityUsd:2000,maxHoldSeconds:900}});
 const dataset={schema:'NABD_AGENTIC_PIT_REPLAY_V1',
  source:'BROKER_EXPORT_WITH_ARCHIVED_AI_DECISIONS',
  markets:{XAUUSD:market('XAUUSD'),BTCUSD:market('BTCUSD')}};
 const t=performance.now();
 const report=replayAgenticBacktest(dataset);
 const elapsedMs=Math.round(performance.now()-t);
 assert.equal(report.brokerExecutionConfirmed,false);
 assert.equal(report.markets.XAUUSD.trades,0);
 assert.equal(report.markets.BTCUSD.trades,0);
 assert.equal(report.markets.XAUUSD.rejections.NO_AI_WATCH,decisions.length);
 assert.equal(report.markets.BTCUSD.rejections.NO_AI_WATCH,decisions.length);
 assert.ok(report.markets.XAUUSD.coverageDays>=730);
 assert.ok(report.markets.BTCUSD.coverageDays>=730);
 console.log('NABD_SYNTHETIC_TWO_YEAR_PERFORMANCE',JSON.stringify({
  elapsedMs,ohlcBars:sumLength(candles),decisionsPerMarket:decisions.length,
  symbols:2,brokerData:false,realAiDecisions:false,trades:0
 }));
 assert.ok(elapsedMs<30000,'Synthetic two-year scan should not exceed 30 seconds on CI');
});
function sumLength(frames){return Object.values(frames).reduce((n,x)=>n+x.length,0)}
