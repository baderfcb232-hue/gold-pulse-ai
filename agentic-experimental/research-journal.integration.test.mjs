import test from 'node:test';
import assert from 'node:assert/strict';
import {connectResearchJournal} from './research-journal-pg.mjs';
const url=process.env.NABD_TEST_RESEARCH_DATABASE_URL;
test('isolated Postgres actually migrates, persists and rejects revised forecast', {skip:!url},async()=>{
 let connection=await connectResearchJournal({url});
 assert.equal(connection.status,'CONNECTED');
 const journal=connection.journal;
 const scheduledAt=1800000000;
 const provider='CI_TEST_'+process.pid;
 const id='ONE';
 try{
  const first=await journal.saveForecast({provider,id,scheduledAt,observedAt:scheduledAt-100,raw:'3.2%'});
  assert.deepEqual(first,{inserted:true});
  const revised=await journal.saveForecast({provider,id,scheduledAt,observedAt:scheduledAt-50,raw:'4.0%'});
  assert.deepEqual(revised,{inserted:false});
  assert.deepEqual(await journal.firstForecast({provider,id,scheduledAt}),{raw:'3.2%',observedAt:scheduledAt-100});
  assert.deepEqual(await journal.saveActual({provider,id,scheduledAt,observedAt:scheduledAt+30,raw:'3.4%'}),{inserted:true});
  const shadow={symbol:'XAUUSD',closedBarAt:scheduledAt-300,analyzedAt:scheduledAt,
   trigger:'M5_CLOSED',status:'RESEARCH_ANALYSIS_ONLY',stance:'WAIT',
   confidence:0.51,reasonCodes:[]};
  assert.deepEqual(await journal.saveAnalysis(shadow),{inserted:true});
  assert.deepEqual(await journal.saveAnalysis({...shadow,stance:'BUY_WATCH'}),{inserted:false});
  await assert.rejects(journal.saveAnalysis({...shadow,symbol:'EURUSD'}),/INVALID_ISOLATED_ANALYSIS/);
  await connection.close();connection=null;
  const reopened=await connectResearchJournal({url});assert.equal(reopened.status,'CONNECTED');
  try{assert.deepEqual(await reopened.journal.firstForecast({provider,id,scheduledAt}),{raw:'3.2%',observedAt:scheduledAt-100});}
  finally{await reopened.close();}
 }finally{if(connection)await connection.close();}
});
test('production-name URL rejected before migrations', {skip:!url},async()=>{
 const parsed=new URL(url);parsed.pathname='/postgres';
 const result=await connectResearchJournal({url:parsed.toString()});
 assert.notEqual(result.status,'CONNECTED');
});

test('phase8 forward outcomes are deduplicated and survive isolated PostgreSQL reconnect', {skip:!url},async()=>{
 const base=1800000000+process.pid*1000;
 let now=base;
 const broker=(bid=100)=>({environment:'EXPERIMENTAL_NABD_AGENTIC',
  accountType:'DEMO',executionEnabled:false,symbol:'XAUUSD',
  brokerServer:'JustMarkets-Demo',timestamp:now-1,bid,ask:bid+0.2});
 const features=Object.fromEntries(['M5','M15','H1','H4'].map(tf=>
  [tf,{status:'INDICATORS_AVAILABLE',emaDirection:'UP',
   ema200Verified:true,ema200:90,lastClose:100}]));
 const plan={stance:'BUY_WATCH',confidence:0.83,timeHorizonMinutes:1};
 let c=await connectResearchJournal({url,clock:()=>now});
 assert.equal(c.status,'CONNECTED');
 try{
  const input={symbol:'XAUUSD',closedBarTime:base-300,plan,features,broker:broker()};
  assert.deepEqual(await c.journal.saveForward(input),{inserted:true,reason:null});
  assert.equal((await c.journal.saveForward(input)).reason,'DUPLICATE_CLOSED_BAR');
  assert.equal((await c.journal.forwardReport()).markets.XAUUSD.pending>=1,true);
  await c.close();c=null;
  now=base+61;
  const reopened=await connectResearchJournal({url,clock:()=>now});
  assert.equal(reopened.status,'CONNECTED');
  try{
   const observed=await reopened.journal.observeForward(broker(101));
   assert.equal(observed.scored,1);
   assert.equal((await reopened.journal.observeForward(broker(101))).scored,0);
   const stats=(await reopened.journal.forwardReport()).markets.XAUUSD;
   assert.equal(stats.scored>=1,true);assert.equal(stats.hits>=1,true);
   assert.equal(stats.pending,0);
   assert.equal(stats.directionalHitRate,null);
  }finally{await reopened.close();}
 }finally{if(c)await c.close();}
});
