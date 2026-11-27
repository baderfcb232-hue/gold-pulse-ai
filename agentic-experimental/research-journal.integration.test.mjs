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

test('portfolio persists position and closes once across reconnect',{skip:!url},async()=>{
 let now=1900000200;
 const q=bid=>({symbol:'XAUUSD',bid,ask:bid+.2,timestamp:now,environment:'EXPERIMENTAL_NABD_AGENTIC',accountType:'DEMO',executionEnabled:false,brokerServer:'JustMarkets-Demo',brokerSymbol:'XAUUSD.m',accountLogin:55});
 let c=await connectResearchJournal({url,clock:()=>now});assert.equal(c.status,'CONNECTED');
 try{
 const input={symbol:'XAUUSD',closedBarTime:now-300,broker:q(100),features:{M5:{atr14:2}},plan:{stance:'BUY_WATCH',confidence:.9,timeHorizonMinutes:1}};
 assert.equal((await c.journal.portfolioSave(input)).entered,true);
 assert.equal((await c.journal.portfolioSave(input)).entered,false);
 await c.close();c=null;now+=10;
 c=await connectResearchJournal({url,clock:()=>now});assert.equal(c.status,'CONNECTED');
 await c.journal.portfolioObserve(q(112));await c.journal.portfolioObserve(q(112));
 const r=await c.journal.portfolioReport();assert.equal(r.markets.XAUUSD.closed,1);assert.equal(r.markets.XAUUSD.targetHits,1);assert.ok(r.markets.XAUUSD.balance>2000);assert.equal(r.executionPermission,false);
 }finally{if(c)await c.close();}
});


test('primary AI slot reservation is atomic, independent per market and durable across reconnect',{skip:!url},async()=>{
 let now=1920000010;
 const slot=Math.floor(now/2880)*2880;
 let a=await connectResearchJournal({url,clock:()=>now}),b=await connectResearchJournal({url,clock:()=>now});
 assert.equal(a.status,'CONNECTED');assert.equal(b.status,'CONNECTED');
 try{
 const args={symbol:'BTCUSD',slotStart:slot};
 const claims=await Promise.all([a.journal.reservePrimarySlot(args),b.journal.reservePrimarySlot(args)]);
 assert.equal(claims.filter(x=>x.inserted).length,1);
 assert.equal(claims.find(x=>!x.inserted).reason,'SLOT_ALREADY_RESERVED');
 assert.equal((await a.journal.reservePrimarySlot({...args,symbol:'XAUUSD'})).inserted,true);
 assert.deepEqual(await a.journal.reservePrimarySlot({...args,slotStart:slot+2880}),{inserted:false,reason:'INVALID_SLOT'});
 const report=await b.journal.primarySlotReport();assert.deepEqual(report.counts,{XAUUSD:1,BTCUSD:1});
 await a.close();a=null;
 assert.equal((await b.journal.reservePrimarySlot(args)).inserted,false);
 now=slot+2880+10;
 assert.equal((await b.journal.reservePrimarySlot({...args,slotStart:slot+2880})).inserted,true);
 }finally{if(a)await a.close();if(b)await b.close();}
});

test('isolated closure metrics require matched entry proof and survive reconnect without double counting',{skip:!url},async()=>{
 const t=1930000200,id='XAUUSD-'+t,feed='a'.repeat(64);
 let c=await connectResearchJournal({url});assert.equal(c.status,'CONNECTED');
 const anchor={intentId:id,symbol:'XAUUSD',dealTicket:891231,openedAt:t,side:'BUY',volume:.02,feed};
 const p={symbol:'XAUUSD',feed,positionId:991231,entryTicket:891231,openedAt:t,closedAt:t+600,side:'BUY',volume:.02,currency:'USD',grossProfit:10,commission:-1,swap:-.1,fee:-.2,net:8.7,exitCount:2};
 try{
 assert.equal((await c.journal.saveLifecycleAnchor(anchor)).inserted,false);
 assert.equal((await c.journal.saveClosedPosition(p)).matched,false);
 await c.journal.saveBrokerHistoryProof({intentId:id,symbol:'XAUUSD',dealTicket:891231,observedAt:t});
 assert.equal((await c.journal.saveLifecycleAnchor(anchor)).inserted,true);
 assert.equal((await c.journal.saveClosedPosition({...p,feed:'b'.repeat(64)})).matched,false);
 assert.equal((await c.journal.saveClosedPosition({...p,volume:.01})).matched,false);
 assert.deepEqual(await c.journal.saveClosedPosition(p),{inserted:true,matched:true});
 assert.deepEqual(await c.journal.saveClosedPosition(p),{inserted:false,matched:true});
 await c.close();c=null;
 const d=await connectResearchJournal({url});assert.equal(d.status,'CONNECTED');
 try{assert.deepEqual(await d.journal.saveClosedPosition(p),{inserted:false,matched:true});const r=await d.journal.closedPositionReport();const gold=r.markets.find(x=>x.symbol==='XAUUSD'&&x.currency==='USD');assert.equal(gold.closed,1);assert.equal(gold.wins,1);assert.equal(gold.net,8.7);assert.equal(gold.profitFactor,null);assert.equal(r.profitabilityEstablished,false);}finally{await d.close();}
 }finally{if(c)await c.close();}
});

test('H4 research persists a single paper entry across database reconnect',{skip:!url},async()=>{
 const t=1944000000,now=Math.floor(t/14400)*14400;
 const bars=Array.from({length:21},(_,i)=>({time:now-(21-i)*14400,open:100,high:102,low:98,close:100}));
 bars[20]={...bars[20],close:104,high:105};
 const q={environment:'EXPERIMENTAL_NABD_AGENTIC',accountType:'DEMO',executionEnabled:false,symbol:'XAUUSD',timestamp:now,bid:104,ask:104.2,brokerServer:'Demo-test-broker',brokerSymbol:'XAUUSD.m',accountLogin:555,multiTimeframeVerified:true,candlesH4:bars};
 let c=await connectResearchJournal({url,clock:()=>now});assert.equal(c.status,'CONNECTED');
 try{await c.journal.goldH4Observe(q);assert.equal((await c.journal.goldH4Report()).entries,1);await c.close();c=null;
 const d=await connectResearchJournal({url,clock:()=>now});assert.equal(d.status,'CONNECTED');
 try{await d.journal.goldH4Observe(q);const r=await d.journal.goldH4Report();assert.equal(r.entries,1);assert.equal(r.open,1);assert.equal(r.ordersCreated,0);}finally{await d.close();}
 }finally{if(c)await c.close();}
});

test('LW candidates persist and deduplicate for both directions independently of AI slots',{skip:!url},async()=>{
 const start=1950048000,now=start+600;
 const c=await connectResearchJournal({url,clock:()=>now});assert.equal(c.status,'CONNECTED');
 try{
 for(const side of [1,-1]){
 const closed=Array.from({length:21},(_,i)=>{const price=100+side*i;return {time:start-(21-i)*86400,open:price,high:price+2,low:price-2,close:price}});
 const open=closed.at(-1).close,price=open+side*2.5;
 const q={environment:'EXPERIMENTAL_NABD_AGENTIC',accountType:'DEMO',executionEnabled:false,symbol:'XAUUSD',brokerServer:'Isolated-LW-Demo',brokerSymbol:'XAUUSD.m',accountLogin:side===1?8181:8182,timestamp:now,bid:price,ask:price+.1,dailySession:{start,open,closed},candlesM5:[{time:start,open,high:open+1,low:open-1,close:open},{time:start+300,open,high:open+3,low:open-3,close:price}]};
 assert.equal((await c.journal.lwObserve(q)).inserted,true);assert.equal((await c.journal.lwObserve(q)).inserted,false);
 }
 const r=await c.journal.lwReport();assert.equal(r.executionPermission,false);assert.equal(r.candidates.filter(x=>x.status==='OBSERVED_CANDIDATE').length,2);
 }finally{await c.close();}
});
