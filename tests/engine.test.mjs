import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanSnapshot,analyze,trackPlan,positionSize,ema,rsi,atr,candleZones} from '../engine.mjs';
import {fixture,NOW,samplePlan,entryFixture} from './fixtures.mjs';

test('indicator values have sensible constant and monotone limits',()=>{
  assert.equal(ema(Array(240).fill(100),21),100);
  assert.equal(rsi(Array(240).fill(100)),50);
  assert.equal(rsi(Array.from({length:50},(_,i)=>i)),100);
  assert.equal(rsi(Array.from({length:50},(_,i)=>100-i)),0);
  assert.equal(atr(Array.from({length:30},(_,i)=>({high:101,low:99,close:100}))),2);
});
test('snapshot rejects inverted quotes, future/unclosed candles and nonfinite contract values',()=>{
  let raw=fixture();raw.ask=raw.bid-1;assert.throws(()=>cleanSnapshot(raw,NOW));
  raw=fixture();raw.candles.M5.at(-1).time=NOW;assert.throws(()=>cleanSnapshot(raw,NOW));
  raw=fixture();raw.spec.margin_per_lot=Infinity;assert.throws(()=>cleanSnapshot(raw,NOW));
  raw=fixture();raw.quote_at=NOW+60;assert.throws(()=>cleanSnapshot(raw,NOW));
});
test('no data or stale data never produces an entry or LOW RISK',()=>{
  const empty=analyze(null,NOW);assert.equal(empty.connection,'NO_DATA');assert.equal(empty.risk,'UNKNOWN');assert.equal(empty.score,null);assert.equal(empty.plan,null);
  const s=cleanSnapshot(fixture(),NOW);const stale=analyze(s,NOW+30);assert.equal(stale.connection,'STALE');assert.equal(stale.plan,null);assert.equal(stale.score,null);
});
test('fresh transport cannot disguise old market quotes',()=>{
  const raw=fixture();raw.quote_at=NOW-60;const s=cleanSnapshot(raw,NOW);assert.equal(analyze(s,NOW).connection,'STALE');
});
test('calendar outages and high impact events block signals',()=>{
  const raw=fixture();raw.calendar.status='unavailable';assert.match(analyze(cleanSnapshot(raw,NOW),NOW).reasons[0],/التقويم/);
  raw.calendar={status:'ok',updated_at:NOW,events:[{id:'nfp',name:'TEST EVENT',currency:'USD',importance:3,time:NOW+100,actual:null,forecast:null,previous:null}]};
  const a=analyze(cleanSnapshot(raw,NOW),NOW);assert.equal(a.risk,'BLOCKED');assert.equal(a.plan,null);assert.equal(a.news_block.id,'nfp');
});
test('incomplete candles and an excessive spread stop analysis',()=>{
  let raw=fixture();raw.candles.H4=raw.candles.H4.slice(-50);assert.equal(analyze(cleanSnapshot(raw,NOW),NOW).score,null);
  raw=fixture();raw.ask=raw.bid+.2;assert.equal(analyze(cleanSnapshot(raw,NOW),NOW).risk,'BLOCKED');
});
test('virtual tracking uses BID for buy exits and ASK for sell exits',()=>{
  const s=cleanSnapshot(fixture(),NOW),p=samplePlan();s.quote_at=NOW+1;s.received_at=NOW+1;
  s.bid=4010.99;s.ask=4011.09;assert.equal(trackPlan(p,s,NOW+1),null);
  const sell={...p,side:'SELL',sl:4010,tp1:4005,tp2:4003};s.bid=4004.99;s.ask=4005.09;assert.equal(trackPlan(sell,s,NOW+1),null);
  s.ask=4004.99;assert.equal(trackPlan(sell,s,NOW+1).tp1_hit,true);
});
test('expired or stale plans cannot be credited with a late target hit',()=>{
  const p=samplePlan(),s=cleanSnapshot(fixture(),NOW);s.bid=5000;s.ask=5001;s.quote_at=NOW+901;
  assert.equal(trackPlan(p,s,NOW+901).status,'EXPIRED');assert.equal(trackPlan(p,s,NOW+901).r,null);
  assert.equal(trackPlan(p,{...s,quote_at:NOW-100},NOW),null);
  assert.equal(trackPlan(p,null,NOW+901).status,'EXPIRED');
});
test('stop gaps record the observed loss instead of claiming guaranteed -1R',()=>{
  const p=samplePlan(),s=cleanSnapshot(fixture(),NOW);s.bid=4005;s.ask=4005.03;s.quote_at=NOW+1;
  const change=trackPlan(p,s,NOW+1);assert.equal(change.status,'SL');assert.equal(change.r,-1.5);assert.equal(p.sl,4006);
});
test('position sizing respects budget, volume step, minimum and margin',()=>{
  const spec={tick_size:.01,tick_value_loss:1,volume_min:.01,volume_step:.01,volume_max:50,margin_per_lot:300};
  const s=positionSize({equity:2500,riskPercent:1,entry:2000,sl:1999,spec,commissionPerLot:10});
  assert.equal(s.volume,.22);assert.ok(s.loss<=25);assert.equal(s.margin,66);
  const small=positionSize({equity:10,riskPercent:.1,entry:2000,sl:1999,spec});assert.equal(small.volume,0);
  const margin=positionSize({equity:2500,riskPercent:1,entry:2000,sl:1999,spec,freeMargin:2});assert.equal(margin.volume,0);
  assert.throws(()=>positionSize({equity:1000,riskPercent:1,entry:100,sl:100,spec}));
});
test('flat prices do not produce arbitrary order blocks',()=>{
  const rows=Array.from({length:30},(_,i)=>({time:i+1,open:100,high:101,low:99,close:100}));
  assert.deepEqual(candleZones(rows),{demand:null,supply:null});
});
test('a confirmed pullback can produce both buy and sell plans with correctly oriented levels',()=>{
  for(const side of ['BUY','SELL']){
    const s=cleanSnapshot(entryFixture(side),NOW),a=analyze(s,NOW);assert.equal(a.decision,side);assert.equal(a.score,100);assert.ok(a.plan);
    assert.equal(a.plan.entry,Number((side==='BUY'?s.ask:s.bid).toFixed(3)));
    if(side==='BUY')assert.ok(a.plan.sl<a.plan.entry&&a.plan.tp1>a.plan.entry&&a.plan.tp2>a.plan.tp1);
    else assert.ok(a.plan.sl>a.plan.entry&&a.plan.tp1<a.plan.entry&&a.plan.tp2<a.plan.tp1);
    assert.ok(Math.abs(a.plan.entry-a.plan.sl)>0);
  }
});
