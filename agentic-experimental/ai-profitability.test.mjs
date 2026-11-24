import test from 'node:test';
import assert from 'node:assert/strict';
import {paperOutcome,createProfitabilityStore} from './ai-profitability.mjs';
const base={entryBid:100,entryAsk:101,exitBid:103,exitAsk:104,riskDistance:4};
test('paper returns use executable sides and explicit assumed friction',()=>{
 const o=paperOutcome({...base,stance:'BUY_WATCH'});
 assert.ok(Math.abs(o.netR-.4)<1e-10);assert.ok(Math.abs(o.sellR+1.1)<1e-10);
 assert.equal(paperOutcome({...base,stance:'WAIT'}).netR,null);
 assert.ok(paperOutcome({...base,stance:'SELL_WATCH'}).netR<0);
 assert.throws(()=>paperOutcome({...base,stance:'BUY_WATCH',riskDistance:0}),/INVALID_PAPER_OUTCOME/);
});
test('invalid live or stale quote cannot reach journal',async()=>{
 const store=createProfitabilityStore({query:async()=>{throw Error('unexpected query')},clock:()=>1800000000});
 assert.equal((await store.save({broker:{accountType:'REAL'}})).inserted,false);
 assert.deepEqual(await store.observe({accountType:'REAL'}),{scored:0,expired:0});
});
