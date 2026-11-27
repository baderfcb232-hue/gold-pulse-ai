import test from 'node:test';
import assert from 'node:assert/strict';
import {h4Setup,initial,observe,report} from './gold-h4-research.mjs';
const t=1800000000,barEnd=Math.floor(t/14400)*14400;
const bars=Array.from({length:21},(_,i)=>({time:barEnd-(21-i)*14400,open:100,high:102,low:98,close:100}));
bars[20]={...bars[20],close:104,high:105};
const q=(now=barEnd,bid=104)=>({environment:'EXPERIMENTAL_NABD_AGENTIC',accountType:'DEMO',executionEnabled:false,symbol:'XAUUSD',timestamp:now,bid,ask:bid+.2,brokerServer:'Demo-test-broker',brokerSymbol:'XAUUSD.m',accountLogin:9876,multiTimeframeVerified:true,candlesH4:bars});
test('fixed H4 channel excludes evaluated candle, rejects incomplete/future history',()=>{
 assert.equal(h4Setup(bars,barEnd).side,1);assert.equal(h4Setup(bars,barEnd).high,102);
 assert.equal(h4Setup(bars,barEnd-1),null);assert.equal(h4Setup(bars.slice(-20),barEnd),null);
 assert.equal(h4Setup([...bars.slice(0,-1),{...bars.at(-1),close:96,low:95}],barEnd).side,-1);
});
test('sampled gold paper position has costs, stop, no order and no duplicate entry',()=>{
 const s=observe(initial(),q(),barEnd);assert.equal(s.entries,1);assert.ok(s.position);
 assert.equal(observe(s,q(),barEnd),s);
 const active=observe(s,q(barEnd+60),barEnd+60);assert.equal(active.entries,1);
 const end=observe(active,q(barEnd+120,s.position.stop-.5),barEnd+120);
 assert.equal(end.closed,1);assert.equal(end.position,null);assert.ok(end.balance<1992);
 assert.equal(report(end).ordersCreated,0);assert.equal(report(end).profitabilityEstablished,false);
});
test('missed observations invalidate rather than claim hypothetical gains',()=>{
 const s=observe(initial(),q(),barEnd);
 const end=observe(s,q(barEnd+181),barEnd+181);
 assert.equal(end.invalidated,1);assert.equal(report(end).status,'INCOMPLETE_COHORT_NOT_SCORABLE');assert.equal(report(end).profitFactor,null);assert.equal(end.closed,0);assert.equal(end.position,null);assert.equal(end.balance,2000);
 assert.equal(observe(end,q(barEnd+182),barEnd+182),end);
});
test('wrong identity or late entry cannot manufacture a result',()=>{
 const s=observe(initial(),q(),barEnd);
 assert.equal(observe(s,{...q(barEnd+1),accountType:'LIVE'},barEnd+1),s);
 const changed=observe(s,{...q(barEnd+1),accountLogin:222},barEnd+1);
 assert.equal(changed.invalidated,1);assert.equal(changed.closed,0);
 const late=observe(initial(),q(barEnd+301),barEnd+301);assert.equal(late.entries,0);assert.equal(late.latest.type,'MISSED_BREAKOUT_WINDOW');
});
