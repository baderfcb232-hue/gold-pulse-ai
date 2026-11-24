import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeDirectionalGroups,statisticalReview} from './statistical-review.mjs';
const row={symbol:'XAUUSD',regime:'TREND_UP',stance:'BUY_WATCH',confidence_band:'82_PLUS',scored:40,hits:20,mean_confidence:.9};
test('small samples do not emit hit rate or calibration gap',()=>{
 const x=summarizeDirectionalGroups([{...row,scored:10,hits:5}])[0];
 assert.equal(x.hitRate,null);assert.equal(x.confidenceGap,null);assert.equal(x.wilson95,null);
});
test('sufficient sample descriptive gap and bounded interval',()=>{
 const x=summarizeDirectionalGroups([row])[0];
 assert.equal(x.hitRate,.5);assert.equal(x.confidenceGap,.4);assert.ok(x.wilson95[0]<.5&&x.wilson95[1]>.5);
});
test('review only queries versioned scored forward outcomes',async()=>{
 const x=await statisticalReview(async(sql,args)=>{assert.match(sql,/FUSION_STYLE_EVIDENCE_V5/);assert.match(sql,/f.outcome_status='SCORED'/);assert.deepEqual(args,[]);return {rows:[row]};});
 assert.equal(x.scored,40);assert.equal(x.profitabilityMeasured,false);assert.equal(x.executionPermission,false);assert.equal(x.confidenceCalibrated,false);
});
