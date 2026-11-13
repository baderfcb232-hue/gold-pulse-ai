import test from 'node:test';
import assert from 'node:assert/strict';
import {runStrategyLab,validateLabDataset,tradeMetrics} from './strategy-lab.mjs';
const base=1761955200;
function bars(count,step,end,price){
 return Array.from({length:count},(_,i)=>{
  const o=price+i*.04,close=o+.03*Math.sin(i/9);
  return {time:end-(count-1-i)*step,open:o,close,
   high:Math.max(o,close)+.5,low:Math.min(o,close)-.5,tick_volume:100};
 });
}
function input(){
 const count=760,m5=bars(count,300,base+count*300,2500),end=m5.at(-1).time;
 const d={symbol:'XAUUSD',broker_symbol:'XAUUSD.m',
  broker:'JustMarkets',provenance:{format:'MT5_HISTORY_EXPORT',
   broker:'JustMarkets',server:'JustMarkets-Demo2',exportedAt:end+14400},
  spec:{point:0.01,tick_size:0.01,tick_value_loss:0.1,tick_value_profit:0.1,
   volume_min:0.01,volume_step:0.01,volume_max:50,stops_points:20,
   margin_per_lot:500,currency:'USD',digits:2},
  spread_points:15,slippage_points:3,commission_per_lot:8,
  candles:{M5:m5,M15:bars(320,900,end,2500),H1:bars(320,3600,end,2500),
   H4:bars(320,14400,end,2500)}};
 return d;
}
test('lab rejects synthetic claims, missing costs, corrupt OHLC, stale/unsorted or unclosed broker bars',()=>{
 let d=input();assert.equal(validateLabDataset(d).provenanceStatus,'DECLARED_NOT_INDEPENDENTLY_VERIFIED');
 for(const mutate of [
  x=>{x.provenance.broker='synthetic generator';},
  x=>{x.spread_points=undefined;},
  x=>{x.candles.M5[10].time=x.candles.M5[9].time;},
  x=>{x.candles.H4[3].low=x.candles.H4[3].high+1;},
  x=>{x.provenance.exportedAt=x.candles.M5.at(-1).time;},
  x=>{x.symbol='EURUSD';},
  x=>{x.candles.H1=x.candles.H1.slice(0,100);}
 ]){d=input();mutate(d);assert.throws(()=>validateLabDataset(d));}
});
test('profit factor, drawdown, win rate, duration and planned RR derive only from trade ledger',()=>{
 const trades=[
  {net_r:1,entry:100,sl:90,tp2:120,bar_time:1000,ended_at:1600,net_per_lot:60},
  {net_r:-1,entry:100,sl:90,tp2:120,bar_time:2000,ended_at:2600,net_per_lot:-50},
  {net_r:2,entry:100,sl:90,tp2:120,bar_time:3000,ended_at:4200,net_per_lot:110}
 ];
 const m=tradeMetrics({trades});
 assert.equal(m.trades,3);assert.equal(m.winRate,0.666667);
 assert.equal(m.profitFactor,3);assert.equal(m.netR,2);
 assert.equal(m.maxDrawdownR,1);assert.equal(m.meanDurationSeconds,800);
 assert.equal(m.meanPlannedRR,2);assert.equal(m.netPerLotCurrency,120);
 assert.equal(m.distribution['>= 2R'],1);
 assert.equal(tradeMetrics({trades:[]}).winRate,null);
 assert.equal(tradeMetrics({trades:[]}).profitFactor,null);
});
test('OOS results are independent and not auto-approved, and no look-ahead news replay is claimed',()=>{
 const d=input(),r=runStrategyLab(d,{trainFraction:0.65,stressMultiplier:2});
 assert.equal(r.kind,'NABD_OFFLINE_STRATEGY_LAB_V1');
 assert.equal(r.symbol,'XAUUSD');
 assert.equal(r.executionTimeframe,'M5');
 assert.equal(r.split.nonOverlapping,true);
 assert.equal(r.results.development.end,r.results.outOfSample.start);
 assert.equal(r.assumptions.autoApproval,false);
 assert.equal(r.assumptions.tradingEnabled,false);
 assert.match(r.assumptions.news,/DISABLED/);
 assert.equal(r.results.outOfSample.stress.multiplier,2);
 assert.ok(r.results.development.baseline.trades>=0);
 assert.ok(r.warnings.some(w=>/not independently broker-verified/i.test(w)));
 assert.throws(()=>runStrategyLab(d,{timeframe:'H4'}));
 assert.throws(()=>runStrategyLab(d,{trainFraction:.95}));
 assert.throws(()=>runStrategyLab(d,{from:base+500*300,to:base+520*300}));
});
