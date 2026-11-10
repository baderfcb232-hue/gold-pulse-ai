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
const feed=createShadowFeedRunner();
const goldSpot=createPublicGoldObserver();
const sources=createResearchSources({goldKey:process.env.NABD_TEST_GOLD_TWELVEDATA_KEY,newsKey:process.env.NABD_TEST_TRADING_ECONOMICS_KEY});
const hybrid=new HybridScheduler();
const officialNews=createOfficialNewsMonitor();
const economicCalendar=createEconomicCalendarMonitor({key:process.env.NABD_TEST_TRADING_ECONOMICS_KEY});
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
  if(req.method!=='GET'||!['/healthz','/hybrid/status','/feed/status','/gold/status','/research/status','/news/status','/news/research','/calendar/status'].includes(pathname)){
    res.writeHead(404,{'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end(JSON.stringify({error:'not_found'}));return;
  }
  res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(JSON.stringify(pathname==='/calendar/status' ? economicCalendar.report() : pathname==='/news/research' ? newsResearchReadiness({calendarConfigured:!!process.env.NABD_TEST_TRADING_ECONOMICS_KEY,verifiedReleaseArchive:false,goldBrokerCandles:false,btcBrokerCandles:false,openaiConnected:state==='CONNECTED'}) : pathname==='/news/status' ? officialNews.report() : pathname==='/gold/status' ? goldSpot.report() : pathname==='/research/status' ? sources.report() : pathname==='/feed/status' ? feed.report() : pathname==='/hybrid/status' ? hybrid.report() : {service:'nabd-agentic-ai-test',experimental:true,reference_only:true,trading_enabled:false,model_connection:state,last_checked:checkTime}));
});
server.listen(port,'0.0.0.0',()=>{console.log('[NABD AGENTIC TEST] ready on port',port);void verify();
  void feed.poll().then(r=>console.log('[NABD REFERENCE FEED]',r.status,r.code||r.observation?.trigger));
  void goldSpot.poll().then(r=>console.log('[NABD GOLD REFERENCE]',r.status,r.code||''));
  void sources.check().then(r=>console.log('[NABD RESEARCH SOURCES]',JSON.stringify(r)));
  void officialNews.poll().then(r=>console.log('[NABD OFFICIAL NEWS]',r.status,JSON.stringify(r.providers)));
  const officialNewsTimer=setInterval(()=>void officialNews.poll().then(r=>{if(r.status!=='OK')console.log('[NABD OFFICIAL NEWS]',r.status);}),5*60000); officialNewsTimer.unref();
  const timer=setInterval(()=>void feed.poll().then(r=>{if(r.status==='ERROR')console.log('[NABD REFERENCE FEED] ERROR',r.code);}),60000);
  timer.unref();
  const goldTimer=setInterval(()=>void goldSpot.poll().then(r=>{if(r.status==='ERROR')console.log('[NABD GOLD REFERENCE] ERROR',r.code);}),60000);goldTimer.unref();
  void economicCalendar.poll().then(r=>console.log('[NABD CALENDAR PREVIEW]',r.status));
  const calendarTimer=setInterval(()=>{void sources.check();void economicCalendar.poll();},15*60000);calendarTimer.unref();
});
