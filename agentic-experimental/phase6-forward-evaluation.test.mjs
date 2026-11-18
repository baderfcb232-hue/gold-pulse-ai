import test from 'node:test';
import assert from 'node:assert/strict';
import {createForwardEvaluation} from './phase6-forward-evaluation.mjs';
const base=1800000000;let current=base;
const broker=(symbol='XAUUSD',t=current,bid=100,ask=100.2)=>({
 environment:'EXPERIMENTAL_NABD_AGENTIC',accountType:'DEMO',
 executionEnabled:false,symbol,brokerServer:'Independent-JustMarkets-Demo',timestamp:t,bid,ask});
const plan=(stance='BUY_WATCH')=>({stance,confidence:0.8,timeHorizonMinutes:5});
const setup=()=>{current=base;return createForwardEvaluation({clock:()=>current});};
test('does not score before the forecast horizon or using a stale quote',()=>{
 const e=setup();
 assert.equal(e.record({symbol:'XAUUSD',plan:plan(),broker:broker(),closedBarTime:base-300}).accepted,true);
 current+=299;
 assert.equal(e.observe(broker('XAUUSD',current,103,103.2)).scored,0);
 assert.equal(e.observe(broker('XAUUSD',base,103,103.2)).accepted,false);
 assert.equal(e.report().counts.scored,0);
 current++;
 assert.equal(e.observe(broker('XAUUSD',current,103,103.2)).scored,1);
 assert.equal(e.report().counts.scored,1);
 assert.equal(e.report().markets.XAUUSD.directionalHitRate,null);
 assert.equal(e.report().markets.XAUUSD.insufficientSamples,true);
 assert.equal(e.report().executionAllowed,false);
});
test('sell watch is scored only using post-decision BTC broker quote',()=>{
 const e=setup();
 e.record({symbol:'BTCUSD',plan:plan('SELL_WATCH'),broker:broker('BTCUSD'),closedBarTime:base-300});
 current+=301;
 e.observe(broker('XAUUSD',current,90,90.2));
 assert.equal(e.report().counts.scored,0);
 e.observe(broker('BTCUSD',current,95,95.2));
 assert.equal(e.report().markets.BTCUSD.hits,1);
 assert.equal(e.report().counts.scored,1);
 assert.equal(e.report().profitabilityMeasured,false);
});
test('late broker quote expires unresolved outcome without hindsight interpolation',()=>{
 const e=setup();e.record({symbol:'XAUUSD',plan:plan(),broker:broker(),closedBarTime:base-300});
 current+=500;
 const r=e.observe(broker('XAUUSD',current,106,106.2));
 assert.equal(r.expired,1);
 assert.equal(e.report().counts.expired,1);
 assert.equal(e.report().counts.scored,0);
});
test('rejects LIVE, synthetic, malformed and too-old observations',()=>{
 const e=setup();
 for(const bad of [{...broker(),accountType:'LIVE'},
  {...broker(),brokerServer:'SYNTHETIC-Demo',environment:'SYNTHETIC'},
  broker('XAUUSD',base-10),{...broker(),ask:99},
  {...broker(),executionEnabled:true}]){
  assert.equal(e.record({symbol:'XAUUSD',plan:plan(),broker:bad,closedBarTime:base-300}).accepted,false);
 }
 assert.equal(e.report().counts.recorded,0);
});
test('WAIT is a separate denominator, duplicate candles cannot inflate hits',()=>{
 const e=setup();
 assert.equal(e.record({symbol:'XAUUSD',plan:plan('WAIT'),broker:broker(),closedBarTime:base-300}).accepted,true);
 assert.equal(e.report().counts.wait,1);
 const arg={symbol:'XAUUSD',plan:plan(),broker:broker(),closedBarTime:base-300};
 assert.equal(e.record(arg).accepted,true);
 assert.equal(e.record(arg).reason,'DUPLICATE_PREDICTION');
 current+=300;e.observe(broker('XAUUSD',current,101,101.2));
 assert.equal(e.record({...arg,broker:broker(),closedBarTime:base-300}).reason,'DUPLICATE_PREDICTION');
 assert.equal(e.report().counts.scored,1);
});
test('bounded backlog rejects instead of discarding a pending forecast',()=>{
 const e=createForwardEvaluation({clock:()=>current,maxPending:1});
 current=base;
 assert.equal(e.record({symbol:'XAUUSD',plan:plan(),broker:broker(),closedBarTime:base-300}).accepted,true);
 assert.equal(e.record({symbol:'BTCUSD',plan:plan(),broker:broker('BTCUSD'),closedBarTime:base-300}).reason,'EVALUATION_CAPACITY_REACHED');
 assert.equal(e.report().markets.XAUUSD.pending,1);
});
