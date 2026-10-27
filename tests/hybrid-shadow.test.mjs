import test from 'node:test';
import assert from 'node:assert/strict';
import {hybridShadowAnalysis,HYBRID_STRATEGY} from '../hybrid-shadow.mjs';
test('shadow hybrid fails closed if M1 history or verified news missing',()=>{
 const missing=hybridShadowAnalysis({candles:{M1:[]},bid:4000,ask:4000.1,now:1770000000,newsSafe:true});
 assert.equal(missing.decision,'WAIT');assert.match(missing.reason,/MISSING_M1/);
 assert.equal(missing.reference_only,true);
 assert.equal(HYBRID_STRATEGY,'HYBRID-M1-M5-M15-SHADOW');
});
test('hybrid never emits MT5 dispatch fields with unverified calendar',()=>{
 const output=hybridShadowAnalysis({bid:4000,ask:4000.1,now:1770000000});
 assert.equal(output.decision,'WAIT');assert.equal(output.reference_only,true);
 assert.equal(Object.hasOwn(output,'order'),false);
});
