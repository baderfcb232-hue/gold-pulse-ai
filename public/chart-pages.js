/* NABD Phase 7: dedicated read-only MT5 charts. Broker candles are authoritative.
   TradingView is an explicit external comparison, NEVER an MT5 fallback. */
import {drawBrokerCandles} from './broker-chart.js';
import {summarizeAnalysisMarket} from './analysis-ribbon.js?v=phase6-1';

export const CHART_SYMBOLS=Object.freeze({XAUUSD:'gold',BTCUSD:'bitcoin'});
export const BROKER_FRAMES=Object.freeze(['M5','M15','H1','H4']);
export function brokerChartPath(symbol,tf){
 if(!Object.hasOwn(CHART_SYMBOLS,symbol)||!BROKER_FRAMES.includes(tf))throw new RangeError('Unsupported chart');
 return '/api/market/broker-candles?symbol='+encodeURIComponent(symbol)+'&tf='+encodeURIComponent(tf);
}
export function closedBrokerCandles(payload,symbol,tf){
 if(!payload||payload.symbol!==symbol||payload.tf!==tf||payload.candle_kind!=='BROKER_OHLC'||!Array.isArray(payload.candles))return null;
 const candles=payload.candles.filter(c=>Number.isFinite(c.time)&&c.time>0&&
  [c.open,c.high,c.low,c.close].every(Number.isFinite)&&
  c.high>=Math.max(c.open,c.close,c.low)&&c.low<=Math.min(c.open,c.close,c.high)&&
  Math.min(c.open,c.high,c.low,c.close)>0);
 if(!candles.length)return null;
 return {...payload,candles:candles.slice(-320)};
}
export function brokerChartFresh(payload,now=Date.now()/1000,ttl=20){
 if(!payload||payload.connection!=='LIVE'||!Number.isFinite(payload.quote?.time)||!Number.isFinite(payload.received_at))return false;
 const maxAge=Number.isFinite(ttl)&&ttl>0?ttl:20;
 return payload.quote.time>0&&payload.quote.time<=now+5&&now-payload.quote.time<=maxAge&&
  payload.received_at>0&&payload.received_at<=now+5&&now-payload.received_at<=maxAge;
}
export function rsi14(rows){
 if(!Array.isArray(rows)||rows.length<15)return null;
 const closes=rows.map(c=>c.close).filter(Number.isFinite);
 if(closes.length<15)return null;
 let gains=0,losses=0;
 for(let i=1;i<=14;i++){const delta=closes[i]-closes[i-1];gains+=Math.max(0,delta);losses+=Math.max(0,-delta);}
 gains/=14;losses/=14;
 for(let i=15;i<closes.length;i++){const delta=closes[i]-closes[i-1];gains=(gains*13+Math.max(delta,0))/14;losses=(losses*13+Math.max(-delta,0))/14;}
 if(!gains&&!losses)return 50;
 return losses===0?100:100-100/(1+gains/losses);
}
export function atr14(rows){
 if(!Array.isArray(rows)||rows.length<15)return null;
 const tr=[];
 for(let i=1;i<rows.length;i++){
  const prev=rows[i-1],cur=rows[i];
  if(![prev.close,cur.high,cur.low].every(Number.isFinite))return null;
  tr.push(Math.max(cur.high-cur.low,Math.abs(cur.high-prev.close),Math.abs(cur.low-prev.close)));
 }
 let atr=tr.slice(0,14).reduce((a,b)=>a+b,0)/14;
 for(const t of tr.slice(14))atr=(atr*13+t)/14;
 return Number.isFinite(atr)?atr:null;
}
const copy={
 ar:{
  skip:'تجاوز إلى الشارت',gold:'الذهب',bitcoin:'بيتكوين',dashboard:'لوحة نبض',
  eyebrow:'NABD · شارتات السوق',description:'شموع وسيط مغلقة، مع الفريمات والمؤشرات ومصدر البيانات.',
  mt5:'شموع MT5',reference:'شارت مرجعي',loading:'جاري جلب شموع MT5…',closed:'شموع وسيط مغلقة · EMA 8 / 21 / 200',
  latest:'آخر إغلاق',rsi:'RSI 14',atr:'ATR 14',alignment:'توافق المؤشرات',analysis:'حالة التحليل',
  transparency:'المصدر والشفافية',transparencyText:'شموع MT5 من الوسيط. شارت TradingView للمقارنة فقط ولا يغذي توصيات أو أوامر MT5.',
  warning:'توافق المؤشرات ليس احتمال نجاح أو إثبات تنفيذ صفقة.',online:'MT5 متصل',stale:'بيانات MT5 قديمة',unavailable:'شموع MT5 غير متاحة',
  noCandles:'لم تصل شموع MT5 لهذا الفريم. لا نستخدم شموع منصة أخرى بدلها.',
  staleCandles:'الشموع محفوظة، لكن السعر متأخر؛ لا تعتمد عليها كإشارة جديدة.',
  source:'المصدر',last:'آخر شمعة',unknown:'بانتظار المصدر',referenceNote:'مرجع TradingView الخارجي فقط · سعره قد يختلف عن وسيط MT5',
  currency:'دولار',referenceStatus:'مقارنة خارجية',frames:'الفريمات',unconfirmed:'لم تتوفر قراءة تحليل حديثة'
 },
 en:{
  skip:'Skip to chart',gold:'Gold',bitcoin:'Bitcoin',dashboard:'NABD Dashboard',
  eyebrow:'NABD · MARKET CHARTS',description:'Closed broker candles, timeframes, indicators and clear source provenance.',
  mt5:'MT5 candles',reference:'Reference chart',loading:'Loading MT5 broker candles…',closed:'Closed broker candles · EMA 8 / 21 / 200',
  latest:'Last close',rsi:'RSI 14',atr:'ATR 14',alignment:'Indicator alignment',analysis:'Analysis status',
  transparency:'Source and transparency',transparencyText:'Candles come from the MT5 broker. TradingView is for external comparison and never drives MT5 signals or orders.',
  warning:'Indicator alignment is not a win probability or proof of a filled trade.',online:'MT5 connected',stale:'MT5 data delayed',unavailable:'MT5 candles unavailable',
  noCandles:'No MT5 candles for this timeframe. Other exchange candles are not substituted.',
  staleCandles:'Previous candles are retained, but prices are stale; this is not a new signal.',
  source:'Source',last:'Last candle',unknown:'Waiting for source',referenceNote:'External TradingView comparison only · prices may differ from the MT5 broker',
  currency:'USD',referenceStatus:'External comparison',frames:'Timeframes',unconfirmed:'No fresh analysis available'
 }
};
function initChartPage(){
 const symbol=document.body.dataset.chartSymbol;
 if(!Object.hasOwn(CHART_SYMBOLS,symbol))return;
 const $=id=>document.getElementById(id);
 const tfButtons=[...document.querySelectorAll('[data-chart-tf]')];
 const modeButtons=[...document.querySelectorAll('[data-chart-mode]')];
 const title=$('chart-title'),frame=$('chart-reference-frame'),canvas=$('chart-canvas'),overlay=$('chart-overlay'),overlayText=$('chart-overlay-text');
 let tf='M15',mode='mt5',request=0,lastBroker=null,lastMarket=null,lastUpdated=0,previousReferenceKey='';
 const lang=()=>document.documentElement.lang==='en'?'en':'ar';
 const t=()=>copy[lang()];
 const text=(id,value)=>{const node=$(id);if(node)node.textContent=value;};
 const num=(value,digits=2)=>Number.isFinite(value)?new Intl.NumberFormat('en-US',{maximumFractionDigits:digits,minimumFractionDigits:digits}).format(value):'—';
 const date=value=>Number.isFinite(value)&&value>0?new Date(value*1000).toLocaleString(lang()==='ar'?'ar':'en-US',{timeZone:'Asia/Gaza',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
 const selectedMarket=()=>lastMarket?.markets?.[symbol]||null;
 function applyText(){
  const labels=t();
  document.title='NABD | '+labels[CHART_SYMBOLS[symbol]]+' · '+symbol;
  title.textContent=labels[CHART_SYMBOLS[symbol]]+' / '+labels.currency+' · '+symbol;
  document.querySelectorAll('[data-i18n]').forEach(node=>{
   const key=node.dataset.i18n;
   if(Object.hasOwn(labels,key))node.textContent=labels[key];
  });
  $('chart-brand-image').src=lang()==='ar'?'/nabd-logo.svg':'/nabd-logo-en.svg';
  const choice=$('chart-language');choice.textContent=lang()==='ar'?'EN':'AR';
  choice.setAttribute('aria-label',lang()==='ar'?'Switch to English':'التحويل إلى العربية');
  document.querySelectorAll('[data-chart-nav]').forEach(a=>a.setAttribute('aria-current',a.dataset.chartNav===symbol?'page':'false'));
  if(lastBroker||lastMarket)render();
 }
 function applyTheme(){
  let theme='light';
  try{theme=localStorage.getItem('nabd:dashboard:theme')||'light';}catch{}
  if(theme==='system')theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
  const dark=theme==='dark';
  document.documentElement.setAttribute('data-nabd-theme',dark?'dark':'light');
  $('chart-theme').textContent=dark?'☀':'☾';
  $('chart-theme').setAttribute('aria-label',dark?(lang()==='en'?'Switch to light mode':'تفعيل الوضع الفاتح'):(lang()==='en'?'Switch to dark mode':'تفعيل الوضع الداكن'));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',dark?'#09141d':'#f4f8f9');
 }
 function setOverlay(message){overlay.hidden=!message;overlayText.textContent=message||'';}
 function render(){
  const labels=t(),market=selectedMarket(),now=Date.now()/1000;
  const chart=lastBroker,ttl=Number.isFinite(market?.quoteTtl)?market.quoteTtl:20;
  const fresh=brokerChartFresh(chart,now,ttl);
  $('chart-connection').dataset.connection=fresh?'live':chart?'stale':'unknown';
  text('chart-connection',mode==='reference'?labels.referenceStatus:fresh?labels.online:chart?labels.stale:labels.unavailable);
  text('chart-source',mode==='reference'?'TradingView · '+(symbol==='BTCUSD'?'COINBASE:BTCUSD':'OANDA:XAUUSD'):chart?.source||market?.source||'—');
  text('chart-quote-age',mode==='reference'?labels.referenceNote:chart?.quote?.time?labels.source+' · '+date(chart.quote.time):labels.unknown);
  if(mode==='reference'){
   $('chart-candle-note').textContent=labels.referenceNote;
   text('chart-last-candle','');
  }else{
   $('chart-candle-note').textContent=labels.closed;
   text('chart-last-candle',chart?.candles?.length?labels.last+': '+date(chart.candles.at(-1).time):'—');
   if(chart?.candles?.length){
    // Historical closed candles remain visible but stale Bid/Ask must not imply live quotes.
    const input=fresh?chart:{...chart,quote:{bid:null,ask:null}};
    drawBrokerCandles(canvas,input,[]);
    setOverlay(fresh?'':labels.staleCandles);
   }else setOverlay(labels.noCandles);
  }
  const rows=chart?.candles||[];
  text('chart-close',rows.length?num(rows.at(-1).close,chart?.digits??2):'—');
  text('chart-rsi',rows.length?num(rsi14(rows),1):'—');
  text('chart-atr',rows.length?num(atr14(rows),chart?.digits??2):'—');
  // The current summary is generated only from existing /api/market.
  const analysis=lastMarket?makeSummary(lastMarket,now):null;
  text('chart-alignment',analysis?.fresh?analysis.score:'—');
  text('chart-analysis-status',analysis?.status||labels.unconfirmed);
  text('chart-frames',analysis?.frames||'—');
  text('chart-reason',analysis?.reason||labels.unconfirmed);
 }
 function makeSummary(payload,now){
  // Never mix a live Coinbase/Gold-API analysis with an old MT5 chart. The
  // site's public market endpoint can legitimately fall back to reference
  // sources when broker data is stale, while this page stays broker-only.
  const m=payload?.markets?.[symbol];
  if(!m||m.candle_kind!=='BROKER_OHLC'||!lastBroker||
    !brokerChartFresh(lastBroker,now,m.quoteTtl)||
    (m.source_id&&lastBroker.source_id&&m.source_id!==lastBroker.source_id))return null;
  return summarizeAnalysisMarket(m,{locale:lang(),nowSeconds:now,serverTime:payload?.serverTime});
 }
 async function getJson(path){
  const response=await fetch(path,{cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json'}});
  if(!response.ok)throw new Error('Unavailable '+response.status);
  return response.json();
 }
 async function refresh(){
  if(document.hidden)return;
  const token=++request,requestedTf=tf;
  const [marketResult,brokerResult]=await Promise.allSettled([
   getJson('/api/market'),
   getJson(brokerChartPath(symbol,requestedTf))
  ]);
  if(token!==request||requestedTf!==tf)return;
  if(marketResult.status==='fulfilled'&&marketResult.value?.markets)lastMarket=marketResult.value;
  if(brokerResult.status==='fulfilled'){
   const payload=closedBrokerCandles(brokerResult.value,symbol,requestedTf);
   if(payload){lastBroker=payload;lastUpdated=Date.now();}
   else lastBroker=null;
  }else if(!lastBroker||lastBroker.tf!==tf){lastBroker=null;}
  render();
 }
 function referenceConfig(){
  const code=symbol==='BTCUSD'?'COINBASE:BTCUSD':'OANDA:XAUUSD';
  const interval={M5:'5',M15:'15',H1:'60',H4:'240'}[tf];
  return {autosize:true,symbol:code,interval,timezone:'Etc/UTC',
    theme:document.documentElement.getAttribute('data-nabd-theme')==='dark'?'dark':'light',
    locale:lang(),allow_symbol_change:false,calendar:false,save_image:false,
    studies:['MASimple@tv-basicstudies','RSI@tv-basicstudies'],support_host:'https://www.tradingview.com',
    width:'100%',height:'100%'};
 }
 function loadReference(){
  const config=referenceConfig();
  const key=JSON.stringify(config);
  if(previousReferenceKey===key)return;
  previousReferenceKey=key;
  frame.src='https://www.tradingview-widget.com/embed-widget/advanced-chart/?locale='+lang()+'#'+encodeURIComponent(key);
 }
 function activateMode(value){
  mode=value==='reference'?'reference':'mt5';
  for(const b of modeButtons)b.setAttribute('aria-pressed',String(b.dataset.chartMode===mode));
  $('chart-mt5-wrap').hidden=mode!=='mt5';
  $('chart-reference-wrap').hidden=mode!=='reference';
  if(mode==='reference')loadReference();
  render();
 }
 for(const button of tfButtons)button.addEventListener('click',()=>{
  const value=button.dataset.chartTf;
  if(!BROKER_FRAMES.includes(value)||tf===value)return;
  tf=value;lastBroker=null;lastUpdated=0;
  for(const b of tfButtons)b.setAttribute('aria-pressed',String(b.dataset.chartTf===tf));
  setOverlay(t().loading);
  if(mode==='reference')loadReference();
  refresh();
 });
 for(const button of modeButtons)button.addEventListener('click',()=>activateMode(button.dataset.chartMode));
 $('chart-language').addEventListener('click',()=>{
  const next=lang()==='ar'?'en':'ar';
  try{localStorage.setItem('nabd:dashboard:language',next);localStorage.setItem('nabd-marketing-language',next);}catch{}
  document.documentElement.lang=next;document.documentElement.dir=next==='en'?'ltr':'rtl';
  applyText();applyTheme();if(mode==='reference')loadReference();
 });
 $('chart-theme').addEventListener('click',()=>{
  const next=document.documentElement.getAttribute('data-nabd-theme')==='dark'?'light':'dark';
  try{localStorage.setItem('nabd:dashboard:theme',next);}catch{}
  applyTheme();if(mode==='reference')loadReference();
 });
 window.addEventListener('storage',e=>{
  if(e.key==='nabd:dashboard:language'||e.key==='nabd-marketing-language'){
   let next='ar';try{next=localStorage.getItem('nabd:dashboard:language')||localStorage.getItem('nabd-marketing-language')||'ar';}catch{}
   document.documentElement.lang=next==='en'?'en':'ar';document.documentElement.dir=next==='en'?'ltr':'rtl';
   applyText();if(mode==='reference')loadReference();
  }else if(e.key==='nabd:dashboard:theme'){applyTheme();if(mode==='reference')loadReference();}
 });
 let redraw;
 window.addEventListener('resize',()=>{clearTimeout(redraw);redraw=setTimeout(render,160);});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
 applyText();applyTheme();setOverlay(t().loading);
 refresh();
 const interval=setInterval(refresh,12000);
 const ageTimer=setInterval(()=>{if(!document.hidden)render();},5000);
 window.addEventListener('pagehide',()=>{clearInterval(interval);clearInterval(ageTimer);clearTimeout(redraw);},{once:true});
}
if(typeof document!=='undefined'){
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initChartPage,{once:true});
 else initChartPage();
}
