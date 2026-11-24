import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewDecision} from './decision-critic.mjs';
const ctx={candlesVerified:true,multiTimeframeVerified:true,bid:100,ask:100.1,spreadLimit:2.5,news:{classification:'NONE'},technicalEvidence:Object.fromEntries(['M5','M15','H1','H4'].map(tf=>[tf,{status:'INDICATORS_AVAILABLE',emaDirection:'DOWN',atr14:2}])),fusionEvidence:{adaptive:{regime:'TREND_DOWN',frames:{M5:{rejectedHigh:true}}}}};
test('critic independently detects opposing evidence without changing stance',()=>{
 const plan={stance:'BUY_WATCH',confidence:.95,evidence:['example'],counterThesis:'risk',invalidation:'level'};
 const before=structuredClone(plan);
 const r=reviewDecision(ctx,plan);
 assert.ok(r.flags.includes('HIGHER_FRAME_COUNTERTREND'));assert.ok(r.flags.includes('OPPOSITE_MARKET_REGIME'));assert.ok(r.flags.includes('PRICE_REJECTION_AGAINST_STANCE'));assert.ok(r.flags.includes('LIVE_NEWS_NOT_AVAILABLE'));
 assert.equal(r.executionPermission,false);assert.equal(r.confidenceCalibrated,false);assert.deepEqual(plan,before);
});
test('missing plan and missing evidence are explicit',()=>{
 assert.equal(reviewDecision({},null).status,'UNAVAILABLE');
 const r=reviewDecision({}, {stance:'SELL_WATCH',confidence:.9});
 assert.ok(r.flags.includes('INCOMPLETE_TECHNICAL_EVIDENCE'));assert.ok(r.flags.includes('MISSING_MODEL_EVIDENCE'));assert.ok(r.flags.includes('SPREAD_OR_ATR_UNFAVORABLE'));
});
test('WAIT is not turned into a trade',()=>{
 const r=reviewDecision(ctx,{stance:'WAIT',confidence:.7});
 assert.equal(r.stance,'WAIT');assert.equal(r.executionPermission,false);
 assert.ok(!r.flags.includes('HIGHER_FRAME_COUNTERTREND'));
});
