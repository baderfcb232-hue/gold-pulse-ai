// NABD Agentic AI isolated connectivity service.
// No imports from production. No trading, database, Telegram, or signal routes.
import http from 'node:http';
import {authorizedView, createObservatory} from './observatory.mjs';
const observatory = createObservatory();
import {HybridScheduler} from './hybrid-scheduler.mjs';
import {createShadowFeedRunner} from './shadow-feed-runner.mjs';
import {createPublicGoldObserver} from './gold-spot-public.mjs';
import {createResearchSources} from './research-sources.mjs';
import {createOfficialNewsMonitor} from './official-news.mjs';
import {newsResearchReadiness} from './news-surprise.mjs';
import {createEconomicCalendarMonitor} from './economic-calendar-monitor.mjs';
import {createBlsOfficialMonitor} from './bls-official-indicators.mjs';
import {connectResearchJournal} from './research-journal-pg.mjs';
import {createDelayedCalendarMonitor} from './delayed-consensus.mjs';
import {liveNewsSystemStatus} from './live-news-gate.mjs';
import {createLiveCalendarStream} from './live-calendar-stream.mjs';
import {createResearchBrain} from './research-brain.mjs';
import {demoSensorReadiness} from './mt5-demo-sensor.mjs';
import {runSyntheticShadowSmoke} from './shadow-smoke.mjs';
import {buildExperimentReadiness} from './readiness-report.mjs';
import {createDemoIngest} from './demo-ingest.mjs';
import {createDemoAutoBrain} from './demo-auto-brain.mjs';
import {createFusionRuntime} from './fusion-ab-runtime.mjs';
import {createDemoTradeIntents} from './demo-trade-intents.mjs';
import {createClosedHistoryIngest} from './demo-closed-history.mjs';
import {createDemoHistoryIngest} from './demo-history-ingest.mjs';
import {createFredHistoricalMonitor} from './fred-historical-fallback.mjs';
import {createIsolatedDecisionAudit} from './phase5-decision-audit.mjs';
import {createForwardEvaluation} from './phase6-forward-evaluation.mjs';
import {createPhase7Comparator} from './phase7-strategy-comparison.mjs';
import {assessIsolatedQuality} from './phase9-quality-monitor.mjs';
import {createIncidentMonitor} from './phase10-incident-monitor.mjs';
const feed=createShadowFeedRunner();
const goldSpot=createPublicGoldObserver();
const sources=createResearchSources({goldKey:process.env.NABD_TEST_GOLD_TWELVEDATA_KEY}); // Calendar polled only by economicCalendar to avoid duplicate paid-provider calls.
const hybrid=new HybridScheduler({dailyLimit:60,perSymbolLimit:30,paced:true,opportunityPaced:true});
let shadowSmoke={status:'NOT_RUN',syntheticDataOnly:true,brokerTradingEnabled:false};
const researchBrain=createResearchBrain({key:process.env.OPENAI_API_KEY,model:process.env.NABD_RESEARCH_MODEL||'gpt-4.1-mini'});
// Use a separate in-flight guard for each market; a slow gold analysis never
// forces the concurrently observed Bitcoin broker snapshot to become stale.
const btcResearchBrain=createResearchBrain({key:process.env.OPENAI_API_KEY,model:process.env.NABD_RESEARCH_MODEL||'gpt-4.1-mini'});
const demoIngest=createDemoIngest({secret:process.env.NABD_TEST_DEMO_SENSOR_HMAC_SECRET||''});
const fusionRuntime=createFusionRuntime({
 enabled:process.env.NABD_TEST_FUSION_AB==='true',
 brains:Object.fromEntries(['XAUUSD','BTCUSD'].map(symbol=>[symbol,createResearchBrain({key:process.env.OPENAI_API_KEY,model:process.env.NABD_RESEARCH_MODEL||'gpt-4.1-mini'})])),
 quoteProvider:symbol=>demoIngest.getLatest(symbol),
 storeProvider:()=>connectedJournal?.fusionStore,
 onEvent:(symbol,event)=>console.log('[NABD FUSION AB]',symbol,event)
});
const officialNews=createOfficialNewsMonitor();
const decisionAudit=createIsolatedDecisionAudit();
const forwardEvaluation=createForwardEvaluation();
const strategyComparison=createPhase7Comparator();
const incidentMonitor=createIncidentMonitor();
let connectedJournal=null;
// Only bounded, redacted event labels reach the verified isolated test database.
// Never retain HTTP bodies, logins, signatures, broker tickets or price streams.
const operationalQueue=[];
let operationalBusy=false,operationalWriteFailures=0,operationalDropped=0;
let operationalLastPersistedAt=null;
const operationalCode=x=>typeof x==='string'&&/^[A-Z][A-Z0-9_]{1,79}$/.test(x);
function recordOperational(source,stage,symbol=null,reason=null){
 if(!['BRAIN','TRADE','ACK','SENSOR'].includes(source)||
    !operationalCode(stage))return;
 const item={source,stage,
  symbol:['XAUUSD','BTCUSD'].includes(symbol)?symbol:null,
  reason:operationalCode(reason)?reason:null,
  observedAt:Math.floor(Date.now()/1000)};
 if(operationalQueue.length>=100){operationalQueue.shift();operationalDropped++;}
 operationalQueue.push(item);
 void flushOperational();
}
async function flushOperational(){
 if(operationalBusy||!connectedJournal?.saveOperationalEvent)return;
 operationalBusy=true;
 try{
  while(operationalQueue.length&&connectedJournal?.saveOperationalEvent){
   try{
    await connectedJournal.saveOperationalEvent(operationalQueue[0]);
    operationalQueue.shift();
    operationalLastPersistedAt=new Date().toISOString();
   }catch{
    operationalWriteFailures++;
    console.log('[NABD OPERATIONAL AUDIT] WRITE_FAILED');
    break;
   }
  }
 }finally{operationalBusy=false;}
}
const forwardDbQueue=new Map();
let forwardDbWriteFailures=0;
function serializeForwardDb(symbol,work){
 const previous=forwardDbQueue.get(symbol)||Promise.resolve();
 const next=previous.catch(()=>{}).then(async()=>{
  const journal=connectedJournal;
  if(!journal)return;
  await work(journal);
 }).catch(()=>{forwardDbWriteFailures++;console.log('[NABD FORWARD DB] WRITE_FAILED',symbol);});
 forwardDbQueue.set(symbol,next);
 void next.finally(()=>{if(forwardDbQueue.get(symbol)===next)forwardDbQueue.delete(symbol)});
}

// Independent gold H4 research probe: one sampled quote per minute, plus new deep H4 bars.
let goldH4Busy=false,goldH4LastTick=0,goldH4LastBar=0,goldH4Errors=0;
function observeGoldH4(q){
 if(q?.symbol!=='XAUUSD'||!connectedJournal?.goldH4Observe||goldH4Busy)return;
 const bar=q.multiTimeframeVerified&&q.candlesH4?.length>=21?q.candlesH4.at(-1)?.time||0:0;
 if(bar<=goldH4LastBar&&q.timestamp-goldH4LastTick<60)return;
 goldH4Busy=true;
 void connectedJournal.goldH4Observe(q).then(()=>{goldH4LastTick=q.timestamp;goldH4LastBar=Math.max(goldH4LastBar,bar);}).catch(()=>{goldH4Errors++;console.log('[NABD GOLD H4] WRITE_FAILED');}).finally(()=>{goldH4Busy=false});
}
// Paper work has its own bounded observer queue; never delay existing forward scoring.
const paperDbQueue=new Map(),paperLastObserve=new Map();
let paperDbFailures=0,paperObserverSkipped=0;
function enqueuePaper(symbol,work,observation=false){
 if(observation){
  const now=Math.floor(Date.now()/1000);
  if(now-(paperLastObserve.get(symbol)??-Infinity)<10)return;
  if(paperDbQueue.has(symbol)){paperObserverSkipped++;return;}
  paperLastObserve.set(symbol,now);
 }
 const previous=paperDbQueue.get(symbol)||Promise.resolve();
 const next=previous.catch(()=>{}).then(async()=>{if(connectedJournal)await work(connectedJournal);})
  .catch(()=>{paperDbFailures++;console.log('[NABD PAPER DB] WRITE_FAILED',symbol);});
 paperDbQueue.set(symbol,next);
 void next.finally(()=>{if(paperDbQueue.get(symbol)===next)paperDbQueue.delete(symbol)});
}
const demoTradeIntents=createDemoTradeIntents({
 enabled:process.env.NABD_TEST_DEMO_AUTO_EXECUTION==='true',
 secret:process.env.NABD_TEST_DEMO_EXEC_HMAC_SECRET||'',
 quoteProvider:symbol=>demoIngest.getLatest(symbol),
 onAudit:(symbol,stage,reason)=>{
   decisionAudit.record(symbol,{stage,reason});
   recordOperational('TRADE',stage,symbol,reason);
   console.log('[NABD DEMO INTENT]',symbol,stage,reason||'');
  },
 onAckDiagnostic:reason=>recordOperational('ACK','REJECTED',null,reason),
 onBrokerHistoryProof:proof=>{
  serializeForwardDb(proof.symbol,journal=>journal.saveBrokerHistoryProof(proof));
 },
 onLifecycleAnchor:anchor=>serializeForwardDb(anchor.symbol,journal=>journal.saveLifecycleAnchor(anchor))
});
const closureIngest=createClosedHistoryIngest({secret:process.env.NABD_TEST_DEMO_HISTORY_HMAC_SECRET||'',quoteProvider:s=>demoIngest.getLatest(s),journalProvider:()=>connectedJournal});
const demoHistoryIngest=createDemoHistoryIngest({
 secret:process.env.NABD_TEST_DEMO_HISTORY_HMAC_SECRET||'',
 quoteProvider:symbol=>demoIngest.getLatest(symbol),
 matchHistory:(deals,broker)=>demoTradeIntents.observeBrokerHistory(deals,broker)
});
const demoAutoBrain=createDemoAutoBrain({brains:{XAUUSD:researchBrain,BTCUSD:btcResearchBrain},
 scheduler:hybrid,enabled:process.env.NABD_TEST_AUTO_RESEARCH==='true',
 journalProvider:()=>connectedJournal,
 onComparison:(ctx,primary)=>fusionRuntime.start(ctx,primary),
 onPlan:p=>{
   const broker=demoIngest.getLatest(p.symbol);
   strategyComparison.compare({symbol:p.symbol,closedBarTime:p.closedBarTime,
    plan:p.plan,features:p.features});
   forwardEvaluation.record({symbol:p.symbol,closedBarTime:p.closedBarTime,
    plan:p.plan,broker});
   serializeForwardDb(p.symbol,journal=>journal.saveForward({symbol:p.symbol,
    closedBarTime:p.closedBarTime,plan:p.plan,features:p.features,broker}));
   enqueuePaper(p.symbol,async journal=>{
    const input={symbol:p.symbol,closedBarTime:p.closedBarTime,plan:p.plan,features:p.features,broker};
    await journal.portfolioSave(input);
    await journal.paperSave(input);
   });
   const verdict = demoTradeIntents.consider(p);
   try { observatory.decision(p,verdict); } catch {}
   return verdict;
  },
 onAudit:(symbol,event)=>{
   decisionAudit.record(symbol,event);
   recordOperational('BRAIN',event.stage,symbol,event.reason);
   try { observatory.analysis(symbol,event); } catch {}
   console.log('[NABD AUTO BRAIN]',symbol,event.stage,event.stance||'',event.reasonSummary||event.reason||'');
  }});
const economicCalendar=createEconomicCalendarMonitor({key:process.env.NABD_TEST_TRADING_ECONOMICS_KEY,journalProvider:()=>connectedJournal});
const blsIndicators=createBlsOfficialMonitor();
const fredHistorical=createFredHistoricalMonitor();
const delayedCalendar=createDelayedCalendarMonitor();
const liveCalendarStream=createLiveCalendarStream({journalProvider:()=>connectedJournal});
let journalState={status:'NOT_CONFIGURED',isolated:true,persistenceConnected:false,writePathEnabled:false};
const port=Number(process.env.PORT||10000);
const model=process.env.NABD_RESEARCH_MODEL||'gpt-4.1-mini';
let state='NO_API_KEY';
let checkTime=null;
async function verify(){
  const key=process.env.OPENAI_API_KEY;
  if(!key){ state='NO_API_KEY'; return; }
  state='CHECKING';
  try {
    const response=await fetch('https://api.openai.com/v1/responses',{
      method:'POST',
      headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
      body:JSON.stringify({
        model,store:false,max_output_tokens:100,
        instructions:'This is only an API connectivity check. Reply with the exact word OK. No market advice.',
        input:'Connectivity check with no market data.'
      }),
      signal:AbortSignal.timeout(25000)
    });
    state=response.ok?'CONNECTED':'API_HTTP_'+response.status;
  }catch{state='CONNECTION_ERROR';}
  checkTime=new Date().toISOString();
  console.log('[NABD AGENTIC TEST] verification status:',state);
}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const pathname=url.pathname;
  if (pathname === '/observatory/v1') {
    const headers={'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
    if (req.method !== 'GET' || !authorizedView(req.headers.authorization,process.env.NABD_DEMO_VIEW_TOKEN)) {
      res.writeHead(403,headers);res.end(JSON.stringify({error:'READ_AUTH_REQUIRED'}));return;
    }
    try {
      const view=await observatory.read({requested:url.searchParams.get('cycle'),journal:connectedJournal,
        trade:demoTradeIntents.report(),sensor:demoIngest.report(),active:demoAutoBrain.report().active});
      res.writeHead(200,headers);res.end(JSON.stringify(view));
    } catch {
      res.writeHead(503,headers);res.end(JSON.stringify({error:'TELEMETRY_UNAVAILABLE'}));
    }
    return;
  }
  if(pathname==='/gold-h4-research/status'&&req.method==='GET'){
    const headers={'Content-Type':'application/json','Cache-Control':'private, no-store'};
    if(!authorizedView(req.headers.authorization,process.env.NABD_DEMO_VIEW_TOKEN)){res.writeHead(403,headers);res.end(JSON.stringify({error:'READ_AUTH_REQUIRED'}));return;}
    try{const data=await connectedJournal.goldH4Report();res.writeHead(200,headers);res.end(JSON.stringify({...data,probeErrors:goldH4Errors}));}
    catch{res.writeHead(503,headers);res.end(JSON.stringify({error:'H4_RESEARCH_JOURNAL_UNAVAILABLE'}));}return;
  }
  if(pathname==='/demo-history/closures/status'&&req.method==='GET'){
    const headers={'Content-Type':'application/json','Cache-Control':'private, no-store'};
    if(!authorizedView(req.headers.authorization,process.env.NABD_DEMO_VIEW_TOKEN)){res.writeHead(403,headers);res.end(JSON.stringify({error:'READ_AUTH_REQUIRED'}));return;}
    try{const data=await connectedJournal.closedPositionReport();res.writeHead(200,headers);res.end(JSON.stringify({...data,ingest:closureIngest.report()}));}
    catch{res.writeHead(503,headers);res.end(JSON.stringify({error:'CLOSURE_JOURNAL_UNAVAILABLE'}));}return;
  }
  if(pathname==='/demo-history/closures'&&req.method==='POST'){
    const send=(status,payload)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'private, no-store'});res.end(JSON.stringify(payload));};
    let chunks=[],size=0;
    try{for await(const chunk of req){size+=chunk.length;if(size>64000){send(413,{status:'REJECTED',ordersCreated:0});return;}chunks.push(chunk);}}
    catch{if(!res.writableEnded)send(400,{status:'REJECTED',ordersCreated:0});return;}
    const answer=await closureIngest.receive({body:Buffer.concat(chunks).toString('utf8'),timestamp:req.headers['x-nabd-history-timestamp'],mac:req.headers['x-nabd-history-signature'],secure:req.socket.encrypted===true||req.headers['x-forwarded-proto']==='https'});
    send(answer.status==='OBSERVED'?202:403,answer);return;
  }
  if(pathname==='/demo-history/observe'&&req.method==='POST'){
    const send=(status,payload)=>{res.writeHead(status,{
      'Content-Type':'application/json','Cache-Control':'private, no-store'});
      res.end(JSON.stringify(payload))};
    if(demoHistoryIngest.report().authentication==='NOT_CONFIGURED'){
      send(503,{status:'NOT_CONFIGURED',ordersCreated:0});return;
    }
    let body='',size=0;
    try{
      for await(const chunk of req){
        size+=chunk.length;
        if(size>16000){send(413,{status:'REJECTED',code:'INVALID_BODY',ordersCreated:0});return;}
        body+=chunk.toString('utf8');
      }
    }catch{if(!res.writableEnded)send(400,{status:'REJECTED',ordersCreated:0});return;}
    const answer=demoHistoryIngest.receive({
      body,timestamp:req.headers['x-nabd-history-timestamp'],
      mac:req.headers['x-nabd-history-signature'],
      secure:req.socket.encrypted===true||req.headers['x-forwarded-proto']==='https'
    });
    send(answer.status==='OBSERVED'?202:403,answer);
    return;
  }
  if((pathname==='/demo-trade/pull'||pathname==='/demo-trade/ack'||pathname==='/demo-trade/heartbeat')&&req.method==='POST'){
    const send=(status,payload)=>{res.writeHead(status,{
      'Content-Type':'application/json','Cache-Control':'no-store'});
      res.end(JSON.stringify(payload))};
    if(pathname!=='/demo-trade/heartbeat'&&!demoTradeIntents.report().enabled){
      send(503,{status:'DISABLED',wire:null});return;
    }
    let body='',size=0;
    try{
      for await(const chunk of req){
        size+=chunk.length;
        if(size>2000){send(413,{status:'REJECTED',wire:null});return}
        body+=chunk.toString('utf8');
      }
    }catch{send(400,{status:'REJECTED',wire:null});return}
    const auth={body,timestamp:req.headers['x-nabd-exec-timestamp'],
      mac:req.headers['x-nabd-exec-signature'],
      secure:req.socket.encrypted===true||req.headers['x-forwarded-proto']==='https'};
    if(pathname==='/demo-trade/heartbeat'){
      const result=demoTradeIntents.heartbeat(auth);
      const code=result.authenticated?200:result.status==='HEARTBEAT_DISABLED'?503:403;
      send(code,result);return;
    }
    const result=pathname==='/demo-trade/pull'?
      demoTradeIntents.pull(auth):demoTradeIntents.ack(auth);
    if(pathname==='/demo-trade/ack' && result.status==='RECORDED') {
      try { observatory.acknowledge(JSON.parse(body)); } catch {}
    }
    send(['REJECTED','WRONG_DEMO_ACCOUNT','BROKER_MISMATCH','SENSOR_ACCOUNT_UNVERIFIED','SYMBOL_MAPPING_UNVERIFIED','BROKER_SYMBOL_MISMATCH'].includes(result.status)?403:
      result.status==='WAITING_FOR_SENSOR'?409:200,result);
    return;
  }
  if(pathname==='/demo-sensor/observe'&&req.method==='POST'){
    const send=(status,payload)=>{res.writeHead(status,{'Content-Type':'application/json',
      'Cache-Control':'no-store'});res.end(JSON.stringify(payload))};
    if(demoIngest.report().authentication==='DISABLED'){
      send(503,{status:'DISABLED',ordersSupported:false});return;
    }
    let body='',size=0;
    try{
      for await(const chunk of req){
        size+=chunk.length;
        if(size>120000){send(413,{status:'REJECTED',code:'BODY_TOO_LARGE'});return}
        body+=chunk.toString('utf8');
      }
    }catch{if(!res.writableEnded)send(400,{status:'REJECTED',code:'BODY_READ_ERROR'});return}
    const verdict=demoIngest.receive({
      body,timestamp:req.headers['x-nabd-sensor-timestamp'],
      signature:req.headers['x-nabd-sensor-signature'],
      secure:req.socket.encrypted===true||req.headers['x-forwarded-proto']==='https'
    });
    const researchScheduling={};
    // Do not persist arbitrary unauthenticated internet traffic as database rows.
    // Only code paths reached after a valid signed sensor envelope are durable.
    if(verdict.status==='REJECTED'&&
       ['JSON_INVALID','ISOLATION_PROVENANCE_INVALID','BROKER_IDENTITY_UNVERIFIED',
        'MARKET_SNAPSHOT_INVALID','NO_VALID_MARKET_SNAPSHOTS',
        'OUT_OF_ORDER_BROKER_QUOTE','REPLAY_DETECTED'].includes(verdict.code))
      recordOperational('SENSOR','REJECTED',null,verdict.code);
    if(verdict.status==='OBSERVED'){
      let historyPacket=null;
      try {historyPacket=JSON.parse(body).history;} catch {}
      for(const symbol of verdict.symbols){
        const snapshot=demoIngest.getLatest(symbol);
        observeGoldH4(snapshot);
        forwardEvaluation.observe(snapshot);
        fusionRuntime.observe(snapshot);
        serializeForwardDb(symbol,journal=>journal.observeForward(snapshot));
        enqueuePaper(symbol,async journal=>{await journal.portfolioObserve(snapshot);await journal.paperObserve(snapshot);},true);
        // Independently read from the MT5 history API by a signed Demo sensor.
        // Compare against the exact ACK delivery and protective levels; never
        // count self-reported ACK as broker-history proof.
        demoTradeIntents.observeBrokerHistory(historyPacket?.[symbol],snapshot);
        researchScheduling[symbol]=demoAutoBrain.onSnapshot(snapshot);
        try { observatory.observe(snapshot,researchScheduling[symbol]); observatory.history(historyPacket?.[symbol],snapshot); } catch {}
      }
    }
    send(verdict.status==='OBSERVED'?202:403,{...verdict,researchScheduling});return;
  }
  if(req.method!=='GET'||!['/healthz','/hybrid/status','/feed/status','/gold/status','/research/status','/news/status','/news/research','/calendar/status','/official-data/status','/fred-historical/status','/journal/status','/delayed-consensus/status','/live-news/status','/live-news/evidence','/live-calendar/status','/brain/status','/auto-brain/status','/demo-trade/status','/demo-trade/history-proofs','/demo-history/status','/demo-sensor/status','/shadow-smoke/status','/decision-audit/status','/forward-evaluation/status','/strategy-comparison/status','/fusion-ab/status','/statistical-review/status','/profitability/status','/paper-portfolio/status','/durable-evaluation/status','/operational-audit/status','/quality/status','/incident/status','/integration/status'].includes(pathname)){
    res.writeHead(404,{'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end(JSON.stringify({error:'not_found'}));return;
  }
  if(pathname==='/incident/status'){
    const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
    let durable=null;
    try{if(connectedJournal?.forwardReport)durable=await connectedJournal.forwardReport();}
    catch{durable=null;}
    const sensor=demoIngest.report();
    const quality=assessIsolatedQuality({
      sensor,autoBrain:demoAutoBrain.report(),model:researchBrain.report(),
      journal:journalState,durable,forwardWriteFailures:forwardDbWriteFailures});
    const observations=Object.fromEntries(Object.entries(sensor.markets||{})
      .map(([symbol,state])=>[symbol,state.receivedAt]));
    const incidents=incidentMonitor.ingest(quality,{observations});
    res.writeHead(200,headers);res.end(JSON.stringify(incidents));return;
  }
  if(pathname==='/quality/status'){
    const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
    let durable=null;
    try{if(connectedJournal?.forwardReport)durable=await connectedJournal.forwardReport();}
    catch{durable=null;}
    const quality=assessIsolatedQuality({
      sensor:demoIngest.report(),autoBrain:demoAutoBrain.report(),
      model:researchBrain.report(),journal:journalState,
      durable,forwardWriteFailures:forwardDbWriteFailures});
    res.writeHead(200,headers);res.end(JSON.stringify(quality));return;
  }
  if(pathname==='/live-news/evidence'){
    const headers={'Content-Type':'application/json','Cache-Control':'private, no-store'};
    if(!authorizedView(req.headers.authorization,process.env.NABD_DEMO_VIEW_TOKEN)){
      res.writeHead(403,headers);res.end(JSON.stringify({error:'READ_AUTH_REQUIRED'}));return;
    }
    if(!connectedJournal?.calendarEvidenceReport){
      res.writeHead(503,headers);res.end(JSON.stringify({status:'ISOLATED_DB_NOT_CONNECTED'}));return;
    }
    try{
      const archive=await connectedJournal.calendarEvidenceReport();
      const stream=liveCalendarStream.report();
      res.writeHead(200,headers);
      res.end(JSON.stringify({...archive,streamStatus:stream.status,
        providerConfigured:stream.configured,independentLatencyVerified:false,
        publicationTimeVerified:false,newsTradingEnabled:false}));return;
    }catch{
      res.writeHead(503,headers);res.end(JSON.stringify({status:'NEWS_EVIDENCE_QUERY_FAILED'}));return;
    }
  }
  if(pathname==='/demo-trade/history-proofs'){
    const headers={'Content-Type':'application/json','Cache-Control':'private, no-store'};
    if(!authorizedView(req.headers.authorization,process.env.NABD_DEMO_VIEW_TOKEN)){
      res.writeHead(403,headers);res.end(JSON.stringify({error:'READ_AUTH_REQUIRED'}));return;
    }
    if(!connectedJournal?.brokerHistoryProofReport){
      res.writeHead(503,headers);res.end(JSON.stringify({status:'NO_ISOLATED_DB_PROOF'}));return;
    }
    try{
      const data=await connectedJournal.brokerHistoryProofReport();
      res.writeHead(200,headers);res.end(JSON.stringify(data));return;
    }catch{
      res.writeHead(503,headers);res.end(JSON.stringify({status:'PROOF_QUERY_UNAVAILABLE'}));return;
    }
  }
  if(pathname==='/operational-audit/status'){
    const headers={'Content-Type':'application/json','Cache-Control':'private, no-store'};
    if(!authorizedView(req.headers.authorization,process.env.NABD_DEMO_VIEW_TOKEN)){
      res.writeHead(403,headers);
      res.end(JSON.stringify({error:'READ_AUTH_REQUIRED'}));return;
    }
    if(!connectedJournal?.operationalReport){
      res.writeHead(503,headers);
      res.end(JSON.stringify({status:'ISOLATED_DATABASE_NOT_CONNECTED',
       persistentMetricsAvailable:false}));return;
    }
    try{
      const report=await connectedJournal.operationalReport();
      res.writeHead(200,headers);
      res.end(JSON.stringify({...report,pendingWrites:operationalQueue.length,
       writeFailures:operationalWriteFailures,droppedEvents:operationalDropped,
       lastPersistedAt:operationalLastPersistedAt}));return;
    }catch{
      res.writeHead(503,headers);
      res.end(JSON.stringify({status:'OPERATIONAL_AUDIT_QUERY_FAILED',
       persistentMetricsAvailable:false}));return;
    }
  }
  if(pathname==='/paper-portfolio/status'){
    const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
    try{
      if(!connectedJournal?.portfolioReport)throw Error('NOT_CONNECTED');
      const report=await connectedJournal.portfolioReport();
      res.writeHead(200,headers);res.end(JSON.stringify({status:'PROSPECTIVE_PAPER_ONLY',...report,writeFailures:paperDbFailures,observerBusySkipped:paperObserverSkipped,observationIntervalSeconds:10}));return;
    }catch{
      res.writeHead(503,headers);res.end(JSON.stringify({status:'PORTFOLIO_REPORT_UNAVAILABLE',executionPermission:false}));return;
    }
  }
  if(pathname==='/profitability/status'){
    const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
    try{
      if(!connectedJournal?.paperReport)throw Error('NOT_CONNECTED');
      const report=await connectedJournal.paperReport();
      res.writeHead(200,headers);res.end(JSON.stringify({status:'PAPER_RESEARCH_ONLY',...report,writeFailures:paperDbFailures,observerBusySkipped:paperObserverSkipped,observationIntervalSeconds:10}));return;
    }catch{
      res.writeHead(503,headers);res.end(JSON.stringify({status:'PAPER_REPORT_UNAVAILABLE',executionPermission:false}));return;
    }
  }
  if(pathname==='/statistical-review/status'){
    const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
    if(!connectedJournal?.statisticalReview){
      res.writeHead(503,headers);res.end(JSON.stringify({status:'ISOLATED_DATABASE_NOT_CONNECTED',executionPermission:false}));return;
    }
    try{
      const report=await connectedJournal.statisticalReview();
      res.writeHead(200,headers);res.end(JSON.stringify({status:'DESCRIPTIVE_RESEARCH_ONLY',...report}));return;
    }catch{
      res.writeHead(503,headers);res.end(JSON.stringify({status:'STATISTICAL_REVIEW_QUERY_FAILED',executionPermission:false}));return;
    }
  }
  if(pathname==='/durable-evaluation/status'){
    const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
    if(!connectedJournal?.forwardReport){
      res.writeHead(503,headers);res.end(JSON.stringify({status:'ISOLATED_DATABASE_NOT_CONNECTED',
       persistentMetricsAvailable:false,executionAllowed:false}));return;
    }
    try{
      const report=await connectedJournal.forwardReport();
      res.writeHead(200,headers);res.end(JSON.stringify({...report,
       writeFailures:forwardDbWriteFailures}));return;
    }catch{
      res.writeHead(503,headers);res.end(JSON.stringify({status:'PERSISTED_EVALUATION_QUERY_FAILED',
       persistentMetricsAvailable:false,executionAllowed:false}));return;
    }
  }
  res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(JSON.stringify(pathname==='/fusion-ab/status' ? await fusionRuntime.durableReport() : pathname==='/strategy-comparison/status' ? strategyComparison.report() : pathname==='/forward-evaluation/status' ? forwardEvaluation.report() : pathname==='/decision-audit/status' ? decisionAudit.report() : pathname==='/integration/status' ? buildExperimentReadiness({bls:blsIndicators.report(),fred:fredHistorical.report(),brain:researchBrain.report(),autoBrain:demoAutoBrain.report(),execution:demoTradeIntents.report(),demo:{...demoSensorReadiness(),brokerConnected:Object.values(demoIngest.report().markets).some(m=>m.status==='SENSOR_OBSERVED')},journal:journalState,smoke:shadowSmoke,fxStreetAuthorized:false,officialReleaseVerified:false}) : pathname==='/shadow-smoke/status' ? shadowSmoke : pathname==='/brain/status' ? {...researchBrain.report(),BTCUSD:btcResearchBrain.report(),autoResearch:demoAutoBrain.report()} : pathname==='/auto-brain/status' ? demoAutoBrain.report() : pathname==='/demo-trade/status' ? demoTradeIntents.report() : pathname==='/demo-history/status' ? {...demoHistoryIngest.report(),closures:closureIngest.report()} : pathname==='/demo-sensor/status' ? {...demoSensorReadiness(),status:Object.values(demoIngest.report().markets).some(x=>x.status==='SENSOR_OBSERVED')?'OBSERVING_ISOLATED_DEMO':'AWAITING_ISOLATED_DEMO_SENSOR',acceptedMethod:demoIngest.report().authentication==='HMAC_SHA256_CONFIGURED'?'HMAC_SHA256_AUTHENTICATED_HTTP':'DISABLED',autoResearch:demoAutoBrain.report(),httpIngestEnabled:demoIngest.report().authentication==='HMAC_SHA256_CONFIGURED',brokerConnected:Object.values(demoIngest.report().markets).some(x=>x.status==='SENSOR_OBSERVED'),ingestion:demoIngest.report()} : pathname==='/live-calendar/status' ? liveCalendarStream.report() : pathname==='/live-news/status' ? liveNewsSystemStatus({journalConnected:!!connectedJournal,calendarKeyConfigured:!!process.env.NABD_TEST_TRADING_ECONOMICS_STREAM_KEY&&!!process.env.NABD_TEST_TRADING_ECONOMICS_STREAM_SECRET,realtimeFeedVerified:false,officialReleaseTimestampVerified:false,preReleaseForecastCaptured:false,brokerFeedVerified:false}) : pathname==='/delayed-consensus/status' ? delayedCalendar.report() : pathname==='/journal/status' ? journalState : pathname==='/fred-historical/status' ? fredHistorical.report() : pathname==='/official-data/status' ? blsIndicators.report() : pathname==='/calendar/status' ? economicCalendar.report() : pathname==='/news/research' ? newsResearchReadiness({calendarConfigured:!!process.env.NABD_TEST_TRADING_ECONOMICS_KEY,verifiedReleaseArchive:false,goldBrokerCandles:false,btcBrokerCandles:false,openaiConnected:state==='CONNECTED'}) : pathname==='/news/status' ? officialNews.report() : pathname==='/gold/status' ? goldSpot.report() : pathname==='/research/status' ? sources.report() : pathname==='/feed/status' ? feed.report() : pathname==='/hybrid/status' ? {...hybrid.report(),durable:await (async()=>{try{return await connectedJournal?.primarySlotReport()||null}catch{return null}})(),marketAdapter:Object.values(demoIngest.report().markets).some(m=>m.status==='SENSOR_OBSERVED')?'isolated_demo_sensor':'not_connected'} : {service:'nabd-agentic-ai-test',experimental:true,reference_only:true,trading_enabled:false,model_connection:state,last_checked:checkTime}));
});
server.listen(port,'0.0.0.0',()=>{console.log('[NABD AGENTIC TEST] ready on port',port);void verify();
  void runSyntheticShadowSmoke().then(result=>{shadowSmoke=result;
    console.log('[NABD SHADOW SELF TEST]',result.status);
  }).catch(()=>{shadowSmoke={status:'SYNTHETIC_SELF_TEST_FAILED',syntheticDataOnly:true,brokerTradingEnabled:false};
    console.log('[NABD SHADOW SELF TEST] FAILED');});
  void connectResearchJournal().then(r=>{
    connectedJournal=r.status==='CONNECTED'?r.journal:null;
    journalState={status:r.status,isolated:true,persistenceConnected:r.status==='CONNECTED',writePathEnabled:!!connectedJournal&&!!process.env.NABD_TEST_TRADING_ECONOMICS_KEY};
    console.log('[NABD RESEARCH JOURNAL]',r.status);
    void flushOperational();
  });
  void feed.poll().then(r=>console.log('[NABD REFERENCE FEED]',r.status,r.code||r.observation?.trigger));
  void goldSpot.poll().then(r=>console.log('[NABD GOLD REFERENCE]',r.status,r.code||''));
  void sources.check().then(r=>console.log('[NABD RESEARCH SOURCES]',JSON.stringify(r)));
  void officialNews.poll().then(r=>console.log('[NABD OFFICIAL NEWS]',r.status,JSON.stringify(r.providers)));
  const officialNewsTimer=setInterval(()=>void officialNews.poll().then(r=>{if(r.status!=='OK')console.log('[NABD OFFICIAL NEWS]',r.status);}),5*60000); officialNewsTimer.unref();
  // Bounded, redacted per-market diagnostics. Never log prices, credentials or account IDs.
  const marketDiagTimer=setInterval(()=>{
    const sensor=demoIngest.report(), brain=demoAutoBrain.report(), trade=demoTradeIntents.report();
    for(const symbol of ['XAUUSD','BTCUSD']){
      const m=sensor.markets[symbol], d=brain.scheduleDiagnostics[symbol];
      console.log('[NABD MARKET DIAG]',symbol,JSON.stringify({
        feed:m?.status||'NO_VALID_SNAPSHOT_SINCE_START',quoteAgeSeconds:m?.quoteAgeSeconds??null,
        input:sensor.marketInput[symbol]||null,lastInvalid:sensor.lastInvalidSnapshot?.symbol===symbol?sensor.lastInvalidSnapshot.reasons:[],
        lastDeepAt:d?.lastDeepAt||null,lastDeepReason:d?.lastDeepReason||null,depth:d?.depth||null,lastDeepDepth:d?.lastDeepDepth||null,analysisStage:brain.lastBySymbol[symbol]?.stage||null,analysisReason:brain.lastBySymbol[symbol]?.reason||null,
        schedulingEvidence:d?.lastSchedulingEvidence||null,decision:brain.lastBySymbol[symbol]?.stance||null,
        executorReason:trade.lastBySymbol[symbol]?.reason||null
      }));
    }
  },300000);marketDiagTimer.unref();
  const auditTimer=setInterval(()=>void flushOperational(),30*1000);auditTimer.unref();
  const timer=setInterval(()=>void feed.poll().then(r=>{if(r.status==='ERROR')console.log('[NABD REFERENCE FEED] ERROR',r.code);}),60000);
  timer.unref();
  const goldTimer=setInterval(()=>void goldSpot.poll().then(r=>{if(r.status==='ERROR')console.log('[NABD GOLD REFERENCE] ERROR',r.code);}),60000);goldTimer.unref();
  void economicCalendar.poll().then(r=>console.log('[NABD CALENDAR PREVIEW]',r.status));
  void blsIndicators.poll().then(r=>console.log('[NABD BLS SERIES]',r.status,r.code||''));
  void fredHistorical.poll().then(r=>console.log('[NABD FRED HISTORICAL REFERENCE]',r.status,r.code||''));
  liveCalendarStream.connect();
  console.log('[NABD LIVE CALENDAR]',liveCalendarStream.report().status);
  // The delayed feed remains research-only and is never promoted into live news execution.
  void delayedCalendar.poll().then(r=>console.log('[NABD DELAYED CONSENSUS]',r.status,JSON.stringify(r.evidence)));
  const delayedTimer=setInterval(()=>void delayedCalendar.poll(),60*60000);delayedTimer.unref();
  const blsTimer=setInterval(()=>void blsIndicators.poll(),4*3600*1000);blsTimer.unref();
  const fredTimer=setInterval(()=>void fredHistorical.poll(),6*3600*1000);fredTimer.unref();
  // Conservative default: 8 polls/day (~240/month), not 288/day. Higher frequency requires explicit plan-aware configuration.
  const calendarMinutes=Number(process.env.NABD_TEST_CALENDAR_POLL_MINUTES||180);
  const safeCalendarMinutes=Number.isFinite(calendarMinutes)?Math.max(5,Math.min(1440,Math.floor(calendarMinutes))):180;
  const calendarTimer=setInterval(()=>void economicCalendar.poll(),safeCalendarMinutes*60000);calendarTimer.unref();
  const goldCandlesTimer=setInterval(()=>void sources.check(),15*60000);goldCandlesTimer.unref();
});

