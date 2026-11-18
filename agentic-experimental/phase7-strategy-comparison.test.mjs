import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyEmaBaseline,createPhase7Comparator} from './phase7-strategy-comparison.mjs';
const now=1800000000;
const features=(dir='UP')=>Object.fromEntries(['M5','M15','H1','H4'].map(tf=>
 [tf,{status:'INDICATORS_AVAILABLE',emaDirection:dir,ema200Verified:true,
  ema200:dir==='UP'?90:110,lastClose:100}]));
test('unverified/incomplete timeframes never masquerade as a strategy agreement',()=>{
 const v=classifyEmaBaseline({...features(),H4:{status:'INSUFFICIENT_HISTORY'}});
 assert.equal(v.stance,'UNVERIFIED');
 const c=createPhase7Comparator({clock:()=>now});
 const r=c.compare({symbol:'XAUUSD',closedBarTime:now-300,plan:{stance:'BUY_WATCH',confidence:0.8},
  features:{...features(),H4:{status:'INSUFFICIENT_HISTORY'}}});
 assert.equal(r.agreement,'UNVERIFIED');assert.equal(c.report().counts.matched,0);
});
test('deterministic EMA benchmark signals UP, DOWN or WAIT on disagreement',()=>{
 assert.equal(classifyEmaBaseline(features()).stance,'BUY_WATCH');
 assert.equal(classifyEmaBaseline(features('DOWN')).stance,'SELL_WATCH');
 assert.equal(classifyEmaBaseline({...features(),H1:{...features().H1,emaDirection:'DOWN'}}).stance,'WAIT');
});
test('AI decisions are compared without overwriting model decisions or allowing execution',()=>{
 const c=createPhase7Comparator({clock:()=>now});
 const data={symbol:'BTCUSD',closedBarTime:now-300,plan:{stance:'BUY_WATCH',confidence:0.8},features:features()};
 const r=c.compare(data);
 assert.equal(r.agreement,'AGREED');assert.equal(r.executionAllowed,false);
 assert.equal(c.compare(data).reason,'DUPLICATE_COMPARISON');
 assert.equal(c.report().counts.compared,1);
 assert.equal(c.report().markets.BTCUSD.agreementRate,null);
 assert.equal(c.report().tradeProfitabilityVerified,false);
});
test('WAIT is counted, not treated as a fabricated win',()=>{
 const c=createPhase7Comparator({clock:()=>now});
 const r=c.compare({symbol:'XAUUSD',closedBarTime:now-300,
  plan:{stance:'WAIT',confidence:0.9},features:features()});
 assert.equal(r.agreement,'DISAGREED');
 assert.equal(c.report().counts.aiWait,1);
 assert.equal(c.report().counts.matched,0);
});
test('invalid symbol, future bars and model confidence are rejected',()=>{
 const c=createPhase7Comparator({clock:()=>now});
 for(const change of [{symbol:'EURUSD'},{closedBarTime:now+300},
  {plan:{stance:'BUY_WATCH',confidence:1.2}}]){
  const r=c.compare({symbol:'XAUUSD',closedBarTime:now-300,
   plan:{stance:'BUY_WATCH',confidence:0.7},features:features(),...change});
  assert.equal(r.accepted,false);
 }
 assert.equal(c.report().counts.rejected,3);
});
