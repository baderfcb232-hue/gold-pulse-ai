// Experimental Trading Economics economic calendar WebSocket observer.
// Credentials are only read from Render environment and never emitted to API or logs.
// No order, MT5, Telegram, recommendation, or autonomous trading permission.
import {parseComparable} from './news-surprise.mjs';
const SOURCE='TRADING_ECONOMICS_STREAM';
const safeSeconds=()=>Math.floor(Date.now()/1000);
const valid=x=>Number.isSafeInteger(x)&&x>0;
const clean=x=>{const v=typeof x==='string'?x.trim():typeof x==='number'?String(x):'';return /^(null|none|n\/a|na|undefined)$/i.test(v)?'':v;};
// Provider streaming examples sometimes include the literal key 'forecast ' (trailing whitespace).
// Normalize keys, but never substitute proprietary TEForecast for analyst consensus Forecast.
function normalizedFields(message){const result={};for(const [k,v] of Object.entries(message)){const name=k.trim().toLowerCase();if(!(name in result)||result[name]==null)result[name]=v;}return result;}
export function parseStreamCalendarMessage(raw,receivedAt=safeSeconds()){
 let m;try{m=typeof raw==='string'?JSON.parse(raw):raw;}catch{return {accepted:false,reason:'INVALID_JSON'};}
 if(!m||Array.isArray(m)||typeof m!=='object')return {accepted:false,reason:'INVALID_SCHEMA'};
 if(String(m.topic||'').toLowerCase()!=='calendar')return {accepted:false,reason:'NOT_CALENDAR'};
 const fields=normalizedFields(m);
 const country=String(fields.country||'').trim().toLowerCase();
 if(!['united states','usa','us'].includes(country))return {accepted:false,reason:'NOT_US_EVENT'};
 if(Number(fields.importance)!==3)return {accepted:false,reason:'NOT_HIGH_IMPACT'};
 const id=String(fields.calendarid??'').trim();
 if(!/^[0-9]{1,30}$/.test(id))return {accepted:false,reason:'INVALID_EVENT_ID'};
 const title=String(fields.event||'').trim().slice(0,160);
 if(!title)return {accepted:false,reason:'MISSING_TITLE'};
 const utc=String(fields.date??'');
 // Provider documentation describes scheduled release in UTC, no independent actual-publish timestamp.
 const eventAt=Date.parse(utc.endsWith('Z')||/[+-][0-9]{2}:[0-9]{2}$/.test(utc)?utc:utc+'Z')/1000;
 if(!valid(eventAt)||!valid(receivedAt)||eventAt>receivedAt+86400*8||eventAt<receivedAt-86400*14)
  return {accepted:false,reason:'INVALID_SCHEDULE'};
 const actualRaw=clean(fields.actual),forecastRaw=clean(fields.forecast),previousRaw=clean(fields.previous);
 const a=parseComparable(actualRaw),f=parseComparable(forecastRaw),p=parseComparable(previousRaw);
 const comparable=!!a&&!!f&&a.unit===f.unit;
 return {accepted:true,event:{source:SOURCE,id,title,eventAt,receivedAt,actualRaw:actualRaw||null,
  forecastRaw:forecastRaw||null,previousRaw:previousRaw||null,
  hasActual:!!a,hasForecast:!!f,hasPrevious:!!p,
  comparable,allThreeComparable:comparable&&!!p&&a.unit===p.unit,
  comparison:comparable?{difference:a.value-f.value,unit:a.unit,
   direction:a.value>f.value?'ABOVE_FORECAST':a.value<f.value?'BELOW_FORECAST':'IN_LINE'}:null,
  secondsAfterScheduled:receivedAt-eventAt,
  observationTimeVerified:true,
  officialPublicationTimestampVerified:false,
  providerLatencyIndependentlyVerified:false,
  forecastBeforeReleaseVerified:false,
  eligibleForExecution:false}};
}
export function createLiveCalendarStream({
 key=process.env.NABD_TEST_TRADING_ECONOMICS_STREAM_KEY,
 secret=process.env.NABD_TEST_TRADING_ECONOMICS_STREAM_SECRET,
 wsFactory=(url)=>new WebSocket(url),
 clock=safeSeconds,
 journalProvider=()=>null
}={}){
 let ws=null,status=key&&secret?'READY_TO_CONNECT':'NOT_CONFIGURED',
  lastConnected=null,lastMessageAt=null,lastError=null,received=0,accepted=0,complete=0;
 const errors=[],recent=[],forecastObserved=new Map(),seenActual=new Set();
 let busy=false,reconnectTimer=null,stopped=false;
 function safeError(x){return String(x||'UNKNOWN').slice(0,80).replace(/(key|secret|token|password)=[^\s&]+/gi,'$1=[REDACTED]');}
 const pushError=x=>{const y=safeError(x);errors.push(y);if(errors.length>6)errors.shift();lastError=y;};
 async function record(event){
  const journal=journalProvider(),id=event.id+':'+event.eventAt;
  const before=event.receivedAt<event.eventAt && event.hasForecast && !event.hasActual;
  if(before&&!forecastObserved.has(id)){
   forecastObserved.set(id,{raw:event.forecastRaw,observedAt:event.receivedAt});
   if(journal)await journal.saveForecast({provider:SOURCE,id:event.id,scheduledAt:event.eventAt,
     observedAt:event.receivedAt,raw:event.forecastRaw});
  }
  if(event.hasActual&&event.receivedAt>=event.eventAt&&!seenActual.has(id)){
   if(journal)await journal.saveActual({provider:SOURCE,id:event.id,scheduledAt:event.eventAt,
     observedAt:event.receivedAt,raw:event.actualRaw});
   seenActual.add(id);
  }
  let saved=journal?await journal.firstForecast({provider:SOURCE,id:event.id,scheduledAt:event.eventAt}):null;
  saved ||=forecastObserved.get(id)||null;
  const reference=parseComparable(saved?.raw??'');
  const actual=parseComparable(event.actualRaw??'');
  const pointInTime=!!saved&&saved.observedAt<event.eventAt&&!!actual&&!!reference&&actual.unit===reference.unit;
  recent.unshift({...event,preReleaseForecastAvailable:pointInTime,
    forecastAsObservedBeforeRelease:pointInTime?saved.raw:null,
    officialPublicationTimestampVerified:false,
    providerLatencyIndependentlyVerified:false,
    eligibleForExecution:false});
  if(recent.length>15)recent.length=15;
  // Bound memory, DB is source of truth across restarts.
  if(forecastObserved.size>300)forecastObserved.delete(forecastObserved.keys().next().value);
  if(seenActual.size>300)seenActual.delete(seenActual.values().next().value);
 }
 function scheduleReconnect(){
  if(stopped||reconnectTimer||!key||!secret)return;
  reconnectTimer=setTimeout(()=>{reconnectTimer=null;connect();},30000);
  reconnectTimer.unref?.();
 }
 function connect(){
  if(stopped||busy||ws)return;
  if(!key||!secret){status='NOT_CONFIGURED';return;}
  busy=true;status='CONNECTING';lastError=null;
  let socket;
  try{
   // According to TE streaming docs, authorized client is key:secret.
   const uri=new URL('wss://stream.tradingeconomics.com/');
   uri.searchParams.set('client',key+':'+secret);
   socket=wsFactory(uri.toString());
  }catch{busy=false;status='CONNECT_ERROR';pushError('WEBSOCKET_INIT_FAILED');scheduleReconnect();return;}
  ws=socket;
  socket.addEventListener('open',()=>{
   if(ws!==socket)return;
   busy=false;status='SUBSCRIBED_UNVERIFIED';lastConnected=new Date(clock()*1000).toISOString();
   try{socket.send(JSON.stringify({topic:'subscribe',to:'calendar'}));}
   catch{status='SUBSCRIBE_FAILED';pushError('SUBSCRIPTION_SEND_FAILED');socket.close();}
  });
  socket.addEventListener('message',e=>{
   if(ws!==socket)return;
   received++;
   const input=typeof e.data==='string'?e.data:null;
   if(!input||input.length>200_000)return;
   const r=parseStreamCalendarMessage(input,clock());
   if(!r.accepted)return;
   accepted++;if(r.event.allThreeComparable)complete++;
   lastMessageAt=new Date(clock()*1000).toISOString();
   status='OBSERVING_STREAM_MESSAGES';
   void record(r.event).catch(()=>{pushError('JOURNAL_WRITE_FAILED');status='JOURNAL_ERROR';});
  });
  socket.addEventListener('error',()=>{status='CONNECTION_ERROR';pushError('SOCKET_ERROR');});
  socket.addEventListener('close',()=>{if(ws===socket)ws=null;busy=false;
   if(!stopped){status='DISCONNECTED';scheduleReconnect();}
  });
 }
 function stop(){stopped=true;if(reconnectTimer)clearTimeout(reconnectTimer);
  reconnectTimer=null;try{ws?.close();}catch{}ws=null;status='STOPPED';}
 function report(){const age=lastMessageAt?clock()-Math.floor(Date.parse(lastMessageAt)/1000):null;
  return {source:SOURCE,status,configured:!!key&&!!secret,lastConnected,lastMessageAt,
   messageAgeSeconds:age,receivedMessages:received,acceptedEvents:accepted,
   allThreeComparableEvents:complete,latestEvents:recent,
   errors,referenceOnly:true,officialPublicationTimestampVerified:false,
   independentlyMeasuredLatency:false,preReleaseObservationMayBeStored:true,
   realtimeNewsTradingEnabled:false,tradeExecutionEnabled:false};}
 return {connect,stop,report};
}
