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
const feed=createShadowFeedRunner();
const goldSpot=createPublicGoldObserver();
const sources=createResearchSources({goldKey:process.env.NABD_TEST_GOLD_TWELVEDATA_KEY}); // Calendar polled only by economicCalendar to avoid duplicate paid-provider calls.
const hybrid=new HybridScheduler();
const officialNews=createOfficialNewsMonitor();
let connectedJournal=null;
const economicCalendar=createEconomicCalendarMonitor({key:process.env.NABD_TEST_TRADING_ECONOMICS_KEY,journalProvider:()=>connectedJournal});
const blsIndicators=createBlsOfficialMonitor();
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
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(req.method!=='GET'||!['/healthz','/hybrid/status','/feed/status','/gold/status','/research/status','/news/status','/news/research','/calendar/status','/official-data/status','/journal/status','/delayed-consensus/status','/live-news/status','/live-calendar/status'].includes(pathname)){
    res.writeHead(404,{'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end(JSON.stringify({error:'not_found'}));return;
  }
  res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(JSON.stringify(pathname==='/live-calendar/status' ? liveCalendarStream.report() : pathname==='/live-news/status' ? liveNewsSystemStatus({journalConnected:!!connectedJournal,calendarKeyConfigured:!!process.env.NABD_TEST_TRADING_ECONOMICS_STREAM_KEY&&!!process.env.NABD_TEST_TRADING_ECONOMICS_STREAM_SECRET,realtimeFeedVerified:false,officialReleaseTimestampVerified:false,preReleaseForecastCaptured:false,brokerFeedVerified:false}) : pathname==='/delayed-consensus/status' ? delayedCalendar.report() : pathname==='/journal/status' ? journalState : pathname==='/official-data/status' ? blsIndicators.report() : pathname==='/calendar/status' ? economicCalendar.report() : pathname==='/news/research' ? newsResearchReadiness({calendarConfigured:!!process.env.NABD_TEST_TRADING_ECONOMICS_KEY,verifiedReleaseArchive:false,goldBrokerCandles:false,btcBrokerCandles:false,openaiConnected:state==='CONNECTED'}) : pathname==='/news/status' ? officialNews.report() : pathname==='/gold/status' ? goldSpot.report() : pathname==='/research/status' ? sources.report() : pathname==='/feed/status' ? feed.report() : pathname==='/hybrid/status' ? hybrid.report() : {service:'nabd-agentic-ai-test',experimental:true,reference_only:true,trading_enabled:false,model_connection:state,last_checked:checkTime}));
});
server.listen(port,'0.0.0.0',()=>{console.log('[NABD AGENTIC TEST] ready on port',port);void verify();
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
  liveCalendarStream.connect();
  console.log('[NABD LIVE CALENDAR]',liveCalendarStream.report().status);
  // The delayed feed remains research-only and is never promoted into live news execution.
  void delayedCalendar.poll().then(r=>console.log('[NABD DELAYED CONSENSUS]',r.status,JSON.stringify(r.evidence)));
  const delayedTimer=setInterval(()=>void delayedCalendar.poll(),60*60000);delayedTimer.unref();
  const blsTimer=setInterval(()=>void blsIndicators.poll(),4*3600*1000);blsTimer.unref();
  // Conservative default: 8 polls/day (~240/month), not 288/day. Higher frequency requires explicit plan-aware configuration.
  const calendarMinutes=Number(process.env.NABD_TEST_CALENDAR_POLL_MINUTES||180);
  const safeCalendarMinutes=Number.isFinite(calendarMinutes)?Math.max(5,Math.min(1440,Math.floor(calendarMinutes))):180;
  const calendarTimer=setInterval(()=>void economicCalendar.poll(),safeCalendarMinutes*60000);calendarTimer.unref();
  const goldCandlesTimer=setInterval(()=>void sources.check(),15*60000);goldCandlesTimer.unref();
});
