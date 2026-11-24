import test from 'node:test';
import assert from 'node:assert/strict';
import {initialPortfolio,enterPortfolio,advancePortfolio,portfolioReport} from './paper-portfolio.mjs';
const t=1900000200;
const q=(time=t,bid=100,symbol='XAUUSD')=>({symbol,bid,ask:bid+.2,timestamp:time,environment:'EXPERIMENTAL_NABD_AGENTIC',accountType:'DEMO',executionEnabled:false,brokerServer:'JustMarkets-Demo',brokerSymbol:symbol+'.m',accountLogin:55});
const input=(time=t,bid=100,symbol='XAUUSD',stance='BUY_WATCH')=>({symbol,broker:q(time,bid,symbol),closedBarTime:time-300,features:{M5:{atr14:2}},plan:{stance,confidence:.9,timeHorizonMinutes:1}});
test('initial risk includes friction and target is 3R',()=>{
 const {state:s,entered}=enterPortfolio(initialPortfolio('XAUUSD'),input(),t);
 assert.equal(entered,true);const p=s.positions[0];assert.ok(Math.abs((p.target-p.entry)/(p.entry-p.stop)-3)<1e-9);
 assert.ok(Math.abs(p.units*(p.entry-p.stop+.02)+p.fee-8)<1e-9);
 assert.ok(s.equity<2000);
 const end=advancePortfolio(s,q(t+10,p.target+1),t+10);assert.equal(end.targetHits,1);assert.equal(end.closed,1);assert.ok(end.balance>2000);
 assert.equal(advancePortfolio(end,q(t+10,p.target+1),t+10).closed,1);
});
test('adverse observed stop may exceed budget; gap invalidates cohort',()=>{
 const {state:s}=enterPortfolio(initialPortfolio('XAUUSD'),input(),t);
 const p=s.positions[0],end=advancePortfolio(s,q(t+10,p.stop-1),t+10);
 assert.equal(end.stopHits,1);assert.ok(end.balance<1992);assert.ok(portfolioReport(end).maxSampledDrawdownPct>0);
 const gap=advancePortfolio(s,q(t+31,100),t+31);assert.equal(gap.frozen,true);assert.equal(gap.closed,0);
 assert.equal(enterPortfolio(gap,input(t+300),t+300).entered,false);
});
test('wait, duplicate bars, opposite side and daily BTC limit',()=>{
 const wait=enterPortfolio(initialPortfolio('XAUUSD'),input(t,100,'XAUUSD','WAIT'),t);
 assert.equal(wait.entered,false);assert.equal(wait.reason,'WAIT');
 assert.equal(enterPortfolio(wait.state,input(),t).entered,false);
 let s=initialPortfolio('BTCUSD');
 for(let i=0;i<6;i++){
  const now=t+i*300;
  const x=enterPortfolio(s,input(now,100,'BTCUSD'),now);assert.equal(x.entered,true);
  s=advancePortfolio(x.state,q(now+10,112,'BTCUSD'),now+10);
 }
 assert.equal(enterPortfolio(s,input(t+1800,100,'BTCUSD'),t+1800).reason,'POSITION_OR_DAILY_CAP');
});
test('short side uses ask and mismatched account freezes active portfolio',()=>{
 const {state:s}=enterPortfolio(initialPortfolio('XAUUSD'),input(t,100,'XAUUSD','SELL_WATCH'),t);
 const p=s.positions[0];assert.ok(p.target<p.entry&&p.stop>p.entry);
 const bad=advancePortfolio(s,{...q(t+10),accountLogin:56},t+10);assert.equal(bad.frozen,true);
 const end=advancePortfolio(s,q(t+10,p.target-.3),t+10);assert.equal(end.targetHits,1);
});
