/* NABD Phase 10: operator-only read model. No fabricated performance or orders. */
import {requestJson} from './http.js';
const tr={
ar:{heading:'الأداء والنتائج الموثّقة',intro:'نتائج مراكز MT5 المغلقة فقط، دون التوصيات الافتراضية أو الأوامر غير المؤكدة.',dashboard:'لوحة نبض',goldChart:'شارت الذهب',btcChart:'شارت البيتكوين',skip:'الانتقال إلى النتائج',operator:'بيانات حساب MT5 · للمشغّل فقط',market:'السوق',period:'الفترة',accountMode:'نوع الحساب',strategy:'الاستراتيجية',all:'الكل',gold:'الذهب',bitcoin:'البيتكوين',allHistory:'كل السجل المتاح',seven:'7 أيام',thirty:'30 يومًا',ninety:'90 يومًا',allModes:'Demo وLive',notTagged:'غير مصنفة في MT5',refresh:'تحديث النتائج',restricted:'تسجيل دخول المشغّل مطلوب',restrictedText:'لن تُعرض بيانات حساب أي مشترك علنًا. سجّل الدخول من لوحة نبض ثم افتح الصفحة.',login:'العودة للوحة نبض',equity:'منحنى الربح والخسارة المحقّقة',notEquity:'ليس Equity الحساب الفعلي',periodPerformance:'أداء الفترات',daily:'يومي',weekly:'أسبوعي',monthly:'شهري',distribution:'توزيع الصفقات',comparison:'مقارنة الذهب والبيتكوين',methodology:'كيف تُحسب المؤشرات؟',disclaimer:'النتائج السابقة لا تضمن الأرباح المستقبلية.',disclaimer2:'البيانات المتاحة قد تكون ناقصة ولا تشمل المراكز المفتوحة أو الإيداعات والسحوبات.',loading:'جاري تحميل سجل MT5...',error:'تعذر قراءة النتائج من الخادم.',empty:'لا توجد صفقات مغلقة موثّقة بهذه الفلاتر.',sample:'حجم العينة',wins:'الرابحة',losses:'الخاسرة',breakeven:'التعادل',winRate:'نسبة الفوز',net:'الصافي بعد الرسوم',avgWin:'متوسط الربح',avgLoss:'متوسط الخسارة',profitFactor:'معامل الربح',drawdown:'أكبر تراجع محقّق',riskReward:'متوسط Risk/Reward',unavailable:'غير متاح',observed:'الفترة المتاحة',caveat:'التاريخ المتاح جزئي؛ النتائج للمراكز المغلقة المكتملة فقط.',mixed:'لا يجوز جمع عملات أو أوضاع Demo وLive المختلفة في صافي واحد.',sources:'مصادر الوسيط المتاحة',sourceNote:'لا تمثل كامل تاريخ الحساب',formula1:'نسبة الفوز = المراكز الرابحة ÷ جميع المراكز المغلقة المكتملة.',formula2:'الصافي يشمل الربح والعمولة والتبييت والرسوم من MT5.',formula3:'معامل الربح = إجمالي الأرباح ÷ القيمة المطلقة للخسائر. لا يحسب دون خسارة.',formula4:'التراجع = أكبر هبوط في الربح المحقّق المتراكم، وليس تراجع Equity للحساب.',formula5:'المنحنى يبدأ من صفر ويجمع نتائج المراكز المغلقة، وليس رصيد MT5.',formula6:'متوسط Risk/Reward غير متاح لأن خطر الصفقة الأصلي غير محفوظ كدليل.'},
en:{heading:'Verified trading performance',intro:'Fully closed MT5 broker positions only, not simulated signals or unconfirmed orders.',dashboard:'NABD Dashboard',goldChart:'Gold chart',btcChart:'Bitcoin chart',skip:'Skip to results',operator:'MT5 account data · operator only',market:'Market',period:'Period',accountMode:'Account type',strategy:'Strategy',all:'All',gold:'Gold',bitcoin:'Bitcoin',allHistory:'Available history',seven:'7 days',thirty:'30 days',ninety:'90 days',allModes:'Demo and Live',notTagged:'Not tagged in MT5',refresh:'Refresh results',restricted:'Operator login required',restrictedText:'Subscriber account data is not public. Sign in to the dashboard as operator.',login:'Go to dashboard',equity:'Cumulative realized P&L',notEquity:'Not actual account Equity',periodPerformance:'Period performance',daily:'Daily',weekly:'Weekly',monthly:'Monthly',distribution:'Trade distribution',comparison:'Gold vs Bitcoin',methodology:'How metrics are calculated',disclaimer:'Past performance does not guarantee future results.',disclaimer2:'History may be incomplete; open positions and deposits/withdrawals excluded.',loading:'Reading MT5 broker records...',error:'Unable to load verified broker results.',empty:'No verified closed positions match these filters.',sample:'Sample size',wins:'Winners',losses:'Losers',breakeven:'Breakeven',winRate:'Win rate',net:'Net after fees',avgWin:'Average win',avgLoss:'Average loss',profitFactor:'Profit factor',drawdown:'Max realized drawdown',riskReward:'Average risk/reward',unavailable:'Unavailable',observed:'Observed period',caveat:'Available history may be partial; only fully closed positions are measured.',mixed:'Different currencies or Demo/Live modes must not be summed together.',sources:'Broker sources',sourceNote:'Not necessarily complete account history',formula1:'Win rate = winning fully closed positions / all completed positions.',formula2:'Net result includes broker profit, commission, swap and fees.',formula3:'Profit factor = gross profits / absolute gross losses; unavailable with no losses.',formula4:'Drawdown measures realized cumulative P&L, not actual account Equity drawdown.',formula5:'Curve starts at zero and accumulates closed-position P&L, not the MT5 balance.',formula6:'Average risk/reward is unavailable without the original verified risk per trade.'}
};
const get=id=>document.getElementById(id);
const lang=()=>document.documentElement.lang==='en'?'en':'ar';
const word=()=>tr[lang()];
const num=(v,d=2)=>typeof v==='number'&&Number.isFinite(v)?new Intl.NumberFormat('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}).format(v):'—';
const create=(tag,cls='',value)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(value!==undefined)el.textContent=value;return el;};
const svgEl=(tag,attrs={})=>{const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const key of Object.keys(attrs))el.setAttribute(key,String(attrs[key]));return el;};
let current=null,serial=0;
function localize(){
 const t=word();
 document.title='NABD | '+t.heading;
 document.querySelectorAll('[data-i18n]').forEach(el=>{if(t[el.dataset.i18n])el.textContent=t[el.dataset.i18n];});
 get('language').textContent=lang()==='ar'?'EN':'AR';
 get('brand-logo').src=lang()==='ar'?'/nabd-logo.svg':'/nabd-logo-en.svg';
 if(current)render(current);
}
function theme(){
 let value='light';try{value=localStorage.getItem('nabd:dashboard:theme')||'light';}catch{}
 if(value==='system')value=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
 document.documentElement.dataset.nabdTheme=value==='dark'?'dark':'light';
 get('theme').textContent=value==='dark'?'☀':'☾';
}
function metric(title,value,note=''){
 const card=create('article','metric');
 card.append(create('small','',title),create('strong','',value),create('span','',note));
 return card;
}
function lineChart(points){
 const svg=get('equity-chart');svg.replaceChildren();
 get('equity-empty').hidden=Array.isArray(points)&&points.length>1;
 if(!Array.isArray(points)||points.length<2){get('equity-empty').textContent=word().empty;return;}
 const values=points.map(p=>p.pnl),min=Math.min(0,...values),max=Math.max(0,...values),span=Math.max(1e-6,max-min);
 const left=58,right=640,top=18,bottom=202;
 for(let i=0;i<5;i++){
  const y=top+(bottom-top)*i/4;
  svg.append(svgEl('line',{x1:left,y1:y,x2:right,y2:y,class:'gridline'}));
  const text=svgEl('text',{x:5,y:y+4});text.textContent=num(max-(max-min)*i/4,1);svg.append(text);
 }
 const path=svgEl('path',{class:'line',d:points.map((p,i)=>{
  const x=left+(right-left)*i/Math.max(1,points.length-1),y=bottom-(p.pnl-min)/span*(bottom-top);
  return (i===0?'M':'L')+x+','+y;
 }).join(' ')});
 svg.append(path);
 for(const [x,v]of [[left,points[1]?.date],[540,points.at(-1).date]]){
  const text=svgEl('text',{x,y:228});text.textContent=v?new Date(v*1000).toISOString().slice(0,10):'—';svg.append(text);
 }
}
function barChart(periods){
 const svg=get('period-chart');svg.replaceChildren();
 const items=Array.isArray(periods)?periods.slice(-24):[];
 get('period-empty').hidden=items.length>0;
 if(!items.length){get('period-empty').textContent=word().empty;return;}
 const bound=Math.max(1,...items.map(v=>Math.abs(v.pnl))),step=570/items.length,mid=109;
 svg.append(svgEl('line',{x1:54,y1:mid,x2:640,y2:mid,class:'baseline'}));
 items.forEach((p,i)=>{
  const h=Math.abs(p.pnl)/bound*88,x=58+i*step+2;
  svg.append(svgEl('rect',{x,y:p.pnl>=0?mid-h:mid,width:Math.max(2,step-4),height:h,rx:2,
    class:p.pnl>=0?'bar-positive':'bar-negative'}));
  if(items.length<=9||i%Math.ceil(items.length/8)===0){
   const label=svgEl('text',{x,y:226});label.textContent=p.period.slice(-5);svg.append(label);
  }
 });
 for(const [y,v]of [[19,bound],[208,-bound]]){
  const label=svgEl('text',{x:4,y});label.textContent=num(v,1);svg.append(label);
 }
}
function render(data){
 const t=word(),s=data.summary;if(!s)return;
 const money=v=>data.mixedCurrency||data.mixedMode||v===null?t.unavailable:num(v)+' '+(data.currency||'');
 get('metrics').replaceChildren(
  metric(t.sample,String(s.count),t.sourceNote),metric(t.wins,String(s.wins)),metric(t.losses,String(s.losses)),
  metric(t.breakeven,String(s.breakeven)),metric(t.winRate,s.winRatePercent===null?'—':num(s.winRatePercent,1)+'%'),
  metric(t.net,money(s.net),t.notEquity),metric(t.avgWin,money(s.averageWin)),
  metric(t.avgLoss,money(s.averageLoss)),metric(t.profitFactor,s.profitFactor===null?'—':num(s.profitFactor,2)),
  metric(t.drawdown,money(s.maxClosedPnlDrawdown),t.notEquity),
  metric(t.riskReward,t.unavailable,t.formula6),
  metric(t.sources,String(data.evidence?.filter(x=>x.sourceIsBroker).length||0),t.sourceNote)
 );
 const date=v=>v?new Date(v*1000).toISOString().slice(0,10):'—';
 get('scope').textContent=t.observed+': '+date(s.sampleStart)+' — '+date(s.sampleEnd)+' · '+t.caveat+
    (data.mixedCurrency||data.mixedMode?' · '+t.mixed:'');
 lineChart(s.equityCurve);
 barChart(s[get('grouping').value]);
 const dist=get('distribution');dist.replaceChildren();
 if(!s.count)dist.append(create('p','empty',t.empty));
 else{
  const track=create('div','ratio-track');
  for(const [className,count]of [['ratio-wins',s.wins],['ratio-losses',s.losses],['ratio-flat',s.breakeven]]){
   const part=create('span',className);part.style.width=(100*count/s.count)+'%';track.append(part);
  }
  const legend=create('div','legend');
  for(const [name,value]of [[t.wins,s.wins],[t.losses,s.losses],[t.breakeven,s.breakeven]])legend.append(create('span','',name+': '+value));
  dist.append(track,legend);
 }
 const comparison=get('comparison');comparison.replaceChildren();
 const max=Math.max(1,data.bySymbol?.XAUUSD?.count||0,data.bySymbol?.BTCUSD?.count||0);
 for(const symbol of ['XAUUSD','BTCUSD']){
  const entry=data.bySymbol?.[symbol],count=entry?.count||0,row=create('div','comparison-row');
  row.dataset.symbol=symbol;
  const meter=create('div','comparison-meter'),fill=create('span');fill.style.width=100*count/max+'%';meter.append(fill);
  row.append(create('strong','',symbol==='XAUUSD'?t.gold:t.bitcoin),meter,create('small','',count+' '+t.sample));
  comparison.append(row);
 }
 const method=get('methodology-list');method.className='methodology-list';method.replaceChildren();
 for(let i=1;i<=6;i++)method.append(create('p','',t['formula'+i]));
 get('status').textContent=t.caveat;
}
async function load(){
 const seq=++serial;get('refresh').disabled=true;get('status').textContent=word().loading;
 const filters=new URLSearchParams({symbol:get('market').value,period:get('period').value,mode:get('mode').value});
 try{
  const data=await requestJson('/api/performance-center?'+filters.toString());
  if(seq!==serial)return;
  current=data;get('results').hidden=false;get('restricted').hidden=true;render(data);
 }catch(error){
  if(seq!==serial)return;
  current=null;get('results').hidden=true;get('restricted').hidden=![401,403].includes(error.status);
  get('status').textContent=[401,403].includes(error.status)?word().restricted:word().error;
 }finally{if(seq===serial)get('refresh').disabled=false;}
}
function init(){
 get('language').addEventListener('click',()=>{
  const next=lang()==='ar'?'en':'ar';
  document.documentElement.lang=next;document.documentElement.dir=next==='ar'?'rtl':'ltr';
  try{localStorage.setItem('nabd:dashboard:language',next);}catch{}
  localize();
 });
 get('theme').addEventListener('click',()=>{
  try{localStorage.setItem('nabd:dashboard:theme',
    document.documentElement.dataset.nabdTheme==='dark'?'light':'dark');}catch{}
  theme();
 });
 window.addEventListener('storage',e=>{
  if(e.key==='nabd:dashboard:theme')theme();
  if(e.key==='nabd:dashboard:language'){
   document.documentElement.lang=e.newValue==='en'?'en':'ar';
   document.documentElement.dir=e.newValue==='en'?'ltr':'rtl';localize();
  }
 });
 for(const id of ['market','period','mode'])get(id).addEventListener('change',load);
 get('refresh').addEventListener('click',load);
 get('grouping').addEventListener('change',()=>{if(current)barChart(current.summary[get('grouping').value]);});
 localize();theme();load();
 const timer=setInterval(()=>{if(!document.hidden)load();},60000);
 window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
}
if(typeof document!=='undefined'){
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
}
