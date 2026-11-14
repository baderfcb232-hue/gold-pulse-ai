import test from 'node:test';
import assert from 'node:assert/strict';
import {replayAgenticBacktest} from './agentic-replay-backtest.mjs';

const now=1800000000;
function bars(tf,count,endOffset=1,trend=true){
 const len={M5:300,M15:900,H1:3600,H4:14400}[tf];
 return Array.from({length:count},(_,i)=>{
  const time=now-(count-i+endOffset-1)*len;
  const v=100+i*(tf==='M5'?.01:.02)+(tf==='M5'?.2*Math.sin(i*.9):0);
  return {time,open:v,high:v+.5,low:v-.5,close:v};
 });
}
function market(){
 const m5=bars('M5',240,1);
 const last=m5.at(-1);
 const entry=last.close;
 const next={time:now,open:entry,high:entry+6,low:entry-.3,close:entry+4};
 return {brokerServer:'UnitTest-JustMarkets-Demo',brokerSymbol:'XAUUSD.m',
  costs:{spreadPrice:.02,slippagePrice:.01,commissionPerLotRoundTrip:7,
   tickSize:.01,tickValueLoss:1,minLot:.01,maxLot:10,lotStep:.01,
   startingEquityUsd:2000,maxHoldSeconds:900},
  candles:{M5:[...m5,next],M15:bars('M15',64),H1:bars('H1',48),H4:bars('H4',32)},
  decisions:[]};
}
function data(){
 const gold=market(),btc=market();
 btc.brokerSymbol='BTCUSD.m';
 return {schema:'NABD_AGENTIC_PIT_REPLAY_V1',
  source:'BROKER_EXPORT_WITH_ARCHIVED_AI_DECISIONS',
  markets:{XAUUSD:gold,BTCUSD:btc}};
}
test('two years of broker history is required by default; short synthetic fixtures cannot claim it',()=>{
 assert.throws(()=>replayAgenticBacktest(data()),/shorter than 730 calendar days/);
});
test('no historical AI decisions means NOT TESTABLE, never fake a 0% win rate',()=>{
 const r=replayAgenticBacktest(data(),{minCoverageDays:0});
 assert.equal(r.markets.XAUUSD.status,'NOT_TESTABLE_NO_ARCHIVED_AI_DECISIONS');
 assert.equal(r.markets.XAUUSD.winRate,null);
 assert.equal(r.markets.XAUUSD.netR,null);
 assert.equal(r.brokerExecutionConfirmed,false);
});
test('point-in-time future quotes, duplicate decisions or non-DEMO broker provenance fail closed',()=>{
 const d=data();
 d.markets.XAUUSD.decisions=[{analyzedAt:now,closedBarTime:now-300,
  stance:'WAIT',confidence:.9,bid:100,ask:100.1,quoteAt:now+1}];
 assert.throws(()=>replayAgenticBacktest(d,{minCoverageDays:0}),/non-point-in-time/);
 d.markets.XAUUSD.decisions[0].quoteAt=now-1;
 d.markets.XAUUSD.brokerServer='Production-Live';
 assert.throws(()=>replayAgenticBacktest(d,{minCoverageDays:0}),/DEMO broker/);
});
test('archived WAIT decisions never create a simulated trade',()=>{
 const d=data();
 d.markets.XAUUSD.decisions=[{analyzedAt:now,closedBarTime:now-300,
  stance:'WAIT',confidence:.95,bid:102,ask:102.02,quoteAt:now-1}];
 const r=replayAgenticBacktest(d,{minCoverageDays:0});
 assert.equal(r.markets.XAUUSD.trades,0);
 assert.equal(r.markets.XAUUSD.rejections.NO_AI_WATCH,1);
 assert.equal(r.brokerExecutionConfirmed,false);
});
test('archived confident WATCH is processed by original DEMO trade-intent gate, not a toy strategy',()=>{
 const d=data(),m5=d.markets.XAUUSD.candles.M5;
 const p=m5.at(-1).open;
 d.markets.XAUUSD.decisions=[{analyzedAt:now,closedBarTime:now-300,
  stance:'BUY_WATCH',confidence:.93,bid:p,ask:p+.02,quoteAt:now-1}];
 const r=replayAgenticBacktest(d,{minCoverageDays:0});
 assert.equal(r.kind,'OFFLINE_AGENTIC_POINT_IN_TIME_REPLAY');
 assert.equal(r.markets.XAUUSD.decisions,1);
 assert.equal(r.markets.XAUUSD.trades,1,
  'A synthetic valid WATCH should pass the deterministic DEMO gate');
 assert.ok(r.markets.XAUUSD.trades[0].lot>0);
 assert.equal(r.markets.XAUUSD.trades[0].exitReason,'TP');
 assert.equal(r.brokerExecutionConfirmed,false);
});
