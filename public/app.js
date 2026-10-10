import {positionSize, ema} from '/engine.mjs';
const $ = id => document.getElementById(id);
const e = (tag, cls, content) => {const x = document.createElement(tag); if (cls) x.className = cls; if (content != null) x.textContent = String(content); return x;};
const put = (id, value) => {$(id).textContent = value ?? '—';};
const replace = (id, ...children) => $(id).replaceChildren(...children);
const labels = {LIVE:'متصل بـ MT5',NO_DATA:'انتظار البيانات',STALE:'بيانات قديمة',DELAYED:'تحديث متأخر',DISCONNECTED:'اتصال MT5 منقطع',ERROR:'تعذر الاتصال'};
const sides = {BUY:'شراء',SELL:'بيع',WAIT:'انتظار',NEUTRAL:'محايد',UNKNOWN:'غير مكتمل'};
const statuses = {TRACKING:'قيد المتابعة',TP2:'بلغت الهدف',SL:'وقف الخسارة',EXPIRED:'انتهت الصلاحية',QUEUED:'بانتظار MT5',CONFIRMED:'أكد MT5 التنفيذ',REJECTED:'رُفض الأمر',UNCERTAIN:'التأكيد غير مكتمل'};
const actions = {PAUSE:'إيقاف دخول جديد',RESUME:'استئناف الدخول',CLOSE_POSITION:'إغلاق الصفقة',CLOSE_ALL:'إغلاق صفقات البوت',BREAK_EVEN:'نقل الستوب لسعر الدخول',PARTIAL_CLOSE:'إغلاق نصف الصفقة'};
const views = {overview:'نظرة السوق',signals:'التوصيات',positions:'الصفقات',news:'الأخبار الاقتصادية',results:'النتائج',settings:'الإعدادات والربط'};
const descriptions = {overview:'التوصية وحالة البوت وبيانات الذهب في مكان واحد.',signals:'خطط ثابتة بوقتها ومصدرها الأصلي.',positions:'حسابك وصفقات البوت وأوامر الإدارة.',news:'أحداث الدولار القادمة والمنشورة بتوقيت غزة.',results:'متابعة الخطط وعمليات MT5 الفعلية.',settings:'ربط المنصة وفحص البيانات وحساب المخاطرة.'};
let state = null, signals = [], privateData = null, authenticated = false, view = 'overview';
let chartTf = 'M5', chartRows = [], chartKey = '', chartLoading = false;
let lastSignalId = null, signalsStamp = '', clockOffset = 0, pendingCommand = null, stream = null, streamHealthy = false;
let privateEpoch = 0, privateReadAllowed = true;
const price = v => v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US',{minimumFractionDigits:state?.spec?.digits ?? 2,maximumFractionDigits:state?.spec?.digits ?? 2});
const num = (v, digits = 2) => v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US',{maximumFractionDigits:digits});
const time = (t, detailed = false) => t ? new Intl.DateTimeFormat('ar-PS',{timeZone:'Asia/Gaza',hour:'2-digit',minute:'2-digit',...(detailed ? {month:'short',day:'numeric'} : {})}).format(new Date(t*1000)) : '—';
const now = () => (Date.now() + clockOffset) / 1000;
const badge = (s, cls='neutral') => e('span','pill '+cls,s);
const empty = text => e('p','empty-inline',text);
function toast(message, error=false) {const box=e('div','toast'+(error?' error':'')); const b=e('button','', '×');b.setAttribute('aria-label','إغلاق التنبيه');b.onclick=()=>box.remove();box.append(b,e('span','',message));$('toasts').append(box);setTimeout(()=>box.remove(),9000);}
async function api(path, options={}) {
  const res=await fetch(path,{credentials:'same-origin',cache:'no-store',...options,headers:options.body?{'Content-Type':'application/json',...options.headers}:options.headers});
  let data; try{data=await res.json();}catch{throw new Error('استجابة الخادم غير صالحة.');}
  if(!res.ok){const err=new Error(data.error||'تعذر إكمال الطلب.');err.status=res.status;throw err;}return data;
}
function normalize(raw) {
  if(/^3\./.test(raw.version))return raw;
  const valid=Number(raw.bid)>0&&Number(raw.ask)>0;
  return {version:'legacy',symbol:raw.symbol||'XAUUSD',bid:valid?Number(raw.bid):null,ask:valid?Number(raw.ask):null,
    broker:null,connection:valid?'DELAYED':'NO_DATA',riskLevel:'UNKNOWN',aiDecision:'WAIT',confidence:null,
    reasons:['الخادم الحالي يحتاج تركيب تحديث الربط والتحليل v3.'],timeframes:{},zones:{},checks:[],currentSignal:null,
    calendar:{status:'unavailable',events:[]},spec:null,execution:null,lastUpdate:null};
}
function effectiveConnection() {
  if(!state)return 'NO_DATA';
  if(state.lastUpdate&&now()-state.lastUpdate>20)return 'STALE';
  return state.connection;
}
function applyState(raw) {
  state=normalize(raw);if(state.serverTime)clockOffset=state.serverTime*1000-Date.now();
  renderOverview();renderNews();renderDiagnostics();renderExecution();renderLink();renderStorage();
  const id=state.currentSignal?.id;if(id&&lastSignalId&&id!==lastSignalId&&$('signal-notifications').checked)toast(`إشارة ${sides[state.currentSignal.side]} جديدة — ${price(state.currentSignal.entry)}`);
  if(id)lastSignalId=id;
  const stamp=[state.historyCount,state.currentSignal?.id,state.currentSignal?.tp1_hit,state.currentSignal?.status].join(':');
  if(stamp!==signalsStamp){signalsStamp=stamp;loadSignals();}
  const key=chartTf+':'+(state.timeframes?.[chartTf]?.closed_at??'')+':'+state.symbol;
  if(key!==chartKey){chartKey=key;loadChart();}else drawChart();
}
function renderConnection(){
  const c=effectiveConnection(),live=c==='LIVE',warn=['DELAYED','STALE'].includes(c);
  put('connection',labels[c]||'غير معروف');$('connection').className='pill '+(live?'good':warn?'warn':'neutral');
  put('update-age',state?.lastUpdate?`عمر السعر ${Math.max(0,Math.floor(now()-state.lastUpdate))} ثانية`:'لم يصل تحديث بعد');
  if(!live){put('risk','المخاطرة غير معروفة');$('risk').className='pill neutral';}
}
function renderOverview(){
  const c=effectiveConnection(),live=c==='LIVE',s=state;
  renderConnection();put('symbol-label',s.symbol);put('broker-name',s.broker||'مصدر MT5');
  put('ask',price(s.ask));put('bid',price(s.bid));put('spread',s.spread==null?'—':num(s.spread,1)+' نقطة');put('quote-time',time(s.lastUpdate));
  const riskLabels={UNKNOWN:'المخاطرة غير معروفة',BLOCKED:'الدخول متوقف',CAUTION:'شروط غير مكتملة',ASSESSED:'تم فحص شروط الدخول'};
  const risk=live?s.riskLevel:'UNKNOWN';put('risk',riskLabels[risk]||riskLabels.UNKNOWN);
  const ea=s.signalSource==='MT5_EA',settings=s.bot?.settings;
  put('decision-heading',ea?'قرار البوت المرتبط':'قرار محرك الموقع');
  put('strategy-label',ea?(settings?.ema_fast?`MT5 · EMA ${settings.ema_fast}/${settings.ema_slow}`:'مصدر MT5'):'EMA 8/21/200');
  $('score-section').hidden=ea;$('checks-details').hidden=ea;
  put('signal-source-badge',ea?'خطة MT5 الأصلية':'محرك الموقع');
  put('chart-ma-label','EMA '+(ea&&settings?.ema_fast>0?settings.ema_fast:21));
  $('risk').className='pill '+(risk==='BLOCKED'?'bad':risk==='CAUTION'?'warn':risk==='ASSESSED'?'good':'neutral');
  const decision=live?(sides[s.aiDecision]||'انتظار'):'انتظار البيانات';put('decision',decision);
  $('decision').className=live&&s.aiDecision==='BUY'?'buy':live&&s.aiDecision==='SELL'?'sell':'';
  put('decision-reason',(s.reasons||[]).join(' · ')||'بانتظار تحقق شروط الدخول.');
  put('score',live&&s.confidence!=null?`${num(s.confidence,0)} / 100`:'—');$('score-fill').style.width=live&&s.confidence!=null?Math.min(100,Math.max(0,s.confidence))+'%':'0%';
  put('banner-title',live?(risk==='BLOCKED'?'الدخول متوقف مؤقتًا':s.aiDecision==='WAIT'?'متابعة السوق':ea?'خطة صادرة من البوت':'تحققت شروط إشارة جديدة'):(labels[c]||'انتظار الربط'));
  put('banner-detail',live?(s.reasons?.[0]||'الأسعار والتحليل من نفس مصدر MT5.'):'إصدار إشارات جديدة متوقف إلى أن يصل سعر حديث وبيانات مكتملة.');
  replace('checks',...(s.checks?.length?s.checks.map(ch=>{const row=e('div','check');row.append(e('span',ch.pass?'pass':'fail',ch.pass?'✓':'○'),e('span','',ch.name));return row;}):[empty('الشروط تظهر عند اكتمال الشموع والتقويم الاقتصادي.')]));
  replace('timeframes',...['M5','M15','H1','H4'].map(tf=>{const f=s.timeframes?.[tf]||{},row=e('div','frame'),left=e('div');left.append(e('strong','',{'M5':'5 دقائق','M15':'15 دقيقة','H1':'ساعة','H4':'4 ساعات'}[tf]));row.append(left,e('span','frame-side '+(live&&f.direction==='BUY'?'buy':live&&f.direction==='SELL'?'sell':''),live?(sides[f.direction]||'غير مكتمل'):'انتظار'));row.title=f.count!=null?`${f.count} شمعة مغلقة`:'';return row;}));
  renderActiveSignal();
  replace('zones',...['demand','supply'].map(kind=>{const z=s.zones?.[kind],row=e('div','zone');row.append(e('span','',kind==='demand'?'منطقة طلب':'منطقة عرض'),e('strong',kind==='demand'?'buy':'sell',z?`${price(z.low)} — ${price(z.high)}`:'لا توجد منطقة مؤكدة'));return row;}));
  const next=(s.calendar?.events||[]).find(ev=>ev.time>=now());
  if(next){const box=e('div','next-event');box.append(e('h3','',next.name));const meta=e('div','event-meta');meta.append(badge(next.currency||'USD','outline'),badge(next.importance===3?'أهمية مرتفعة':next.importance===2?'متوسطة':'منخفضة',next.importance===3?'warn':'neutral'),e('span','',time(next.time,true)));box.append(meta,e('strong','countdown',countdown(next.time)));replace('next-event',box);}
  else replace('next-event',empty(s.calendar?.status==='ok'?'لا توجد أحداث قادمة ضمن البيانات المستلمة.':'التقويم الاقتصادي غير متاح؛ فلتر الأخبار يمنع إشارة جديدة.'));
  updateSessions();
}
function countdown(at){const seconds=Math.max(0,Math.floor(at-now())),h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60);return `بعد ${h}س ${m}د` ;}
function updateSessions(){const list=[['طوكيو','Asia/Tokyo'],['لندن','Europe/London'],['نيويورك','America/New_York']];replace('sessions',...list.map(([name,tz])=>{const date=new Date(now()*1000),parts=new Intl.DateTimeFormat('en-US',{timeZone:tz,weekday:'short',hour:'numeric',hourCycle:'h23'}).formatToParts(date),d=parts.find(p=>p.type==='weekday').value,h=+parts.find(p=>p.type==='hour').value;return e('span',!['Sat','Sun'].includes(d)&&h>=8&&h<17?'session-open':'',name);}));}
function valueCell(label,val,cls=''){const box=e('div','value-cell '+cls);box.append(e('small','',label),e('strong','number',price(val)));return box;}
function renderActiveSignal(){
  const p=effectiveConnection()==='LIVE'?state?.currentSignal:null;
  if(!p){const box=e('div','empty-signal');box.append(e('span','empty-symbol','⌖'),e('h3','',effectiveConnection()==='LIVE'?'لا توجد إشارة نشطة':'بانتظار البيانات'),e('p','',state?.suspendedSignal?'متابعة الإشارة معلّقة بسبب تأخر الأسعار؛ خطتها محفوظة في السجل.':'تظهر خطة الدخول عندما تكتمل شروط الاستراتيجية.'));replace('active-signal',box);return;}
  const box=e('div'),head=e('div','signal-heading');head.append(e('strong',p.side==='BUY'?'buy':'sell',sides[p.side]),badge(p.tp1_hit?'بلغت الهدف الأول':'قيد المتابعة',p.tp1_hit?'good':'outline'));box.append(head,e('p','subtle',p.reason));
  const values=e('div','signal-values');values.append(valueCell('الدخول الثابت',p.entry),valueCell('وقف الخسارة',p.sl));
  if(Number.isFinite(p.tp1))values.append(valueCell('الهدف الأول',p.tp1));
  const reward=Math.abs(p.tp2-p.entry)/p.risk_distance;
  values.append(valueCell((p.source==='MT5_EA'?'هدف البوت':'الهدف الثاني')+' · '+num(reward)+'R',p.tp2,'target'));
  box.append(values,e('p','source-caption',p.source==='MT5_EA'?'المستويات من البوت؛ التنفيذ يُراجع في الصفقات.':'المستويات من محرك الموقع؛ متابعة افتراضية.'));
  const cap=e('div','signal-caption');for(const [label,value]of [['صدرت',time(p.issued_at,true)],['الصلاحية',time(p.expires_at)],['نوع المتابعة','افتراضية؛ تنفيذ MT5 يظهر في الصفقات']]){const row=e('div');row.append(e('span','',label),e('span','',value));cap.append(row);}box.append(cap);const button=e('button','button ghost wide','احسب لوت هذه الإشارة');button.onclick=()=>{switchView('settings');$('risk-form').elements.entry.value=p.entry;$('risk-form').elements.sl.value=p.sl;};box.append(button);replace('active-signal',box);
}
async function loadSignals(){try{const data=await api('/api/signals');signals=data.signals||[];renderSignals();renderResults();}catch(err){replace('signals-list',empty('سجل التوصيات غير متاح؛ يلزم تركيب تحديث الخادم.'));}}
function renderSignals(){
  const filter=$('signal-filter').value,source=$('signal-source-filter').value;
  const rows=signals.filter(s=>(filter==='ALL'||s.status===filter)&&(source==='ALL'||(s.source==='MT5_EA'?'MT5_EA':'DASHBOARD')===source));
  put('signals-count',`${rows.length} إشارة · آخر 200 إشارة`);
  replace('signals-list',...(rows.length?rows.map(s=>{
    const row=e('article','signal-row'),head=e('div');head.append(e('small','signal-source',s.source==='MT5_EA'?'بوت MT5':'محرك الموقع'),e('h3',s.side==='BUY'?'buy':'sell',sides[s.side]+' · '+s.symbol),e('small','subtle',time(s.issued_at,true)));
    const levels=e('div','level-inline');for(const [label,v]of [['الدخول',s.entry],['الستوب',s.sl],['هدف أول',s.tp1],['الهدف',s.tp2]])if(Number.isFinite(v)){const cell=e('div');cell.append(e('small','',label),e('strong','',price(v)));levels.append(cell);}
    const status=e('div','row-status');status.append(badge(statuses[s.status]||s.status,s.status==='TP2'?'good':s.status==='SL'?'bad':'neutral'),e('small','subtle',s.r==null?'متابعة افتراضية':`${num(s.r)}R · قبل التكاليف`));row.append(head,levels,status);return row;
  }):[empty('لم تصدر توصيات ضمن هذا الاختيار بعد.') ]));
}
function metric(label,value,note=''){const m=e('div','metric');m.append(e('span','',label),e('strong','',value),e('small','',note));return m;}
function renderResults(){
  const source=$('results-source-filter').value,selected=signals.filter(s=>(s.source==='MT5_EA'?'MT5_EA':'DASHBOARD')===source);
  const settled=selected.filter(s=>['TP2','SL'].includes(s.status)&&Number.isFinite(s.r)),wins=settled.filter(s=>s.r>0),net=settled.reduce((sum,s)=>sum+s.r,0);let sum=0,peak=0,drawdown=0;
  for(const s of settled.slice().reverse()){sum+=s.r;peak=Math.max(peak,sum);drawdown=Math.max(drawdown,peak-sum);}
  replace('signal-metrics',metric('الإشارات المحسومة',String(settled.length),'من آخر 200 إشارة'),metric('بلغت هدفًا بنتيجة موجبة',settled.length?num(wins.length/settled.length*100,1)+'%':'—','متابعة افتراضية'),metric('مجموع النتائج',settled.length?num(net)+'R':'—','قبل العمولة والسواب'),metric('أكبر تراجع',settled.length?num(drawdown)+'R':'—','متابعة الأسعار المستلمة'));
  if(!settled.length)replace('equity-chart',empty('يظهر منحنى النتائج بعد حسم أول إشارة.'));else{
    const values=[0];for(const s of settled.slice().reverse())values.push(values.at(-1)+s.r);
    const min=Math.min(...values)-.2,max=Math.max(...values)+.2,points=values.map((v,i)=>`${20+i/(values.length-1)*760},${145-(v-min)/(max-min)*125}`).join(' '),svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 800 170');svg.setAttribute('role','img');svg.setAttribute('aria-label','منحنى النتائج بوحدات المخاطرة');const line=document.createElementNS(svg.namespaceURI,'polyline');line.setAttribute('points',points);line.setAttribute('fill','none');line.setAttribute('stroke','#b399ff');line.setAttribute('stroke-width','2.5');svg.append(line);replace('equity-chart',svg);
  }
  const gain=wins.reduce((n,s)=>n+s.r,0),loss=-settled.filter(s=>s.r<0).reduce((n,s)=>n+s.r,0);
  replace('results-detail',empty(`معامل الربح: ${loss>0?num(gain/loss):'غير قابل للتقييم'} · الإشارات المنتهية دون حسم: ${selected.filter(s=>s.status==='EXPIRED').length} · النتائج الفعلية تظهر في سجل MT5 أدناه.`));renderDeals();
}
function renderNews(){
  const cal=state?.calendar||{},fresh=cal.status==='ok'&&cal.updated_at&&now()-cal.updated_at<=900;
  put('calendar-status',fresh?'تقويم محدّث':'غير متاح / قديم');$('calendar-status').className='pill '+(fresh?'good':'neutral');put('calendar-updated',cal.updated_at?'آخر تحديث '+time(cal.updated_at,true):'لا توجد بيانات تقويم');
  const filter=$('news-filter').value,rows=(cal.events||[]).filter(ev=>filter==='ALL'||ev.importance===+filter);
  replace('news-list',...(rows.length?rows.map(ev=>{const box=e('article','news-card'),top=e('div','event-top');top.append(badge(ev.importance===3?'أهمية مرتفعة':ev.importance===2?'متوسطة':'منخفضة',ev.importance===3?'warn':'neutral'),e('span','subtle',time(ev.time,true)));box.append(top,e('h3','',ev.name));const data=e('div','news-numbers');for(const [label,v]of [['السابق',ev.previous],['المتوقع',ev.forecast],['الفعلي',ev.actual]]){const cell=e('div');cell.append(e('small','',label),e('strong','',num(v,3)));data.append(cell);}box.append(data,e('div','event-meta',`${ev.currency} · ${ev.time>now()?countdown(ev.time):'صدر الحدث'}${ev.unit?' · '+ev.unit:''}`),e('p','news-source','المصدر: تقويم MetaTrader · التأثير يُقرأ مع السعر والسياق.'));return box;}):[empty(fresh?'لا توجد أحداث ضمن نطاق البيانات المستلمة.':'لا توجد بيانات أخبار موثقة حتى الآن. ربط MT5 يرسل التقويم ويحوّل الوقت إلى UTC.') ]));
}
function switchView(next){if(!views[next])return;view=next;document.querySelectorAll('[data-panel]').forEach(p=>p.hidden=p.dataset.panel!==next);document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('selected',b.dataset.view===next);if(b.dataset.view===next)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});put('view-title',views[next]);put('view-description',descriptions[next]);if(next==='settings')renderLink();if(next==='positions'||next==='results')loadPrivate();if(next==='signals'||next==='results')loadSignals();if(next==='overview')requestAnimationFrame(drawChart);}
async function loadPrivate(){if(!privateReadAllowed)return;const epoch=privateEpoch;try{const data=await api('/api/account');if(epoch!==privateEpoch)return;privateData=data;authenticated=true;put('login-open','تسجيل خروج');renderPrivate();}catch(err){if(epoch!==privateEpoch)return;if(err.status===401){authenticated=false;privateData=null;put('login-open','دخول المشغّل');renderPrivate();renderExecution();}else toast(err.message,true);}}
function renderPrivate(){
  renderLink();$('account-lock').hidden=authenticated;$('account-content').hidden=!authenticated;
  if(!authenticated){replace('account-metrics');replace('positions-list');replace('commands-list');replace('deals-list',empty('سجّل دخول المشغّل لرؤية سجل حسابك.'));return;}
  const a=privateData?.account,currency=a?.currency||state?.spec?.currency||'';
  replace('account-metrics',metric('الرصيد',num(a?.balance),currency),metric('حقوق الحساب',num(a?.equity),currency),metric('الهامش المتاح',num(a?.free_margin),currency),metric('ربح/خسارة عائمة',num(a?.floating),currency));
  if(a&&!$('risk-form').elements.equity.value)$('risk-form').elements.equity.value=a.equity;
  const rows=privateData?.positions||[];
  replace('positions-list',...(rows.length?rows.map(p=>{const box=e('article','position'),top=e('div','position-top');top.append(e('h3',p.side==='BUY'?'buy':'sell',`${sides[p.side]} · #${p.ticket}`),e('strong','number '+(p.profit>=0?'buy':'sell'),`${num(p.profit+p.swap)} ${currency}`));const data=e('div','position-data');for(const [label,v]of [['اللوت',num(p.volume,3)],['الدخول',price(p.entry)],['الستوب',p.sl?price(p.sl):'غير مضبوط'],['الهدف',p.tp?price(p.tp):'غير مضبوط']]){const cell=e('div');cell.append(e('small','',label),e('strong','',v));data.append(cell);}const buttons=e('div','actions');for(const [action,title]of [['BREAK_EVEN','ستوب على الدخول'],['PARTIAL_CLOSE','إغلاق نصف الصفقة'],['CLOSE_POSITION','إغلاق الصفقة']]){const b=e('button','button '+(action==='CLOSE_POSITION'?'danger':'ghost'),title);b.disabled=effectiveConnection()!=='LIVE'||!mainFresh()||!state?.execution?.enabled||!state?.execution?.remote_control;b.onclick=()=>confirmCommand(action,p.ticket);buttons.append(b);}box.append(top,data,buttons);return box;}):[empty('لا توجد صفقات مفتوحة للبوت المرتبط.') ]));
  replace('commands-list',...(privateData?.commands?.length?privateData.commands.map(c=>{const row=e('div','command-row'),info=e('div');info.append(e('span','',actions[c.action]||c.action),e('small','',` · ${time(c.time,true)}${c.ticket!=='0'?' · #'+c.ticket:''}`));row.append(info,badge(statuses[c.status]||c.status,c.status==='CONFIRMED'?'good':c.status==='REJECTED'?'bad':'neutral'));if(c.result)row.title=c.result;return row;}):[empty('لا توجد أوامر تحكم سابقة.')]));renderExecution();renderDeals();
}
function renderExecution(){const x=state?.execution;put('execution-badge',!mainFresh()?'حالة البوت غير متاحة':x?.enabled?(x.demo?'حساب تجريبي':'حساب حقيقي'):'التنفيذ المحلي غير مفعّل');$('execution-badge').className='pill '+(x?.enabled?'warn':'neutral');put('execution-description',x?`${x.paused?'دخول الصفقات موقوف':'إدارة البوت من MT5'} · هدف الربح الصغير ${num(x.small_profit_target)} ${state?.spec?.currency||''} · مخاطرة الإعداد المحلي ${num(x.risk_percent)}% · ${x.remote_control?'التحكم من الموقع متاح':'التحكم من الموقع غير مفعّل'}`:'إعدادات التنفيذ تظهر عند وصول ربط البوت.');for(const id of ['pause-bot','resume-bot','close-all'])$(id).disabled=!authenticated||effectiveConnection()!=='LIVE'||!mainFresh()||!x?.remote_control||(id==='close-all'&&!x?.enabled);document.querySelectorAll('.position .actions button').forEach(b=>b.disabled=!authenticated||effectiveConnection()!=='LIVE'||!mainFresh()||!x?.remote_control||!x?.enabled);}
function renderDeals(){if(!authenticated)return;const rows=privateData?.deals||[];if(!rows.length){replace('deals-list',empty('لم تصل عمليات MT5 فعلية بعد.'));return;}const wrap=e('div','table-wrap'),table=e('table'),head=e('thead'),hr=e('tr');for(const t of ['الوقت','رقم العملية','النوع','الحركة','اللوت','الصافي'])hr.append(e('th','',t));head.append(hr);const tbody=e('tbody');for(const d of rows){const tr=e('tr'),net=d.profit+d.commission+d.swap+d.fee;for(const v of [time(d.time,true),d.ticket,sides[d.side],d.entry_type==='IN'?'دخول':d.entry_type==='OUT'?'خروج':d.entry_type,num(d.volume,3),num(net)])tr.append(e('td','',v));tbody.append(tr);}table.append(head,tbody);wrap.append(table);replace('deals-list',wrap);}
function confirmCommand(action,ticket='0'){if(!authenticated){$('login-dialog').showModal();return;}pendingCommand={action,ticket,...(action==='PARTIAL_CLOSE'?{fraction:.5}:{})};put('command-title',actions[action]);put('command-detail',action==='PAUSE'?'سيوقف البوت فتح صفقات جديدة، مع استمرار إدارة الصفقات القائمة.':action==='RESUME'?'سيُرفع إيقاف الدخول. التنفيذ يبقى خاضعًا لإعدادات البوت والفلاتر في MT5.':action==='CLOSE_ALL'?'سيحاول البوت إغلاق صفقاته المرتبطة بهذا الرمز والرقم السحري، بالسعر المتاح.':action==='BREAK_EVEN'?`سيُطلب نقل ستوب الصفقة #${ticket} لسعر الدخول إذا سمحت شروط البروكر. تكاليف الصفقة قد تجعل النتيجة غير صفرية.`:`سيُرسل طلب ${actions[action]} #${ticket} بالسعر المتاح، وينتظر تأكيد MT5.`);$('command-dialog').showModal();}
function renderDiagnostics(){const s=state||{},entries=[['حالة المصدر',labels[effectiveConnection()]||'—'],['البروكر',s.broker||'لم يصل'],['الرمز',s.symbol||'XAUUSD'],['آخر سعر',time(s.lastUpdate,true)],['نوع السبريد','نقاط البروكر'],['قيمة التيك للوت',num(s.spec?.tick_value_loss)+' '+(s.spec?.currency||'')],['أصغر لوت',num(s.spec?.volume_min,3)],['التحكم الآمن',s.controlsConfigured?'مضبوط بالخادم':'يحتاج ضبط الرموز بالخادم'],['حفظ السجل',s.storage?.mode==='persistent'?'حفظ دائم مضبوط':'مؤقت'],['محرك التحليل',s.strategy||'غير متاح']];replace('diagnostics',...entries.map(([label,val])=>{const row=e('div');row.append(e('dt','',label),e('dd','',val));return row;}));}
function renderStorage(){
  const persistent=state?.storage?.mode==='persistent';
  document.querySelectorAll('[data-storage-note]').forEach(node=>node.textContent=persistent?
    'الحفظ الدائم مضبوط على الخادم. يمكنك تصدير سجل التوصيات إلى CSV.':
    'السجل مؤقت في هذه الاستضافة وقد يُفقد عند إعادة تشغيل الموقع. صدّر CSV لحفظ نسخة؛ إدارة الصفقات من الموقع تحتاج حفظًا دائمًا.');
}
function mainFresh(){const at=state?.bot?.heartbeat_at;return Boolean(state?.execution?.main_connected&&at&&now()-at<=5&&now()-at>=-5);}
function renderLink(){
  const s=state||{},live=effectiveConnection()==='LIVE',main=mainFresh(),x=s.execution,ea=s.signalSource==='MT5_EA';
  const sourceReady=live&&(ea?main&&s.signalSourceReady:s.signalSourceReady);
  const executing=live&&main&&x?.enabled;
  const items=[['السعر والبروكر',live?'بيانات حديثة':'انتظار السعر',live,s.broker||'بيانات من MT5'],
    ['البوت التجاري',main?'حالة حديثة':'انتظار البوت',main,s.bot?.checked_at?'آخر فحص '+time(s.bot.checked_at):'تنسيق محلي مع الجسر'],
    ['مصدر التوصية',ea?'البوت في MT5':'محرك الموقع',sourceReady,sourceReady?'المصدر جاهز للمتابعة':'الإشارات الجديدة معلّقة'],
    ['التنفيذ المحلي',s.bot?.emergency_stop?'إيقاف طوارئ':x?.paused?'الدخول موقوف':executing?'مفعّل في MT5':'غير متاح',executing&&!x?.paused&&!s.bot?.emergency_stop,main?(x?.demo?'حساب تجريبي':'حساب حقيقي'):'يظهر من إعدادات البوت']];
  replace('connection-hub',...items.map(([title,status,good,note])=>{const box=e('div','hub-item'),line=e('strong');line.append(e('i','status-dot '+(good?'good':'')),e('span','',status));box.append(e('small','',title),line,e('p','',note));return box;}));
  const calendar=s.calendar?.status==='ok'&&s.calendar.updated_at&&now()-s.calendar.updated_at<=900;
  const rows=[['الخادم مضبوط',Boolean(s.controlsConfigured),'رمزان مختلفان لربط MT5 ودخول المشغّل.'],
    ['سعر MT5 وصل',live,live?'عمر السعر '+Math.max(0,Math.floor(now()-s.lastUpdate))+' ثانية.':'شغّل الجسر وتأكد من الرابط ورمز الإرسال.'],
    ['البوت والجسر متوافقان',main,main?'حالة البوت تصل من المنصة نفسها.':'طابق الحساب والرمز وMagic وفعّل InpEnableNABDLink.'],
    ['شموع الشارت وصلت',Boolean(s.timeframes?.M5?.count>0),'بيانات الشموع المغلقة من البروكر نفسه.'],
    ['التقويم الاقتصادي محدّث',Boolean(calendar),calendar?'أخبار USD ووقت صدورها من تقويم MT5.':'حالة فلتر البوت تُضبط في MT5؛ محرك الموقع يحتاج تقويمًا حديثًا.'],
    ['بيانات الحساب متاحة للمشغّل',Boolean(authenticated&&privateData?.account),s.accountDataShared?'سجّل دخول المشغّل لعرض الرصيد والصفقات.':'فعّل InpNABDSendAccount في الجسر إذا أردت عرض الحساب.']];
  put('setup-summary',`${rows.filter(r=>r[1]).length} من ${rows.length} مراحل جاهزة · مصدر التوصية: ${ea?'بوت MT5':'محرك الموقع'}`);
  replace('setup-checks',...rows.map(([title,good,note],i)=>{const box=e('div','setup-check'+(good?' complete':'')),content=e('div');content.append(e('h3','',title),e('p','',note));box.append(e('span','step-indicator',good?'✓':i+1),content);return box;}));
  const base=s.publicBaseUrl||'';$('bridge-url').value=base||'اضبط PUBLIC_BASE_URL في الخادم';$('copy-bridge-url').disabled=!base;
  $('download-mt5').setAttribute('aria-label',authenticated?'تنزيل ملفات الربط':'سجّل دخول المشغّل لتنزيل ملفات الربط');
}
async function loadChart(){if(chartLoading)return;chartLoading=true;const requested=chartTf;try{const d=await api('/api/candles?tf='+chartTf);if(requested===chartTf){chartRows=d.candles||[];put('chart-source',d.source?`${d.source} · ${d.symbol} · شموع مغلقة`:'شموع مغلقة من مصدر السعر');}}catch{chartRows=[];}finally{chartLoading=false;drawChart();if(requested!==chartTf)loadChart();}}
function drawChart(){
  const canvas=$('chart'),rect=canvas.getBoundingClientRect();if(rect.width<10)return;const dpr=window.devicePixelRatio||1;canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);const W=rect.width,H=rect.height,left=5,right=68,top=22,bottom=30,width=W-left-right,height=H-top-bottom;
  ctx.clearRect(0,0,W,H);$('chart-empty').hidden=chartRows.length>0;if(!chartRows.length)return;
  const rows=chartRows.slice(-Math.min(100,Math.floor(width/5))),levels=state?.currentSignal&&chartTf==='M5'?[['دخول',state.currentSignal.entry,'#b399ff'],['SL',state.currentSignal.sl,'#fa929e'],['TP1',state.currentSignal.tp1,'#75dcb1'],['TP2',state.currentSignal.tp2,'#75dcb1']].filter(x=>Number.isFinite(x[1])):[];
  const all=[...rows.flatMap(c=>[c.high,c.low]),...levels.map(x=>x[1])],lo=Math.min(...all),hi=Math.max(...all),pad=(hi-lo)*.08||1,min=lo-pad,max=hi+pad,py=p=>top+(max-p)/(max-min)*height;
  ctx.font='11px ui-monospace,monospace';ctx.textAlign='left';for(let i=0;i<=4;i++){const y=top+height*i/4;ctx.strokeStyle='#342b414f';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(W-right,y);ctx.stroke();ctx.fillStyle='#a89bbd';ctx.fillText(price(max-(max-min)*i/4),W-right+8,y+4);}
  const dx=width/rows.length;rows.forEach((c,i)=>{const x=left+dx*(i+.5);ctx.strokeStyle=ctx.fillStyle=c.close>=c.open?'#75dcb1':'#fa929e';ctx.beginPath();ctx.moveTo(x,py(c.high));ctx.lineTo(x,py(c.low));ctx.stroke();ctx.fillRect(x-Math.max(1,dx*.25),Math.min(py(c.open),py(c.close)),Math.max(2,dx*.5),Math.max(1,Math.abs(py(c.open)-py(c.close))));});
  const closes=chartRows.map(c=>c.close),start=chartRows.length-rows.length;ctx.strokeStyle='#b399ff';ctx.lineWidth=1.2;ctx.beginPath();let begun=false;for(let i=0;i<rows.length;i++){const period=state?.signalSource==='MT5_EA'&&state?.bot?.settings?.ema_fast>0?state.bot.settings.ema_fast:21;const v=ema(closes.slice(0,start+i+1),period);if(v!=null){const x=left+dx*(i+.5),y=py(v);if(!begun){ctx.moveTo(x,y);begun=true;}else ctx.lineTo(x,y);}}ctx.stroke();ctx.lineWidth=1;
  for(const [label,v,color]of levels){ctx.strokeStyle=color;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(left,py(v));ctx.lineTo(W-right,py(v));ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=color;ctx.fillText(label,W-right+8,py(v)-4);}
  ctx.fillStyle='#9385a7';ctx.textAlign='center';for(const index of [0,Math.floor(rows.length/2),rows.length-1])ctx.fillText(time(rows[index].time),Math.min(W-right-20,Math.max(28,left+dx*(index+.5))),H-7);
  canvas.onpointermove=event=>{const i=Math.min(rows.length-1,Math.max(0,Math.floor((event.offsetX-left)/dx))),c=rows[i];put('chart-tooltip',`${time(c.time,true)}\nO ${price(c.open)}  H ${price(c.high)}\nL ${price(c.low)}  C ${price(c.close)}`);$('chart-tooltip').hidden=false;};canvas.onpointerleave=()=>$('chart-tooltip').hidden=true;
}
async function fetchState(){try{applyState(await api('/api/state'));}catch(err){state={...state,connection:'ERROR',currentSignal:null,reasons:['تعذر الوصول للخادم؛ البيانات المعروضة قديمة.']};renderOverview();toast('تعذر الاتصال بالخادم؛ عرض الإشارات معلّق.',true);}}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>switchView(b.dataset.view));document.querySelectorAll('[data-goto]').forEach(b=>b.onclick=()=>switchView(b.dataset.goto));$('diagnostics-open').onclick=()=>switchView('settings');$('refresh-now').onclick=fetchState;
document.querySelectorAll('.login-trigger').forEach(b=>b.onclick=async()=>{if(authenticated){privateEpoch++;privateReadAllowed=false;authenticated=false;privateData=null;put('login-open','دخول المشغّل');renderPrivate();renderExecution();try{await api('/api/logout',{method:'POST',body:'{}'});}catch(err){toast(err.message,true);}}else{$('login-error').textContent='';$('login-dialog').showModal();}});
document.querySelectorAll('.dialog-close').forEach(b=>b.onclick=()=>b.closest('dialog').close());
$('login-form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget;try{await api('/api/login',{method:'POST',body:JSON.stringify({token:form.elements.token.value})});privateEpoch++;privateReadAllowed=true;form.reset();$('login-dialog').close();await loadPrivate();toast('تم تسجيل الدخول.');}catch(err){put('login-error',err.message);}};
$('command-confirm').onclick=async()=>{if(!pendingCommand)return;$('command-confirm').disabled=true;try{const result=await api('/api/commands',{method:'POST',body:JSON.stringify(pendingCommand)});$('command-dialog').close();pendingCommand=null;toast(result.message);await loadPrivate();}catch(err){toast(err.message,true);}finally{$('command-confirm').disabled=false;}};
$('pause-bot').onclick=()=>confirmCommand('PAUSE');$('resume-bot').onclick=()=>confirmCommand('RESUME');$('close-all').onclick=()=>confirmCommand('CLOSE_ALL');$('signal-filter').onchange=renderSignals;$('signal-source-filter').onchange=renderSignals;$('results-source-filter').onchange=renderResults;$('news-filter').onchange=renderNews;
$('download-mt5').onclick=event=>{if(!authenticated){event.preventDefault();$('login-dialog').showModal();}};
$('copy-bridge-url').onclick=async()=>{try{await navigator.clipboard.writeText($('bridge-url').value);toast('تم نسخ رابط الجسر.');}catch{toast('انسخ الرابط من الحقل مباشرة.',true);$('bridge-url').select();}};
$('chart-tfs').querySelectorAll('button').forEach(b=>b.onclick=()=>{chartTf=b.dataset.tf;$('chart-tfs').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));chartKey='';loadChart();});
$('risk-form').onsubmit=event=>{event.preventDefault();try{if(!state?.spec)throw new Error('مواصفات العقد لم تصل من البروكر؛ لا يمكن حساب اللوت بدقة.');const inputs=Object.fromEntries(new FormData(event.currentTarget).entries());for(const k of Object.keys(inputs))inputs[k]=Number(inputs[k]);const out=positionSize({...inputs,spec:state.spec,freeMargin:privateData?.account?.free_margin??Infinity});const box=e('div','calc-grid');box.append(metric('اللوت',num(out.volume,3)),metric('الخسارة المقدّرة',num(out.loss),state.spec.currency),metric('الهامش المقدّر',num(out.margin),state.spec.currency));replace('risk-result',box,e('p','subtle',out.reason+' الانزلاق وتغير التكاليف قد يؤثران على النتيجة.'));}catch(err){replace('risk-result',e('p','error-text',err.message));}};
try{$('signal-notifications').checked=localStorage.getItem('nabd-signal-notices')!=='off';}catch{}
$('signal-notifications').onchange=()=>{try{localStorage.setItem('nabd-signal-notices',$('signal-notifications').checked?'on':'off');}catch{}};
new ResizeObserver(drawChart).observe($('chart'));
setInterval(()=>{renderConnection();put('server-clock',time(now())+' · غزة');if(state?.currentSignal&&effectiveConnection()!=='LIVE'){renderActiveSignal();put('decision','انتظار البيانات');}if(state){renderExecution();renderLink();}},1000);
setInterval(()=>{if(!streamHealthy)fetchState();if(authenticated&&(view==='positions'||view==='results'))loadPrivate();if(view==='signals'||view==='results')loadSignals();},10000);
await fetchState();loadSignals();loadPrivate();
stream=new EventSource('/api/events');stream.addEventListener('state',event=>{streamHealthy=true;try{applyState(JSON.parse(event.data));}catch{streamHealthy=false;}});stream.onerror=()=>{streamHealthy=false;};
