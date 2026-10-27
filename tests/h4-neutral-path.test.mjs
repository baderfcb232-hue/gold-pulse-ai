import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze,cleanSnapshot,previewH4NeutralAnalysis,STRATEGY,H4_NEUTRAL_STRATEGY} from '../engine.mjs';
import {compareH4Neutral} from '../backtest.mjs';
import {entryFixture,fixture,NOW} from './fixtures.mjs';

// Deterministic H1 pullback after a long gentle trend. Its EMA8 falls below
// EMA21 while price remains close to and above EMA200 (mirrored for SELL).
function makeH1Neutral(raw, side) {
  const sign=side==='BUY'?1:-1;
  const rows=raw.candles.H1, target=raw.candles.M5.at(-1).close;
  const base=target-sign*2.705;
  for(let i=0;i<rows.length;i++){
    const movement=i<300?i*.01:2.99-(i-300)*.015;
    const p=base+sign*movement;
    rows[i].open=p-sign*.01;rows[i].close=p;
    rows[i].high=Math.max(rows[i].open,p)+.35;
    rows[i].low=Math.min(rows[i].open,p)-.35;
  }
  return raw;
}
test('H4 conditional H1-neutral path generates experimental BUY, strict remains blocked',()=>{
  const snap=cleanSnapshot(makeH1Neutral(entryFixture('BUY'),'BUY'),NOW);
  const base=analyze(snap,NOW),experiment=previewH4NeutralAnalysis(snap,NOW);
  assert.equal(snap.candles.M5.length,320);
  assert.equal(base.strategy,STRATEGY);
  assert.equal(base.frames.H1.direction,'NEUTRAL');
  assert.equal(base.frames.H4.direction,'BUY');
  assert.equal(base.plan,null);
  assert.equal(experiment.strategy,H4_NEUTRAL_STRATEGY);
  assert.equal(experiment.plan?.side,'BUY');
});
test('H4 conditional H1-neutral path generates experimental SELL',()=>{
  const snap=cleanSnapshot(makeH1Neutral(entryFixture('SELL'),'SELL'),NOW);
  assert.equal(analyze(snap,NOW).plan,null);
  const experiment=previewH4NeutralAnalysis(snap,NOW);
  assert.equal(experiment.frames.H1.direction,'NEUTRAL');
  assert.equal(experiment.frames.H4.direction,'SELL');
  assert.equal(experiment.plan?.side,'SELL');
});
test('genuine opposing H1 or H4 disagreement never forces a trade',()=>{
  const opposed=entryFixture('BUY');
  opposed.candles.H1=entryFixture('SELL').candles.H1;
  const cand=previewH4NeutralAnalysis(cleanSnapshot(opposed,NOW),NOW);
  assert.equal(cand.frames.H1.direction,'SELL');
  assert.equal(cand.plan,null);
  const h4Opposite=makeH1Neutral(entryFixture('BUY'),'BUY');
  h4Opposite.candles.H4=entryFixture('SELL').candles.H4;
  assert.equal(previewH4NeutralAnalysis(cleanSnapshot(h4Opposite,NOW),NOW).plan,null);
});
test('real news filters and spread still override H4 path',()=>{
  const news=makeH1Neutral(entryFixture('BUY'),'BUY');
  news.calendar.status='unavailable';
  assert.equal(previewH4NeutralAnalysis(cleanSnapshot(news,NOW),NOW).plan,null);
  const spread=makeH1Neutral(entryFixture('BUY'),'BUY');
  spread.ask=spread.bid+.2;
  assert.equal(previewH4NeutralAnalysis(cleanSnapshot(spread,NOW),NOW).plan,null);
});
test('ordinary live settings can never select experimental H4 mode',()=>{
  const snap=cleanSnapshot(makeH1Neutral(entryFixture('BUY'),'BUY'),NOW);
  const live=analyze(snap,NOW,{timeframePolicy:'H4_H1_NEUTRAL'});
  assert.equal(live.strategy,STRATEGY);
  assert.equal(live.plan,null);
});
test('compare historical engine without changing live source or cost model',()=>{
  const data=fixture();data.spread_points=30;data.commission_per_lot=7;
  const results=compareH4Neutral(data,{allowMissingNews:true});
  assert.equal(results.kind,'OFFLINE_STRATEGY_COMPARISON');
  assert.equal(results.baseline.strategy,STRATEGY);
  assert.equal(results.experimental.strategy,H4_NEUTRAL_STRATEGY);
  assert.deepEqual(results.baseline.assumptions,results.experimental.assumptions);
});
