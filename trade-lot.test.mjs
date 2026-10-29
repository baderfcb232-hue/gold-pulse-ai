import test from 'node:test';
import assert from 'node:assert/strict';
import {validateManualLot,stopLossEstimate} from './trade-lot.mjs';
const spec={volume_min:0.01,volume_max:2,volume_step:0.01,tick_size:0.01,tick_value_loss:1};
test('manual lot rejects amounts not supported by broker',()=>{
 assert.equal(validateManualLot(0.009,spec).reason,'LOT_OUTSIDE_BROKER_LIMITS');
 assert.equal(validateManualLot(0.015,spec).reason,'LOT_STEP_MISMATCH');
 assert.equal(validateManualLot(2.01,spec).reason,'LOT_OUTSIDE_BROKER_LIMITS');
 assert.equal(validateManualLot(-0.1,spec).reason,'INVALID_LOT');
});
test('valid lot preserves exact amount',()=>assert.deepEqual(validateManualLot(0.07,spec),{ok:true,lot:0.07}));
test('stop estimate follows the recommendation stop',()=>{
 assert.equal(stopLossEstimate(0.1,{side:'BUY',entry:3000,sl:2999},spec),10);
 assert.equal(stopLossEstimate(0.1,{side:'BUY',entry:3000,sl:3001},spec),null);
});

import {websiteTradeDecision} from './website-entry.mjs';
test('manual lot is rejected unless the MT5 build advertises explicit support',()=>{
 const gate=websiteTradeDecision({enabled:true,snapshot:{execution:{website_recommendations:false}},tradeSizing:{mode:'FIXED',lot:0.01}});
 assert.equal(gate.reason,'MT5_WEBSITE_UPDATE_REQUIRED');
});
