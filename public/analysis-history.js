/* NABD Phase 8: read-only member-gated history browser, no market/order mutation.
   All historical observations are server-captured, never fabricated client-side. */
export const HISTORY_PERIODS=Object.freeze({DAY:86400,WEEK:7*86400,MONTH:30*86400});
export function historyQuery({symbol='ALL',status='ALL',period='WEEK',before=null,now=Date.now()/1000,limit=30}={}){
 const query=new URLSearchParams({symbol,status,limit:String(limit)});
 if(Object.hasOwn(HISTORY_PERIODS,period))query.set('since',String(Math.max(0,Math.floor(now-HISTORY_PERIODS[period]))));
 if(before!=null)query.set('before',String(before));
 return '/api/analysis-history?'+query.toString();
}
const i18n={
 ar:{
  skip:'تجاوز إلى السجل',dashboard:'لوحة التداول',goldChart:'شارت الذهب',btcChart:'شارت البيتكوين',
  account:'حسابي',title:'سجل تحليلات السوق',
  description:'مراجعة تحليلات الذهب والبيتكوين السابقة، وحالة السوق وأسباب الانتظار حسب البيانات المسجلة فعلًا.',
  disclaimer:'تحليلات مرصودة · ليست صفقات منفّذة',
  market:'السوق',status:'الحالة',period:'الفترة',both:'الذهب والبيتكوين',gold:'الذهب',bitcoin:'بيتكوين',
  all:'كل الحالات',ready:'شروط متوافقة',scanning:'مراقبة الشروط',watch:'فرصة مشروطة',
  blocked:'شروط تمنع الدخول',newsBlocked:'فلتر الأخبار',stale:'بيانات متأخرة',
  warming:'تجهيز الشموع',gap:'فجوة في الشموع',
  day:'آخر 24 ساعة',week:'آخر 7 أيام',month:'آخر 30 يومًا',allPeriod:'كل السجل المتاح',
  refresh:'تحديث',more:'عرض تحليلات أقدم',
  scopeNote:'السجل يخص تحليل السوق المركزي في نبض وليس حساب MT5 الخاص بأي مشترك. لا يتضمن أرقام الحسابات أو أوامر التداول.',
  historyNote:'يبدأ الحفظ من تفعيل هذه الميزة؛ لا توجد تحليلات مُنشأة بأثر رجعي. جاهزية التحليل لا تعني صدور توصية أو تنفيذ صفقة.',
  loading:'جاري جلب التحليلات المسجلة…',empty:'لا توجد تحليلات محفوظة مطابقة لهذه الفلاتر بعد.',
  signIn:'سجّل الدخول بحساب مؤكد ومخوّل للاطلاع على سجل التحليلات.',
  signInLink:'الدخول إلى حساب المشترك',error:'تعذّر جلب سجل التحليلات؛ جرّب تحديث الصفحة.',
  records:n=>'المعروض: '+n+' سجل',first:'أول تحليل محفوظ',none:'لم يبدأ الحفظ بعد',
  persistent:'حفظ دائم مهيأ',ephemeral:'مدة الاحتفاظ غير مضمونة عند إعادة تشغيل الخادم',
  source:'المصدر',mt5:'MT5',reference:'مرجعي',reason:'سبب الحالة',checks:'تفاصيل الشروط',
  indicators:'المؤشرات',readiness:'الجاهزية',safety:'الأمان',unknown:'غير محدد',unknownCheck:'بانتظار',
  score:'توافق',noneScore:'لا توجد درجة مؤكدة',buy:'شراء',sell:'بيع',wait:'انتظار',
  statuses:{READY:'شروط متوافقة',SCANNING:'مراقبة الشروط',WATCH:'فرصة مشروطة',
   BLOCKED:'شروط تمنع الدخول',NEWS_BLOCK:'فلتر الأخبار',STALE:'بيانات متأخرة',
   GAP:'فجوة في الشموع',WARMING:'تجهيز الشموع',NO_DATA:'لا توجد بيانات',
   ERROR:'خطأ في التحليل',UNKNOWN:'حالة غير محددة'}
 },
 en:{
  skip:'Skip to history',dashboard:'Dashboard',goldChart:'Gold chart',btcChart:'Bitcoin chart',
  account:'My account',title:'Market analysis history',
  description:'Review recorded Gold and Bitcoin analyses, market conditions and real waiting reasons.',
  disclaimer:'Recorded analysis · not executed trades',
  market:'Market',status:'Status',period:'Period',both:'Gold and Bitcoin',gold:'Gold',bitcoin:'Bitcoin',
  all:'All states',ready:'Conditions aligned',scanning:'Checking conditions',watch:'Conditional setup',
  blocked:'Entry gates incomplete',newsBlocked:'News filter',stale:'Market data delayed',
  warming:'Warming candles',gap:'Candle gap',
  day:'Last 24 hours',week:'Last 7 days',month:'Last 30 days',allPeriod:'Entire available history',
  refresh:'Refresh',more:'Load older analyses',
  scopeNote:'This is the platform’s global market analysis, not an individual subscriber’s MT5 account. Account numbers and orders are never stored.',
  historyNote:'History begins when this feature is enabled; older analyses are not backfilled. Aligned conditions do not prove a signal was published or a trade was executed.',
  loading:'Loading recorded analyses…',empty:'No recorded analyses match these filters yet.',
  signIn:'Sign in with a verified, authorized member account to view analysis history.',
  signInLink:'Open member sign-in',error:'Unable to load analysis history. Please retry.',
  records:n=>'Displayed: '+n+' records',first:'First recorded analysis',none:'No observations yet',
  persistent:'Persistent storage configured',ephemeral:'History may be lost when the server is restarted',
  source:'Source',mt5:'MT5',reference:'Reference',reason:'Reason',checks:'Condition details',
  indicators:'Indicators',readiness:'Readiness',safety:'Safety',unknown:'Unavailable',unknownCheck:'Pending',
  score:'Alignment',noneScore:'No verified score',buy:'Buy',sell:'Sell',wait:'Waiting',
  statuses:{READY:'Conditions aligned',SCANNING:'Checking conditions',WATCH:'Conditional setup',
   BLOCKED:'Entry gates incomplete',NEWS_BLOCK:'News filter',STALE:'Market data delayed',
   GAP:'Candle gap',WARMING:'Warming candles',NO_DATA:'No data',
   ERROR:'Analysis error',UNKNOWN:'Unknown state'}
 }
};
const el=(tag,className,text)=>{
 const node=document.createElement(tag);
 if(className)node.className=className;
 if(text!==undefined)node.textContent=text;
 return node;
};
function init(){
 const $=id=>document.getElementById(id);
 if(!$('history-list'))return;
 const lang=()=>document.documentElement.lang==='en'?'en':'ar';
 const loc=()=>i18n[lang()];
 const fmtDate=timestamp=>{
  if(!Number.isFinite(timestamp)||timestamp<=0)return '—';
  return new Intl.DateTimeFormat(lang()==='en'?'en-US':'ar',{timeZone:'Asia/Gaza',
   day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(timestamp*1000));
 };
 let items=[],cursor=null,firstRecorded=null,storagePersistent=null,pending=false,epoch=0;
 function theme(){
  let theme='light';
  try{theme=localStorage.getItem('nabd:dashboard:theme')||'light';}catch{}
  if(theme==='system'&&typeof matchMedia==='function')theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
  const dark=theme==='dark';
  document.documentElement.dataset.nabdTheme=dark?'dark':'light';
  $('history-theme').textContent=dark?'☀':'☾';
  $('history-theme').setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode');
 }
 function translate(){
  const t=loc();
  document.title='NABD | '+t.title;
  document.querySelectorAll('[data-i18n]').forEach(n=>{
   const key=n.dataset.i18n;
   if(typeof t[key]==='string')n.textContent=t[key];
  });
  $('history-language').textContent=lang()==='ar'?'EN':'AR';
  $('history-logo').src=lang()==='ar'?'/nabd-logo.svg':'/nabd-logo-en.svg';
  theme();
  render();
 }
 function message(kind,content,link=false){
  const box=$('history-alert');
  box.hidden=!content;
  box.replaceChildren();
  if(!content)return;
  box.append(el('span','',content));
  if(link){
   const a=el('a','',loc().signInLink);
   a.href='/account';a.style.marginInlineStart='12px';box.append(a);
  }
  box.dataset.kind=kind||'neutral';
 }
 function statusText(value){return loc().statuses[value]||loc().unknown;}
 function checkRow(c){
  const pass=c.pass===true?'true':c.pass===false?'false':'unknown';
  const row=el('div','history-check');
  row.dataset.pass=pass;
  const icon=el('span','history-check-icon',pass==='true'?'✓':pass==='false'?'×':'…');
  row.append(icon,el('span','',c.label||loc().unknownCheck));
  return row;
 }
 function detailsSection(container,name,checks){
  if(!Array.isArray(checks)||!checks.length)return;
  const heading=el('strong','',name);
  container.append(heading);
  for(const c of checks.slice(0,12))container.append(checkRow(c));
 }
 function entry(item){
  const t=loc(),article=el('article','history-entry');
  article.dataset.status=item.status||'UNKNOWN';
  const head=el('div','history-entry-head');
  const name=item.symbol==='XAUUSD'?t.gold:item.symbol==='BTCUSD'?t.bitcoin:t.unknown;
  head.append(el('strong','',name+' · '+(item.symbol||'')),
   el('span','history-entry-status',statusText(item.status)),
   el('small','',fmtDate(item.recorded_at)));
  const sub=el('div','history-entry-sub');
  sub.append(el('span','',t.source+': '+(item.source_type==='MT5'?t.mt5:t.reference)));
  const frames=Object.entries(item.frames||{}).filter(([f,d])=>
   ['M5','M15','H1','H4'].includes(f)&&['BUY','SELL','NEUTRAL'].includes(d));
  if(frames.length)sub.append(el('span','',frames.map(([f,d])=>f+' '+(d==='BUY'?'↑':d==='SELL'?'↓':'–')).join(' · ')));
  if(Number.isFinite(item.score)&&item.score>=0&&item.score<=100)
   sub.append(el('span','history-entry-score',t.score+' '+item.score+'/100'));
  else sub.append(el('span','',t.noneScore));
  const reason=el('p','history-entry-reason',item.reason||t.unknown);
  article.append(head,sub,reason);
  const checkCount=['indicator_checks','readiness_checks','entry_checks']
    .reduce((n,k)=>n+(Array.isArray(item[k])?item[k].length:0),0);
  if(checkCount){
   const exp=el('details');
   exp.append(el('summary','',t.checks));
   const body=el('div','history-checks');
   detailsSection(body,t.indicators,item.indicator_checks);
   detailsSection(body,t.readiness,item.readiness_checks);
   detailsSection(body,t.safety,item.entry_checks);
   exp.append(body);article.append(exp);
  }
  return article;
 }
 function render(){
  const t=loc(),list=$('history-list');
  list.replaceChildren();
  if(items.length)list.append(...items.map(entry));
  $('history-count').textContent=t.records(items.length);
  $('history-first').textContent=t.first+': '+(firstRecorded?fmtDate(firstRecorded):t.none);
  $('history-storage').textContent=storagePersistent===null?'':storagePersistent?t.persistent:t.ephemeral;
  $('history-more').hidden=!cursor;
  $('history-more').disabled=pending;
  if(!pending&&!items.length&&!(!$('history-alert').hidden))message('empty',t.empty);
 }
 async function load(reset=false){
  const token=++epoch;
  pending=true;
  if(reset){items=[];cursor=null;message(null,loc().loading);}
  $('history-more').disabled=true;
  const query=historyQuery({
   symbol:$('history-symbol').value,status:$('history-status').value,
   period:$('history-period').value,before:reset?null:cursor,limit:30
  });
  try{
   const response=await fetch(query,{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});
   if(token!==epoch)return;
   if(response.status===401||response.status===403){
    items=[];cursor=null;
    message('signin',loc().signIn,true);return;
   }
   if(!response.ok)throw new Error('Request unavailable');
   const body=await response.json();
   if(token!==epoch)return;
   const incoming=Array.isArray(body.items)?body.items:[];
   items=reset?incoming:[...items,...incoming];
   cursor=Number.isSafeInteger(body.next_cursor)?body.next_cursor:null;
   firstRecorded=body.first_recorded_at||null;
   storagePersistent=body.storage_persistent===true;
   message(null,null);
  }catch{
   if(token===epoch)message('error',loc().error);
  }finally{
   if(token===epoch){pending=false;render();}
  }
 }
 for(const key of ['history-symbol','history-status','history-period'])$(key).addEventListener('change',()=>load(true));
 $('history-refresh').addEventListener('click',()=>load(true));
 $('history-more').addEventListener('click',()=>{if(!pending&&cursor)load(false);});
 $('history-language').addEventListener('click',()=>{
  const value=lang()==='ar'?'en':'ar';
  document.documentElement.lang=value;document.documentElement.dir=value==='ar'?'rtl':'ltr';
  try{localStorage.setItem('nabd:dashboard:language',value);localStorage.setItem('nabd-marketing-language',value);}catch{}
  translate();
 });
 $('history-theme').addEventListener('click',()=>{
  const value=document.documentElement.dataset.nabdTheme==='dark'?'light':'dark';
  try{localStorage.setItem('nabd:dashboard:theme',value);}catch{}
  theme();
 });
 window.addEventListener('storage',e=>{
  if(e.key==='nabd:dashboard:language'||e.key==='nabd-marketing-language'){
   let value='ar';try{value=localStorage.getItem('nabd:dashboard:language')||localStorage.getItem('nabd-marketing-language')||'ar';}catch{}
   document.documentElement.lang=value==='en'?'en':'ar';
   document.documentElement.dir=value==='en'?'ltr':'rtl';
   translate();
  }else if(e.key==='nabd:dashboard:theme')theme();
 });
 const refresh=setInterval(()=>{if(!document.hidden&&!pending&&items.length<=30)load(true);},60000);
 window.addEventListener('pagehide',()=>clearInterval(refresh),{once:true});
 translate();
 load(true);
}
if(typeof document!=='undefined'){
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
 else init();
}
