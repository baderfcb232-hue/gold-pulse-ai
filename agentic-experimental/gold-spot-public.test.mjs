import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePublicGoldSpot,createPublicGoldObserver} from './gold-spot-public.mjs';
const now=1762791000;
const sample={spot_usd_oz:4110.45,data_state:{status:'fresh',as_of:new Date((now-20)*1000).toISOString()},
 updated_at:new Date((now-10)*1000).toISOString(),stale:false};
test('fresh indicative gold quote is never execution eligible',()=>{
 const d=parsePublicGoldSpot(sample,now);
 assert.equal(d.price,4110.45);assert.equal(d.executable,false);assert.equal(d.m5Available,false);
});
test('reject stale data state',()=>assert.throws(()=>parsePublicGoldSpot({...sample,data_state:{...sample.data_state,status:'stale'}},now),/GOLD_SOURCE_STALE/));
test('reject old timestamps despite fresh flag',()=>assert.throws(()=>parsePublicGoldSpot({...sample,updated_at:new Date((now-500)*1000).toISOString()},now),/GOLD_PRICE_STALE/));
test('reject invalid price',()=>assert.throws(()=>parsePublicGoldSpot({...sample,spot_usd_oz:0},now),/GOLD_PRICE_INVALID/));
test('reject future timestamps',()=>assert.throws(()=>parsePublicGoldSpot({...sample,updated_at:new Date((now+50)*1000).toISOString()},now),/GOLD_PRICE_STALE/));
test('observer never emits execution or AI eligibility',async()=>{
 const observer=createPublicGoldObserver({clock:()=>now,load:async()=>parsePublicGoldSpot(sample,now)});
 assert.equal((await observer.poll()).status,'OBSERVED_REFERENCE');
 assert.equal(observer.report().tradingEnabled,false);assert.equal(observer.report().analysisEligible,false);
});
test('observer rejects forged gold broker compatibility',async()=>{
 const observer=createPublicGoldObserver({clock:()=>now,load:async()=>({...parsePublicGoldSpot(sample,now),brokerCompatible:true})});
 assert.equal((await observer.poll()).code,'GOLD_UNTRUSTED_SOURCE');
});
test('observer handles upstream errors as failure not fake price',async()=>{
 const observer=createPublicGoldObserver({clock:()=>now,load:async()=>{throw Error('SOURCE_DOWN')}});
 assert.equal((await observer.poll()).status,'ERROR');
 assert.equal(observer.report().lastPrice,null);
});
