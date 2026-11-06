/* NABD Phase 6 — read-only live analysis summary for Gold and Bitcoin.
   All values come from /api/market, with no generated advice or MT5 commands. */
const SYMBOLS=['XAUUSD','BTCUSD'];
const translations={
 ar:{
  title:'التحليل المباشر',waiting:'بانتظار المصدر',stale:'البيانات متأخرة',
  warm:'تجهيز الشموع',scan:'مراقبة الشروط',watch:'فرصة مشروطة',
  news:'فلتر الأخبار',blocked:'شروط الدخول غير مكتملة',ready:'شروط متوافقة',
  signal:'توصية منشورة',gap:'فجوة في الشموع',unavailable:'لا تتوفر بيانات تحليل حديثة',
  unknown:'انتظار التحليل',pending:'بانتظار اكتمال شروط الدخول',
  noEntry:'لا توجد توصية جديدة مؤكدة',score:'توافق',buy:'شراء',sell:'بيع',flat:'محايد',
  source:'المصدر',reference:'مرجعي',broker:'وسيط MT5',note:'توافق المؤشرات ليس احتمال ربح ولا تأكيد تنفيذ'
 },
 en:{
  title:'Live analysis',waiting:'Waiting for feed',stale:'Market data stale',
  warm:'Warming candles',scan:'Checking conditions',watch:'Conditional setup',
  news:'News filter',blocked:'Entry gates incomplete',ready:'Conditions aligned',
  signal:'Published signal',gap:'Candle gap',unavailable:'No recent analysis data',
  unknown:'Waiting for analysis',pending:'Waiting for entry conditions',
  noEntry:'No confirmed new signal',score:'Alignment',buy:'Buy',sell:'Sell',flat:'Neutral',
  source:'Source',reference:'Reference',broker:'MT5 broker',note:'Indicator alignment is not win probability or proof of execution'
 }
};
const stateLabels={NO_DATA:'waiting',WARMING:'warm',SCANNING:'scan',WATCH:'watch',READY:'ready',NEWS_BLOCK:'news',BLOCKED:'blocked',STALE:'stale',GAP:'gap'};
const safeText=value=>typeof value==='string'?value.replace(/\s+/g,' ').trim().slice(0,300):'';
const containsArabic=value=>/[\u0600-\u06ff]/.test(value);
const validTime=value=>Number.isFinite(value)&&value>0;
const sideText=(side,t)=>side==='BUY'?t.buy:side==='SELL'?t.sell:side==='NEUTRAL'?t.flat:null;
export function summarizeAnalysisMarket(m,{locale='ar',nowSeconds=Date.now()/1000,serverTime=nowSeconds}={}){
 const t=translations[locale==='en'?'en':'ar'];
 const symbol=SYMBOLS.includes(m?.symbol)?m.symbol:null;
 if(!symbol)return {state:'unavailable',status:t.waiting,frames:'—',score:'—',reason:t.unavailable,source:'—',fresh:false};
 const source=safeText(m.source)||(m.candle_kind==='BROKER_OHLC'?t.broker:t.reference);
 const quoteTime=m.quote?.time,ttl=Number.isFinite(m.quoteTtl)&&m.quoteTtl>0?m.quoteTtl:(symbol==='BTCUSD'?20:90);
 const fresh=m.connection==='LIVE'&&validTime(quoteTime)&&validTime(serverTime)&&
   serverTime>=nowSeconds-15&&serverTime<=nowSeconds+5&&quoteTime<=nowSeconds+5&&
   nowSeconds-quoteTime<=ttl&&(!validTime(m.received_at)||nowSeconds-m.received_at<=ttl);
 if(!fresh){
  const unavailable=!validTime(quoteTime);
  return {state:unavailable?'unavailable':'stale',status:unavailable?t.waiting:t.stale,
   frames:'—',score:'—',reason:unavailable?t.unavailable:t.stale,source,fresh:false};
 }
 const a=m.analysis;
 if(!a||typeof a!=='object')return {state:'unavailable',status:t.unknown,frames:'—',score:'—',reason:t.unavailable,source,fresh:true};
 const failing=[...(Array.isArray(a.entrySafetyChecks)?a.entrySafetyChecks:[]),
   ...(Array.isArray(a.readinessChecks)?a.readinessChecks:[])].filter(g=>g&&g.pass===false);
 const hasSignal=Boolean(m.currentSignal?.id&&validTime(m.currentSignal?.expires_at)&&
  m.currentSignal.expires_at>nowSeconds&&a.status==='READY'&&!failing.length);
 const state=a.status==='NEWS_BLOCK'?'news':a.status==='GAP'?'gap':
   a.status==='STALE'?'stale':failing.length?'blocked':hasSignal?'signal':
   stateLabels[a.status]||'unknown';
 const label=t[state]||t.unknown;
 const parts=[];
 for(const tf of ['M15','H1']){
  const direction=a.frames?.[tf]?.direction;
  if(!['BUY','SELL','NEUTRAL'].includes(direction))continue;
  parts.push(tf+' '+(direction==='BUY'?'↑':direction==='SELL'?'↓':'–'));
 }
 const frames=parts.length?parts.join(' · '):'—';
 const validScore=Array.isArray(a.checks)&&a.checks.length>0&&
   Number.isFinite(a.score)&&a.score>=0&&a.score<=100;
 const score=validScore?t.score+' '+Math.round(a.score)+'/100':'—';
 const options=[safeText(a.reason_label),safeText(failing[0]?.name),safeText(a.reason)];
 let reason=options.find(value=>value&&(locale==='ar'?(containsArabic(value)||!/[A-Z_]{4,}/.test(value)):!containsArabic(value)))||'';
 if(!reason)reason=state==='signal'?t.signal:state==='ready'?t.noEntry:
   state==='news'?t.news:state==='blocked'?t.blocked:t.pending;
 return {state,status:label,frames,score,reason,source,fresh:true};
}

export function initAnalysisRibbon(root=typeof document!=='undefined'?document.getElementById('nabd-analysis-ribbon'):null){
 if(!root||typeof root.querySelectorAll!=='function')return ()=>{};
 const cells=[...root.querySelectorAll('[data-analysis-market]')];
 if(!cells.length)return ()=>{};
 let payload=null;
 const paint=()=>{
  const locale=document.documentElement.lang==='en'?'en':'ar';
  root.setAttribute('aria-label',translations[locale].title);
  const current=Date.now()/1000;
  for(const cell of cells){
   const symbol=cell.getAttribute('data-analysis-market');
   const market=payload?.markets?.[symbol]||null;
   const state=summarizeAnalysisMarket(market,{locale,nowSeconds:current,serverTime:payload?.serverTime});
   cell.dataset.analysisState=state.state;
   const slots={status:'[data-analysis-status]',frames:'[data-analysis-frames]',
    score:'[data-analysis-score]',reason:'[data-analysis-reason]'};
   for(const [key,selector] of Object.entries(slots)){
    const node=cell.querySelector(selector);if(!node)continue;
    node.textContent=state[key];
    if(key==='reason')node.title=state.reason;
    if(key==='score')node.title=translations[locale].note;
   }
   cell.title=translations[locale].source+': '+state.source+' · '+translations[locale].note;
  }
 };
 const localeChanged=()=>paint();
 document.addEventListener('nabd:language-change',localeChanged);
 const interval=setInterval(()=>{if(!document.hidden)paint();},5000);
 window.addEventListener('pagehide',()=>{
  clearInterval(interval);
  document.removeEventListener('nabd:language-change',localeChanged);
 },{once:true});
 paint();
 return data=>{if(data&&data.markets&&typeof data.serverTime==='number'){payload=data;paint();}};
}
