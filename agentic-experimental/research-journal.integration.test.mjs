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
   confidence:0.51,reasonCodes:[],researchEvidence:{version:'FUSION_STYLE_EVIDENCE_V4',regime:'CONFLICT',candidate:'WAIT'}};
  assert.deepEqual(await journal.saveAnalysis(shadow),{inserted:true});
  assert.deepEqual(await journal.saveAnalysis({...shadow,stance:'BUY_WATCH'}),{inserted:false});
  await assert.rejects(journal.saveAnalysis({...shadow,symbol:'EURUSD'}),/INVALID_ISOLATED_ANALYSIS/);
  await assert.rejects(journal.saveAnalysis({...shadow,researchEvidence:{...shadow.researchEvidence,regime:'unsafe'}}),/INVALID_RESEARCH_EVIDENCE_METADATA/);
  await connection.close();connection=null;
  const reopened=await connectResearchJournal({url});assert.equal(reopened.status,'CONNECTED');
  try{assert.deepEqual(await reopened.journal.firstForecast({provider,id,scheduledAt}),{raw:'3.2%',observedAt:scheduledAt-100});
   const rows=await reopened.journal.viewDecisions('XAUUSD-'+shadow.closedBarAt);
   const row=rows.find(x=>Number(x.bar)===shadow.closedBarAt&&x.symbol==='XAUUSD');
   assert.deepEqual(row.plan_summary.researchEvidence,shadow.researchEvidence);assert.equal(row.stance,'WAIT');}
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

test('redacted operational events survive isolated PostgreSQL reconnect and reject unsafe text',
 {skip:!url},async()=>{
 const at=1800000000+process.pid;
 let c=await connectResearchJournal({url});
 assert.equal(c.status,'CONNECTED');
 try{
  assert.deepEqual(await c.journal.saveOperationalEvent({
   source:'ACK',stage:'REJECTED',symbol:null,
   reason:'ACK_SIGNATURE_INVALID',observedAt:at}),{inserted:true});
  await assert.rejects(c.journal.saveOperationalEvent({
   source:'ACK',stage:'REJECTED',reason:'secret=abc',observedAt:at}),
   /INVALID_OPERATIONAL_EVENT/);
  await assert.rejects(c.journal.saveOperationalEvent({
   source:'ACK',stage:'REJECTED',symbol:'EURUSD',observedAt:at}),
   /INVALID_OPERATIONAL_EVENT/);
  const first=await c.journal.operationalReport();
  assert.equal(first.storage,'ISOLATED_POSTGRESQL');
  assert.ok(first.counts.some(x=>x.source==='ACK'&&x.reason==='ACK_SIGNATURE_INVALID'));
  assert.equal(first.containsAccountIdentifiers,false);
  assert.equal(first.canTriggerTrades,false);
  await c.close();c=null;
  const reopened=await connectResearchJournal({url});
  assert.equal(reopened.status,'CONNECTED');
  try{
   const report=await reopened.journal.operationalReport();
   assert.ok(report.recent.some(x=>x.source==='ACK'&&x.reason==='ACK_SIGNATURE_INVALID'));
   assert.equal(JSON.stringify(report).includes('secret=abc'),false);
  }finally{await reopened.close();}
 }finally{if(c)await c.close();}
});

test('isolated PostgreSQL retains only validated broker history proof across restart',
 {skip:!url},async()=>{
 const at=1800000000+process.pid;
 const symbol='BTCUSD',intentId='BTCUSD-'+at;
 let conn=await connectResearchJournal({url});
 assert.equal(conn.status,'CONNECTED');
 try{
  assert.deepEqual(await conn.journal.saveBrokerHistoryProof({
   symbol,intentId,dealTicket:887766,observedAt:at}),{inserted:true});
  assert.deepEqual(await conn.journal.saveBrokerHistoryProof({
   symbol,intentId,dealTicket:111222,observedAt:at}),{inserted:false});
  await assert.rejects(conn.journal.saveBrokerHistoryProof({
   symbol,intentId:'XAUUSD-1800000000',dealTicket:1,observedAt:at}),
   /INVALID_BROKER_HISTORY_PROOF/);
  await conn.close();conn=null;
  const reopened=await connectResearchJournal({url});
  assert.equal(reopened.status,'CONNECTED');
  try{
   const report=await reopened.journal.brokerHistoryProofReport();
   assert.equal(report.brokerSigned,false);
   assert.ok(report.recent.some(p=>p.intentId===intentId&&p.brokerDealTicket===887766));
   assert.equal(report.verifiedByIndependentBroker,false);
  }finally{await reopened.close();}
 }finally{if(conn)await conn.close();}
});

test('licensed streaming calendar archive persists first Actual, prior Forecast and Previous without revisions',
 {skip:!url},async()=>{
 const t=1800000000+process.pid*100;
 const id=String(900000000+process.pid),provider='TRADING_ECONOMICS_STREAM';
 let c=await connectResearchJournal({url});
 assert.equal(c.status,'CONNECTED');
 try{
  assert.deepEqual(await c.journal.saveForecast({
   provider,id,scheduledAt:t,observedAt:t-30,raw:'3.0%'}),{inserted:true});
  assert.deepEqual(await c.journal.saveActual({
   provider,id,scheduledAt:t,observedAt:t+2,raw:'3.4%',previousRaw:'2.9%'}),
   {inserted:true});
  assert.deepEqual(await c.journal.saveActual({
   provider,id,scheduledAt:t,observedAt:t+8,raw:'9.9%',previousRaw:'0%'}),
   {inserted:false});
  await c.close();c=null;
  const reopened=await connectResearchJournal({url});
  try{
   const report=await reopened.journal.calendarEvidenceReport();
   const item=report.events.find(e=>e.id===id);
   assert.ok(item);
   assert.equal(item.actual,'3.4%');
   assert.equal(item.forecast,'3.0%');
   assert.equal(item.previous,'2.9%');
   assert.equal(item.dataStatus,'ALL_THREE_WITH_PRE_RELEASE_BASELINE');
   assert.equal(item.observationSecondsAfterScheduled,2);
   assert.equal(item.independentProviderLatencyVerified,false);
   assert.equal(report.realTimeTradingAuthorized,false);
  }finally{await reopened.close();}
 }finally{if(c)await c.close();}
});

test('durable Fusion A/B reservations, paired outcome and cap survive reconnect', {skip:!url},async()=>{
 let now=1893456000;
 const quote=(bid=100)=>({environment:'EXPERIMENTAL_NABD_AGENTIC',accountType:'DEMO',executionEnabled:false,symbol:'XAUUSD',brokerServer:'JustMarkets-Demo',brokerSymbol:'XAUUSD.m',accountLogin:42,timestamp:now,bid,ask:bid+0.2});
 let c=await connectResearchJournal({url,clock:()=>now});
 assert.equal(c.status,'CONNECTED');
 try{
  const store=c.journal.fusionStore;
  const reservations=await Promise.all([store.reserve({symbol:'XAUUSD',at:now,maxPerDay:1}),store.reserve({symbol:'BTCUSD',at:now,maxPerDay:1})]);
  assert.equal(reservations.filter(Boolean).length,1);
  const symbol=reservations[0]?'XAUUSD':'BTCUSD';
  const at=now;
  assert.equal(await store.save({symbol,at,observedAt:now,baseline:{stance:'WAIT',confidence:0.7},fusion:{stance:'BUY_WATCH',confidence:0.8},quote:{...quote(),symbol}}),true);
  await c.close();c=null;
  now+=3600;
  c=await connectResearchJournal({url,clock:()=>now});assert.equal(c.status,'CONNECTED');
  const reopened=c.journal.fusionStore;
  assert.equal(await reopened.reserve({symbol,at:now,maxPerDay:1}),false);
  assert.equal((await reopened.observe({...quote(101),symbol,accountLogin:43})).scored,0);
  assert.equal((await reopened.observe({...quote(101),symbol})).scored,1);
  assert.equal((await reopened.observe({...quote(102),symbol})).scored,0);
  const report=await reopened.report();
  assert.equal(report.usedToday,1);assert.equal(report.markets[symbol].fusion.hits,1);
  assert.equal(report.markets[symbol].baseline.wait,1);assert.equal(report.ordersCreated,0);
  assert.equal(JSON.stringify(report).includes('feed_fingerprint'),false);
 }finally{if(c)await c.close();}
});

 test('V5 statistical review executes against actual isolated PostgreSQL', {skip:!url},async()=>{
 const c=await connectResearchJournal({url});assert.equal(c.status,'CONNECTED');
 try{const r=await c.journal.statisticalReview();assert.ok(Array.isArray(r.groups));assert.equal(r.profitabilityMeasured,false);assert.equal(r.executionPermission,false);}
 finally{await c.close();}
 });

test('paper journal persists WAIT and direction, checks feed identity and deduplicates outcomes',{skip:!url},async()=>{
 let now=1900000200;
 const q=(symbol='XAUUSD',bid=100)=>({symbol,bid,ask:bid+.2,timestamp:now,environment:'EXPERIMENTAL_NABD_AGENTIC',accountType:'DEMO',executionEnabled:false,brokerServer:'JustMarkets-Demo',brokerSymbol:symbol+'.m',accountLogin:55});
 let c=await connectResearchJournal({url,clock:()=>now});assert.equal(c.status,'CONNECTED');
 try{
 const bar=now-300,features={M5:{atr14:2}};
 const input={symbol:'XAUUSD',closedBarTime:bar,features,plan:{stance:'WAIT',confidence:.7,timeHorizonMinutes:1},broker:q()};
 assert.equal((await c.journal.paperSave(input)).inserted,true);
 assert.equal((await c.journal.paperSave(input)).inserted,false);
 assert.equal((await c.journal.paperSave({...input,symbol:'BTCUSD',broker:q('BTCUSD'),plan:{...input.plan,stance:'BUY_WATCH'}})).inserted,true);
 await c.close();c=null;now+=60;
 c=await connectResearchJournal({url,clock:()=>now});assert.equal(c.status,'CONNECTED');
 assert.equal((await c.journal.paperObserve({...q('XAUUSD',103),accountLogin:56})).scored,0);
 assert.equal((await c.journal.paperObserve(q('XAUUSD',103))).scored,1);
 assert.equal((await c.journal.paperObserve(q('XAUUSD',104))).scored,0);
 assert.equal((await c.journal.paperObserve(q('BTCUSD',103))).scored,1);
 const report=await c.journal.paperReport();assert.equal(report.markets.XAUUSD.wait,1);assert.equal(report.markets.XAUUSD.directionalSamples,0);
 assert.equal(report.markets.BTCUSD.directionalSamples,1);assert.ok(report.markets.BTCUSD.netR>0);assert.equal(report.executionPermission,false);
 }finally{if(c)await c.close();}
});
