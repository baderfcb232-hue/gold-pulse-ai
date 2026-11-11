// NABD Agentic AI isolated connectivity service.
// No imports from production. No trading, database, Telegram, or signal routes.
import http from 'node:http';
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
import {createFredHistoricalMonitor} from './fred-historical-fallback.mjs';
const feed=createShadowFeedRunner();
const goldSpot=createPublicGoldObserver();
const sources=createResearchSources({goldKey:process.env.NABD_TEST_GOLD_TWELVEDATA_KEY}); // Calendar polled only by economicCalendar to avoid duplicate paid-provider calls.
const hybrid=new HybridScheduler();
let shadowSmoke={status:'NOT_RUN',syntheticDataOnly:true,brokerTradingEnabled:false};
const researchBrain=createResearchBrain({key:process.env.OPENAI_API_KEY,model:process.env.NABD_RESEARCH_MODEL||'gpt-4.1-mini'});
const demoIngest=createDemoIngest({secret:process.env.NABD_TEST_DEMO_SENSOR_HMAC_SECRET||''});
const officialNews=createOfficialNewsMonitor();
let connectedJournal=null;
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
  const pathname=new URL(req.url,'http://localhost').pathname;
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
    send(verdict.status==='OBSERVED'?202:403,verdict);return;
  }
  if(req.method!=='GET'||!['/healthz','/hybrid/status','/feed/status','/gold/status','/research/status','/news/status','/news/research','/calendar/status','/official-data/status','/fred-historical/status','/journal/status','/delayed-consensus/status','/live-news/status','/live-calendar/status','/brain/status','/demo-sensor/status','/shadow-smoke/status','/integration/status'].includes(pathname)){
    res.writeHead(404,{'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end(JSON.stringify({error:'not_found'}));return;
  }
  res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(JSON.stringify(pathname==='/integration/status' ? buildExperimentReadiness({bls:blsIndicators.report(),fred:fredHistorical.report(),brain:researchBrain.report(),demo:{...demoSensorReadiness(),brokerConnected:Object.values(demoIngest.report().markets).some(m=>m.status==='SENSOR_OBSERVED')},journal:journalState,smoke:shadowSmoke,fxStreetAuthorized:false,officialReleaseVerified:false}) : pathname==='/shadow-smoke/status' ? shadowSmoke : pathname==='/brain/status' ? researchBrain.report() : pathname==='/demo-sensor/status' ? {...demoSensorReadiness(),ingestion:demoIngest.report()} : pathname==='/live-calendar/status' ? liveCalendarStream.report() : pathname==='/live-news/status' ? liveNewsSystemStatus({journalConnected:!!connectedJournal,calendarKeyConfigured:!!process.env.NABD_TEST_TRADING_ECONOMICS_STREAM_KEY&&!!process.env.NABD_TEST_TRADING_ECONOMICS_STREAM_SECRET,realtimeFeedVerified:false,officialReleaseTimestampVerified:false,preReleaseForecastCaptured:false,brokerFeedVerified:false}) : pathname==='/delayed-consensus/status' ? delayedCalendar.report() : pathname==='/journal/status' ? journalState : pathname==='/fred-historical/status' ? fredHistorical.report() : pathname==='/official-data/status' ? blsIndicators.report() : pathname==='/calendar/status' ? economicCalendar.report() : pathname==='/news/research' ? newsResearchReadiness({calendarConfigured:!!process.env.NABD_TEST_TRADING_ECONOMICS_KEY,verifiedReleaseArchive:false,goldBrokerCandles:false,btcBrokerCandles:false,openaiConnected:state==='CONNECTED'}) : pathname==='/news/status' ? officialNews.report() : pathname==='/gold/status' ? goldSpot.report() : pathname==='/research/status' ? sources.report() : pathname==='/feed/status' ? feed.report() : pathname==='/hybrid/status' ? hybrid.report() : {service:'nabd-agentic-ai-test',experimental:true,reference_only:true,trading_enabled:false,model_connection:state,last_checked:checkTime}));
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
  });
  void feed.poll().then(r=>console.log('[NABD REFERENCE FEED]',r.status,r.code||r.observation?.trigger));
  void goldSpot.poll().then(r=>console.log('[NABD GOLD REFERENCE]',r.status,r.code||''));
  void sources.check().then(r=>console.log('[NABD RESEARCH SOURCES]',JSON.stringify(r)));
  void officialNews.poll().then(r=>console.log('[NABD OFFICIAL NEWS]',r.status,JSON.stringify(r.providers)));
  const officialNewsTimer=setInterval(()=>void officialNews.poll().then(r=>{if(r.status!=='OK')console.log('[NABD OFFICIAL NEWS]',r.status);}),5*60000); officialNewsTimer.unref();
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
