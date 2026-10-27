import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze,cleanSnapshot,previewFlexibleAnalysis,STRATEGY,FLEX_STRATEGY} from '../engine.mjs';
import {backtest,compareFlex} from '../backtest.mjs';
import {entryFixture,fixture,NOW} from './fixtures.mjs';

// Synthetic trend with a short counter-trend pullback: unlike flat candles,
// EMA8/EMA21 have a stable numerical ordering, while EMA200 holds the H1 side.
function neutralM15(raw) {
  const side=raw.candles.H1.at(-1).close >= raw.candles.H1[0].close ? 1 : -1;
  const base=raw.candles.M15.at(-1).close - side * 3.19;
  raw.candles.M15.forEach((c,i)=>{
    const trend=side*(i*.01 - Math.max(0,i-309)*.035);
    const price=base+trend;
    c.open=price-side*.01;c.close=price;
    c.high=Math.max(c.open,c.close)+.15;c.low=Math.min(c.open,c.close)-.15;
  });
  return raw;
}
test('strict strategy still blocks neutral M15; flex shadow can detect BUY',()=>{
  const snapshot=cleanSnapshot(neutralM15(entryFixture('BUY')),NOW);
  const strict=analyze(snapshot,NOW),flex=previewFlexibleAnalysis(snapshot,NOW);
  assert.equal(strict.strategy,STRATEGY);
  assert.equal(strict.frames.M15.direction,'NEUTRAL');
  assert.equal(strict.frames.H1.direction,'BUY');
  assert.equal(strict.plan,null);
  assert.equal(flex.strategy,FLEX_STRATEGY);
  assert.equal(flex.plan?.side,'BUY');
  assert.equal(flex.score,100);
});
test('neutral M15 research also supports confirmed SELL',()=>{
  const snapshot=cleanSnapshot(neutralM15(entryFixture('SELL')),NOW);
  assert.equal(analyze(snapshot,NOW).plan,null);
  const flex=previewFlexibleAnalysis(snapshot,NOW);
  assert.equal(flex.frames.H1.direction,'SELL');
  assert.equal(flex.plan?.side,'SELL');
});
test('opposite M15 or H4 trend blocks flex even with a matching H1 and M5',()=>{
  const opposite=entryFixture('BUY');
  opposite.candles.M15=entryFixture('SELL').candles.M15;
  let flex=previewFlexibleAnalysis(cleanSnapshot(opposite,NOW),NOW);
  assert.equal(flex.frames.M15.direction,'SELL');
  assert.equal(flex.plan,null);
  const higher=neutralM15(entryFixture('BUY'));
  higher.candles.H4=entryFixture('SELL').candles.H4;
  flex=previewFlexibleAnalysis(cleanSnapshot(higher,NOW),NOW);
  assert.equal(flex.frames.H4.direction,'SELL');
  assert.equal(flex.plan,null);
});
test('calendar outages still block flexible entries',()=>{
  const raw=neutralM15(entryFixture('BUY'));
  raw.calendar.status='unavailable';
  const flex=previewFlexibleAnalysis(cleanSnapshot(raw,NOW),NOW);
  assert.equal(flex.plan,null);
  assert.match(flex.reasons.join(' '),/التقويم/);
});
test('passing timeframe policy via ordinary live settings cannot activate flex',()=>{
  const snapshot=cleanSnapshot(neutralM15(entryFixture('BUY')),NOW);
  const live=analyze(snapshot,NOW,{timeframePolicy:'FLEX_NEUTRAL'});
  assert.equal(live.strategy,STRATEGY);
  assert.equal(live.plan,null);
});
test('offline comparison isolates policies and preserves trading cost assumptions',()=>{
  const data=fixture();data.spread_points=30;data.commission_per_lot=7;
  const c=compareFlex(data,{allowMissingNews:true});
  assert.equal(c.kind,'OFFLINE_STRATEGY_COMPARISON');
  assert.equal(c.baseline.strategy,STRATEGY);
  assert.equal(c.experimental.strategy,FLEX_STRATEGY);
  assert.deepEqual(c.baseline.assumptions,c.experimental.assumptions);
  assert.equal(c.baseline.summary.trades,backtest(data,{allowMissingNews:true}).summary.trades);
  assert.throws(()=>backtest(data,{timeframePolicy:'WRONG'}),/Unsupported timeframe policy/);
});
