import test from 'node:test';
import assert from 'node:assert/strict';
import {createDurableForwardStore} from './phase8-durable-forward.mjs';
const now=1800000000;
const broker=(time=now-1)=>({environment:'EXPERIMENTAL_NABD_AGENTIC',
 accountType:'DEMO',executionEnabled:false,symbol:'XAUUSD',
 brokerServer:'JustMarkets-Demo',bid:100,ask:100.2,timestamp:time});
const plan={stance:'BUY_WATCH',confidence:0.83,timeHorizonMinutes:5};
const features=Object.fromEntries(['M5','M15','H1','H4'].map(x=>
 [x,{status:'INDICATORS_AVAILABLE',emaDirection:'UP',ema200Verified:true,
  ema200:90,lastClose:100}]));
test('only valid Demo broker plans become immutable, parametrized Postgres baselines',async()=>{
 let writes=0;
 const db=createDurableForwardStore({clock:()=>now,query:async(sql,args)=>{
  assert.match(sql,/ON CONFLICT DO NOTHING/);assert.equal(args[0],'XAUUSD');
  assert.equal(args[1],now-300);assert.equal(args[6],'BUY_WATCH');
  assert.equal(args[9],'AGREED');writes++;return {rowCount:writes===1?1:0};
 }});
 const entry={symbol:'XAUUSD',closedBarTime:now-300,plan,features,broker:broker()};
 assert.deepEqual(await db.save(entry),{inserted:true,reason:null});
 assert.equal((await db.save(entry)).reason,'DUPLICATE_CLOSED_BAR');
 assert.equal(writes,2);
});
test('reject unsupported/live/stale/synthetic data without DB writes',async()=>{
 let writes=0;
 const db=createDurableForwardStore({clock:()=>now,query:async()=>{writes++;return {rowCount:1}}});
 for(const bad of [{...broker(),accountType:'LIVE'},
  {...broker(),brokerServer:'SYNTHETIC-Demo'},
  broker(now-5),{...broker(),ask:99},{...broker(),symbol:'BTCUSD'}]){
  assert.equal((await db.save({symbol:'XAUUSD',closedBarTime:now-300,plan,features,broker:bad})).inserted,false);
 }
 assert.equal((await db.save({symbol:'XAUUSD',closedBarTime:now-300,
  plan:{...plan,stance:'WAIT'},features,broker:broker()})).reason,'AI_WAIT_NOT_DIRECTIONAL');
 assert.equal(writes,0);
});
test('future observation uses one SQL atomic update only after fresh broker tick',async()=>{
 let updated=0;
 const db=createDurableForwardStore({clock:()=>now,query:async(sql,args)=>{
  updated++;assert.match(sql,/outcome_status='PENDING'/);
  assert.match(sql,/horizon_at <= to_timestamp\(\$3\)/);
  assert.equal(args[2],now-1);return {rows:[{outcome_status:'SCORED'}]};
 }});
 assert.deepEqual(await db.observe(broker()),{accepted:true,scored:1,expired:0});
 assert.equal(updated,1);
 assert.equal((await db.observe({...broker(),timestamp:now-5})).accepted,false);
 assert.equal(updated,1);
});
test('durable report suppresses tiny sample rates and discloses no private data',async()=>{
 const db=createDurableForwardStore({query:async()=>({rows:[{
  symbol:'BTCUSD',recorded:10,pending:4,scored:5,expired:1,hits:3,
  agreements:3,comparable:4
 }]})});
 const report=await db.report();
 assert.equal(report.markets.BTCUSD.directionalHitRate,null);
 assert.equal(report.markets.BTCUSD.emaAgreementRate,null);
 assert.equal(report.markets.XAUUSD.recorded,0);
 assert.equal(report.scope,'ISOLATED_RESEARCH_DATABASE_ONLY');
 assert.equal(report.executionAllowed,false);assert.equal(report.ordersCreated,0);
});
