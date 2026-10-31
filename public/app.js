import {positionSize, ema, botHeartbeatFresh, BOT_CONTROL_TTL} from '/engine.mjs';
import {initLiveWorkspace} from '/live.js';
import {createStateConnection} from '/state-connection.js';
import {requestJson} from '/http.js';
import {controlBlockers} from '/control-readiness.js';
import {createCommandTracker, commandProgress, demoExecutionMessage} from '/command-feedback.js';
const $ = id => document.getElementById(id);
const e = (tag, cls, content) => {const x = document.createElement(tag); if (cls) x.className = cls; if (content != null) x.textContent = String(content); return x;};
const put = (id, value) => {$(id).textContent = value ?? '—';};
const replace = (id, ...children) => $(id).replaceChildren(...children);
const labels = {LIVE:'متصل بـ MT5',NO_DATA:'انتظار البيانات',STALE:'بيانات قديمة',DELAYED:'تحديث متأخر',DISCONNECTED:'اتصال MT5 منقطع',ERROR:'تعذر الاتصال'};
const sides = {BUY:'شراء',SELL:'بيع',WAIT:'انتظار',NEUTRAL:'محايد',UNKNOWN:'غير مكتمل'};
const statuses = {TRACKING:'قيد المتابعة',TP2:'بلغت الهدف',SL:'وقف الخسارة',EXPIRED:'انتهت الصلاحية',QUEUED:'بانتظار MT5',CONFIRMED:'أكد MT5 التنفيذ',REJECTED:'رُفض الأمر',UNCERTAIN:'التأكيد غير مكتمل'};
const actions = {PAUSE:'إيقاف دخول جديد',RESUME:'تشغيل الدخول التلقائي',CLOSE_POSITION:'إغلاق الصفقة',CLOSE_ALL:'إغلاق صفقات البوت',BREAK_EVEN:'نقل الستوب لسعر الدخول',PARTIAL_CLOSE:'إغلاق نصف الصفقة'};
const views = {overview:'نظرة السوق',signals:'التوصيات',positions:'الصفقات',news:'الأخبار الاقتصادية',results:'النتائج',settings:'الإعدادات والربط'};
const descriptions = {overview:'أسعار وسياق السوق وأخبار، ومتابعة جاهزية التوصيات.',signals:'فرص المضاربة وخطط البوت، كل خطة بوقتها ومصدرها.',positions:'حسابك وصفقات البوت وأوامر الإدارة.',news:'عناوين المصادر ومواعيد الأحداث الاقتصادية بتوقيت غزة.',results:'متابعة الخطط وعمليات MT5 الفعلية.',settings:'ربط المنصة وفحص البيانات وحساب المخاطرة.'};
let state = null, signals = [], privateData = null, authenticated = false, view = 'overview';
let chartTf = 'M5', chartRows = [], chartKey = '', chartLoading = false;
let lastSignalId = null, signalsStamp = '', clockOffset = 0, pendingCommand = null, stream = null;
let stateErrorShown = false;
let privateEpoch = 0, privateReadAllowed = true, privateLoading = null, commandSending = false, privateErrorShown = false;
const commandTracker = createCommandTracker();
let memberIdentity = null, memberCsrf = '';
const price = v => v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US',{minimumFractionDigits:state?.spec?.digits ?? 2,maximumFractionDigits:state?.spec?.digits ?? 2});
const num = (v, digits = 2) => v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US',{maximumFractionDigits:digits});
const time = (t, detailed = false) => t ? new Intl.DateTimeFormat('ar-PS',{timeZone:'Asia/Gaza',hour:'2-digit',minute:'2-digit',...(detailed ? {month:'short',day:'numeric'} : {})}).format(new Date(t*1000)) : '—';
const now = () => (Date.now() + clockOffset) / 1000;
const badge = (s, cls='neutral') => e('span','pill '+cls,s);
const empty = text => e('p','empty-inline',text);
function toast(message, error=false) {const box=e('div','toast'+(error?' error':'')); const b=e('button','', '×');b.setAttribute('aria-label','إغلاق التنبيه');b.onclick=()=>box.remove();box.append(b,e('span','',message));$('toasts').append(box);setTimeout(()=>box.remove(),9000);}
async function api(path, options={}) {
  return requestJson(path,{...options,headers:options.body?{'Content-Type':'application/json',...options.headers}:options.headers});
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
let lastFaults = null;
function renderFaultAlerts() {
  const faults = new Map();
  if(state?.bridgeReceivedAt && now()-state.bridgeReceivedAt>60)faults.set('bridge','توقف وصول بيانات جسر MT5 لأكثر من دقيقة.');
  if(state?.storage?.checkpoint?.state==='ERROR')faults.set('storage','تعذر حفظ نسخة السجل في قاعدة البيانات.');
  if(lastFaults)for(const [key,message]of faults)if(!lastFaults.has(key))toast(message,true);
  lastFaults=faults;
}
function applyState(raw) {
  state=normalize(raw);if(state.serverTime)clockOffset=state.serverTime*1000-Date.now();
  renderOverview();renderNews();renderDiagnostics();renderExecution();renderLink();renderStorage();renderFaultAlerts();
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
  const ea=s.signalSource==='MT5_EA',settings=s.bot?.settings;
  const mainReady=!ea||mainFresh();
  const risk=live&&mainReady?s.riskLevel:'UNKNOWN';put('risk',riskLabels[risk]||riskLabels.UNKNOWN);
  put('decision-heading',ea?'قرار البوت المرتبط':'قرار محرك الموقع');
  put('strategy-label',ea?(settings?.ema_fast?`MT5 · EMA ${settings.ema_fast}/${settings.ema_slow}`:'مصدر MT5'):'EMA 8/21/200');
  $('score-section').hidden=ea;$('checks-details').hidden=ea;
  put('signal-source-badge',ea?'خطة MT5 الأصلية':'محرك الموقع');
  put('chart-ma-label','EMA '+(ea&&settings?.ema_fast>0?settings.ema_fast:21));
  $('risk').className='pill '+(risk==='BLOCKED'?'bad':risk==='CAUTION'?'warn':risk==='ASSESSED'?'good':'neutral');
  const decision=live?(mainReady?(sides[s.aiDecision]||'انتظار'):'انتظار البوت'):'انتظار البيانات';put('decision',decision);
  $('decision').className=live&&mainReady&&s.aiDecision==='BUY'?'buy':live&&mainReady&&s.aiDecision==='SELL'?'sell':'';
  const reasons=!live?[c==='ERROR'?'تعذر الوصول للخادم؛ البيانات المعروضة قديمة.':s.lastUpdate?'سعر MT5 متأخر أو اتصال البروكر منقطع؛ إصدار الإشارات الجديدة معلّق.':'لم يصل سعر من MT5 بعد؛ شغّل الجسر وتحقق من إعدادات الربط.']:mainReady?s.reasons:['الأسعار وصلت؛ ننتظر حالة البوت التجاري من الجسر على المنصة نفسها.'];
  put('decision-reason',(reasons||[]).join(' · ')||'بانتظار تحقق شروط الدخول.');
  let readiness = $('publication-readiness');
  if (!readiness) {
    readiness = e('details', 'card'); readiness.id = 'publication-readiness';
    $('decision-reason').after(readiness);
  }
  const stages = s.publicationReadiness || [], missing = stages.filter(x => !x.ready);
  const summary = e('summary', '', stages.length ? `متطلبات إرسال تليجرام · ${missing.length ? missing.length + ' بانتظار الإكمال' : 'مكتملة؛ ننتظر فرصة مستوفية للشروط'}` : 'متطلبات الإرسال بانتظار بيانات الخادم');
  readiness.replaceChildren(summary, ...stages.map(stage => {
    const row = e('p', 'subtle'); row.textContent = `${stage.ready ? '✓' : '○'} ${stage.label}: ${stage.detail}`; return row;
  }));
  put('score',live&&s.confidence!=null?`${num(s.confidence,0)} / 100`:'—');$('score-fill').style.width=live&&s.confidence!=null?Math.min(100,Math.max(0,s.confidence))+'%':'0%';
  put('banner-title',live?(!mainReady?'انتظار البوت':risk==='BLOCKED'?'الدخول متوقف مؤقتًا':s.aiDecision==='WAIT'?'متابعة السوق':ea?'خطة صادرة من البوت':'تحققت شروط إشارة جديدة'):(labels[c]||'انتظار الربط'));
  put('banner-detail',live?(reasons?.[0]||'الأسعار والتحليل من نفس مصدر MT5.'):'إصدار إشارات جديدة متوقف إلى أن يصل سعر حديث وبيانات مكتملة.');
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
  const p=effectiveConnection()==='LIVE'&&(state?.signalSource!=='MT5_EA'||mainFresh())?state?.currentSignal:null;
  if(!p){const box=e('div','empty-signal');box.append(e('span','empty-symbol','⌖'),e('h3','',effectiveConnection()==='LIVE'?'لا توجد إشارة نشطة':'بانتظار البيانات'),e('p','',state?.suspendedSignal?'متابعة الإشارة معلّقة بسبب تأخر الأسعار؛ خطتها محفوظة في السجل.':'تظهر خطة الدخول عندما تكتمل شروط الاستراتيجية.'));replace('active-signal',box);return;}
  const box=e('div'),head=e('div','signal-heading');head.append(e('strong',p.side==='BUY'?'buy':'sell',sides[p.side]),badge(p.tp1_hit?'بلغت الهدف الأول':'قيد المتابعة',p.tp1_hit?'good':'outline'));box.append(head,e('p','subtle',p.reason));
  const values=e('div','signal-values');values.append(valueCell('الدخول الثابت',p.entry),valueCell('وقف الخسارة',p.sl));
  if(Number.isFinite(p.tp1))values.append(valueCell('الهدف الأول',p.tp1));
  const reward=Math.abs(p.tp2-p.entry)/p.risk_distance;
  values.append(valueCell((p.source==='MT5_EA'?'هدف البوت':'الهدف الثاني')+' · '+num(reward)+'R',p.tp2,'target'));
  box.append(values,e('p','source-caption',p.source==='MT5_EA'?'المستويات من البوت؛ التنفيذ يُراجع في الصفقات.':'المستويات من محرك الموقع؛ متابعة افتراضية.'));
  const cap=e('div','signal-caption');for(const [label,value]of [['صدرت',time(p.issued_at,true)],['الصلاحية',time(p.expires_at)],['نوع المتابعة','افتراضية؛ تنفيذ MT5 يظهر في الصفقات']]){const row=e('div');row.append(e('span','',label),e('span','',value));cap.append(row);}box.append(cap);const button=e('button','button ghost wide','احسب لوت هذه الإشارة');button.onclick=()=>{switchView('settings');$('risk-form').elements.entry.value=p.entry;$('risk-form').elements.sl.value=p.sl;};box.append(button);replace('active-signal',box);
}
async function loadSignals(){try{const data=await api('/api/signals');signals=data.signals||[];renderSignals();renderResults();}catch(err){signals=[];renderResults();replace('signals-list',empty(err.status===401?'سجّل الدخول بحساب مؤكد ومخوّل لمشاهدة سجل التوصيات.':'تعذر جلب سجل التوصيات الآن.'),Object.assign(e('a','button primary','تسجيل الدخول'),{href:'/auth'}));}}
function renderSignals(){
  const filter=$('signal-filter').value,source=$('signal-source-filter').value;
  const rows=signals.filter(s=>(filter==='ALL'||s.status===filter)&&(source==='ALL'||(s.source==='MT5_EA'?'MT5_EA':'DASHBOARD')===source));
  put('signals-count',`${rows.length} إشارة · آخر 200 إشارة`);
  replace('signals-list',...(rows.length?rows.map(s=>{
    const row=e('article','signal-row'),head=e('div');head.append(e('small','signal-source',s.source==='MT5_EA'?'بوت MT5':s.source?.startsWith('MT5')?'توصية نبض · '+s.source:'محرك الموقع · '+(s.source||'مرجعي')),e('h3',s.side==='BUY'?'buy':'sell',sides[s.side]+' · '+(s.broker_symbol||s.symbol)),e('small','subtle',time(s.issued_at,true)));
    const levels=e('div','level-inline');for(const [label,v]of [['الدخول',s.entry],['الستوب',s.sl],['هدف أول',s.tp1],['الهدف',s.tp2]])if(Number.isFinite(v)){const cell=e('div');cell.append(e('small','',label),e('strong','',price(v)));levels.append(cell);}
    const status=e('div','row-status');status.append(badge(statuses[s.status]||s.status,s.status==='TP2'?'good':s.status==='SL'?'bad':'neutral'),e('small','subtle',s.telegram_delivery==='SENT'?'أُرسلت إلى تليجرام · متابعة تحليلية':s.r==null?'متابعة افتراضية':`${num(s.r)}R · قبل التكاليف`));row.append(head,levels,status);return row;
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
async function loadPrivate(){
  if(!privateReadAllowed || privateLoading===privateEpoch)return;
  const epoch=privateEpoch;privateLoading=epoch;
  try{
    const data=await api('/api/account');if(epoch!==privateEpoch)return;
    privateData=data;authenticated=true;privateErrorShown=false;commandTracker.observe(data.commands,now());
    put('login-open','تسجيل خروج');renderPrivate();
  }catch(err){
    if(epoch!==privateEpoch)return;
    if(err.status===401){authenticated=false;privateData=null;commandTracker.clear();put('login-open','دخول المشغّل');renderPrivate();renderExecution();}
    else if(!privateErrorShown){toast(err.message,true);privateErrorShown=true;}
  }finally{if(privateLoading===epoch)privateLoading=null;}
}
function renderPrivate(){
  renderLink();$('account-lock').hidden=authenticated;$('account-content').hidden=!authenticated;
  if(!authenticated){replace('account-metrics');replace('automatic-risk-content');replace('positions-list');replace('commands-list');replace('deals-list',empty('سجّل دخول المشغّل لرؤية سجل حسابك.'));return;}
  const a=privateData?.account,currency=a?.currency||state?.spec?.currency||'';
  replace('account-metrics',metric('الرصيد',num(a?.balance),currency),metric('حقوق الحساب',num(a?.equity),currency),metric('الهامش المتاح',num(a?.free_margin),currency),metric('ربح/خسارة عائمة',num(a?.floating),currency));
  renderAutomaticRisk();
  renderTradeSizing();
  if(a&&!$('risk-form').elements.equity.value)$('risk-form').elements.equity.value=a.equity;
  const rows=privateData?.positions||[];
  replace('positions-list',...(rows.length?rows.map(p=>{const box=e('article','position'),top=e('div','position-top');top.append(e('h3',p.side==='BUY'?'buy':'sell',`${sides[p.side]} · #${p.ticket}`),e('strong','number '+(p.profit>=0?'buy':'sell'),`${num(p.profit+p.swap)} ${currency}`));const data=e('div','position-data');for(const [label,v]of [['اللوت',num(p.volume,3)],['الدخول',price(p.entry)],['الستوب',p.sl?price(p.sl):'غير مضبوط'],['الهدف',p.tp?price(p.tp):'غير مضبوط']]){const cell=e('div');cell.append(e('small','',label),e('strong','',v));data.append(cell);}const buttons=e('div','actions');for(const [action,title]of [['BREAK_EVEN','ستوب على الدخول'],['PARTIAL_CLOSE','إغلاق نصف الصفقة'],['CLOSE_POSITION','إغلاق الصفقة']]){const b=e('button','button '+(action==='CLOSE_POSITION'?'danger':'ghost'),title);b.dataset.action=action;b.disabled=false;b.setAttribute('aria-disabled',String(getControlBlockers(action).length>0));b.onclick=()=>confirmCommand(action,p.ticket);buttons.append(b);}const spec=state?.spec,validStop=p.sl>0&&(p.side==='BUY'?p.sl<p.entry:p.sl>p.entry);const loss=validStop&&spec?.tick_size>0&&spec?.tick_value_loss>0?Math.abs(p.entry-p.sl)/spec.tick_size*spec.tick_value_loss*p.volume:null;const protection=!p.sl?'تحذير: الصفقة بدون وقف خسارة.':loss!=null?`خسارة مقدّرة من الدخول حتى الوقف: ${num(loss)} ${currency}، قبل العمولات والانزلاق.`:'الوقف مضبوط؛ تقدير الخسارة من الدخول غير متاح أو الوقف تجاوز الدخول.';box.append(top,data,e('p',!p.sl?'error-text':'subtle',protection),...(!p.tp?[e('p','error-text','الصفقة بدون هدف ربح مضبوط.')]:[]),buttons);return box;}):[empty('لا توجد صفقات مفتوحة للبوت المرتبط.') ]));
  replace('commands-list',...(privateData?.commands?.length?privateData.commands.map(c=>{
    const row=e('div','command-row'),info=e('div'),progress=commandProgress(c,now());
    info.append(e('strong','',actions[c.action]||c.action),e('small','',`${time(c.time,true)}${c.ticket!=='0'?' · #'+c.ticket:''}`));
    if(progress.result)info.append(e('p','command-result',progress.result));
    row.append(info,badge(progress.title,progress.tone));return row;
  }):[empty('لا توجد أوامر تحكم سابقة.')]));renderExecution();renderDeals();
}
function renderTradeSizing(){
  const form=$('trade-sizing-form');if(!form)return;
  const symbol=form.elements.symbol.value;
  const settings=symbol==='BTCUSD'?privateData?.btc?.tradeSizing:privateData?.tradeSizing;
  const key=symbol+':'+(settings?.updated_at||0);
  if(form.dataset.loaded!==key){form.elements.mode.value=settings?.mode||'AUTO';form.elements.lot.value=settings?.lot??'';form.dataset.loaded=key;}
  form.elements.lot.disabled=form.elements.mode.value!=='FIXED';
  $('trade-sizing-feedback').textContent=symbol==='BTCUSD'&&!privateData?.btc?
    'لم تصل بيانات حساب البيتكوين من MT5 بعد.':
    'الستوب والهدف من التوصية. تأكد من خسارة الستوب قبل اختيار لوت يدوي. التنفيذ Demo فقط.';
}
function renderAutomaticRisk(){
  const r=privateData?.riskSizing,box=$('automatic-risk-content'),currency=r?.currency||state?.spec?.currency||'';
  if(!r?.available){box.replaceChildren(empty('ننتظر حقوق الحساب ونسبة المخاطرة ومواصفات العقد من MT5.'));renderWebsiteEntries(box);return;}
  const summary=e('div','position-data');
  for(const [label,value]of [['حقوق الحساب',`${num(r.capital)} ${currency}`],['نسبة المخاطرة',`${num(r.riskPercent)}%`],['سقف الصفقة',`${num(r.budget,4)} ${currency}`],['أقل لوت',num(r.minimumVolume,8)]]){
    const cell=e('div');cell.append(e('small','',label),e('strong','number',value));summary.append(cell);
  }
  const parts=[summary],p=r.plan,s=r.estimate;
  if(state?.execution?.website_recommendations)parts.push(e('p','control-explanation','التنفيذ من توصيات نبض مباشرة على Demo؛ الهدف المستخدم هو الهدف الأول.'));
  if(p&&s){
    parts.push(e('p','subtle',`${p.expired?'تقدير آخر فرصة منتهية؛ لا يُرسل للتنفيذ':'تقدير الفرصة الحالية؛ لا يؤكد اعتمادها أو تنفيذها'} · ${sides[p.side]} · ${time(p.issued_at,true)} · دخول ${price(p.entry)} · وقف ${price(p.sl)}`));
    parts.push(e('p',s.volume>0?'control-explanation':'error-text',s.volume>0?`اللوت المحسوب ${num(s.volume,8)} · خسارة الستوب المقدّرة ${num(s.loss,4)} ${currency}.`:`${s.reason} خسارة أقل لوت لهذه الفرصة ${num(s.minimumLoss,4)} ${currency} مقابل سقف ${num(s.budget,4)} ${currency}.`));
  }else parts.push(empty('ننتظر فرصة لحساب اللوت من دخولها ووقفها تلقائيًا.'));
  parts.push(e('p','subtle',`مسافة الستوب القصوى لأقل لوت ضمن السقف الحالي: ${num(r.maxStopDistance,4)} من وحدات سعر الذهب، قبل التكاليف. لا يغيّر النظام وقف الاستراتيجية ليُجبر الصفقة على الدخول.`));
  if(!privateData?.lastUpdate||now()-privateData.lastUpdate>10)parts.push(e('p','error-text','بيانات الحساب قديمة؛ هذا تقدير محفوظ ويحتاج تحديث MT5.'));
  box.replaceChildren(...parts);
  renderWebsiteEntries(box);
}
function renderWebsiteEntries(box){
  const entries=[...(privateData?.websiteEntries||[]).map(x=>({...x,market:'الذهب'})),...(privateData?.btc?.websiteEntries||[]).map(x=>({...x,market:'بيتكوين'}))].sort((a,b)=>(b.time||0)-(a.time||0));
  if(entries.length){box.append(e('h3','','إرسال توصيات نبض إلى MT5 — الذهب والبيتكوين'));
    for(const record of entries.slice(0,8)){
      const row=e('p','subtle'),p=record.plan;
      const status=record.status==='SUBMITTED'?'أرسل MT5 طلب التنفيذ؛ راجع Trade/History':record.status==='REJECTED'?'منع MT5 التنفيذ؛ راجع Experts':now()>record.expires?'لم يصل تأكيد التنفيذ خلال المهلة؛ لن نكرر الإرسال':'أُرسلت إلى الجسر؛ بانتظار رد MT5';
      row.textContent=`${record.market} · ${time(record.time,true)} · ${sides[p.side]} · دخول ${price(p.entry)} · وقف ${price(p.sl)} · هدف ${price(p.tp)} · ${status}${record.reason_code!=null?' · سبب EA '+record.reason_code:''}${record.mt5_retcode!=null?' · كود MT5 '+record.mt5_retcode:''}`;box.append(row);
    }
  }
}
function activeCommandBusy(){return commandSending || commandTracker.busy() ||
  (privateData?.commands||[]).some(c=>c.status==='QUEUED');}
function renderCommandProgress(){
  const tracked=commandTracker.get(),recent=(privateData?.commands||[])[0];
  const progress=commandProgress(tracked||recent,now()),box=$('command-progress');
  box.hidden=!progress;if(!progress)return;
  box.className='command-progress '+progress.tone;
  // Keep the live region stable while its countdown changes.
  if(!box.firstChild){box.append(e('strong'),e('p'),e('p','command-result'));}
  const command=tracked||recent,title=`${actions[command.action]||command.action} · ${progress.title}`;
  for(const [node,value]of [[box.children[0],title],[box.children[1],progress.detail],[box.children[2],progress.result||'']])
    if(node.textContent!==value)node.textContent=value;
}
function getControlBlockers(action){
  const reasons=controlBlockers({action,authenticated,persistent:state?.storage?.remoteControlAvailable===true,
    live:effectiveConnection()==='LIVE',fresh:controlFresh(),remoteControl:!!state?.execution?.remote_control,
    enabled:!!state?.execution?.enabled});
  if(activeCommandBusy())reasons.push('يوجد أمر قيد الإرسال أو التأكيد؛ انتظر تحديث سجله.');
  if(controlFresh() && effectiveConnection()==='LIVE'){
    if(action==='PAUSE' && state?.execution?.paused)reasons.push('الدخول موقوف بالفعل.');
    if(action==='RESUME' && state?.execution?.paused===false)reasons.push('الدخول التلقائي مسموح بالفعل؛ البوت ينتظر اكتمال شروط التوصية.');
  }
  if(action==='CLOSE_ALL' && authenticated && privateData?.positions?.length===0 && now()-privateData.lastUpdate<=10)
    reasons.push('لا توجد صفقات مفتوحة للبوت المرتبط لإغلاقها.');
  return reasons;
}
function renderExecution(){
  const x=state?.execution;
  put('control-connection-summary',!mainFresh()?'حالة MT5 غير حديثة؛ ننتظر تحديث البوت.':x?.paused?'دخول صفقات جديدة موقوف':x?.enabled?'الدخول التلقائي مسموح عند اكتمال الشروط':'التنفيذ غير مفعّل داخل MT5');
  put('demo-execution-status',demoExecutionMessage(state));
  // Never hide the update package based only on a remote execution flag:
  // it does not prove that the updated compiled EA is installed on the VPS.
  $('control-download-mt5').hidden=false;
  const goldReady=effectiveConnection()==='LIVE' && mainFresh() && !!state?.signalSourceReady;
  const bridge=state?.websiteBridge?.connection||'NOT_OBSERVED';
  const goldNote=!goldReady?'الذهب: بيانات MT5 أو نبض البوت غير حديثة':state?.websiteExecution?.ready?'الذهب: خطة جديدة جاهزة لإرسال Demo':'الذهب: الاتصال حي؛ '+(state?.websiteExecution?.reason||'ننتظر شروط التوصية');
  const btc=privateData?.btc;
  const btcNote=!btc?'البيتكوين: لم تُؤكد بيانات جسر BTC في حساب المشغّل':(!Number.isFinite(btc.lastUpdate)||now()-btc.lastUpdate>15)?'البيتكوين: تحديث جسر BTC متأخر':'البيتكوين: وصل تحديث MT5؛ تنفيذ الصفقة يحتاج فحص شروطها';
  put('mt5-market-readiness',goldNote+' | '+btcNote+' | جسر الذهب: '+bridge+' | تحميل ملفات MT5 لا يعني تركيبها على VPS.');
  renderCommandProgress();
  put('execution-badge',!mainFresh()?'حالة البوت غير متاحة':x?.enabled?(x.demo?'حساب تجريبي':'حساب حقيقي'):'التنفيذ المحلي غير مفعّل');
  $('execution-badge').className='pill '+(x?.enabled?'warn':'neutral');
  put('execution-description',x?(x.demo && x.website_no_daily_limits ? `Demo · حدود الخسارة وعدد الدخولات اليومية معطّلة · ستوب التوصية والهدف الأول · حساب اللوت يبدأ من ${num(x.risk_percent)}% مع السماح بأقل لوت · ${x.paused?'الدخول موقوف':'الدخول مفعّل'}` : `${x.paused?'دخول الصفقات موقوف':'إدارة البوت من MT5'} · هدف الربح الصغير ${num(x.small_profit_target)} ${state?.spec?.currency||''} · مخاطرة الإعداد المحلي ${num(x.risk_percent)}% · ${x.remote_control?'التحكم من الموقع متاح':'التحكم من الموقع غير مفعّل'}`):'إعدادات التنفيذ تظهر عند وصول ربط البوت.');
  // Always explain disabled controls. The actual command is blocked by
  // confirmCommand(), rechecked before POST, and revalidated on the server.
  for(const [id,action] of [['pause-bot','PAUSE'],['resume-bot','RESUME'],['close-all','CLOSE_ALL']]){
    const button=$(id),issues=getControlBlockers(action);
    button.disabled=activeCommandBusy();
    button.setAttribute('aria-disabled',String(issues.length>0));
    button.title=issues.join(' · ')||'سيُطلب التأكيد قبل إرسال الأمر إلى MT5.';
    if(id==='pause-bot')button.textContent=x?.paused?'الدخول موقوف':'إيقاف دخول جديد';
    if(id==='resume-bot')button.textContent=x?.paused===false?'الدخول التلقائي مسموح':'تشغيل الدخول التلقائي';
  }
  const notice=$('control-help'),issues=getControlBlockers(state?.execution?.paused?'RESUME':'PAUSE');
  notice.textContent=issues.length?issues.join(' · '):'اختر الأمر ثم أكّد إرساله. النتيجة تظهر بعد رد MT5.';
  document.querySelectorAll('.position .actions button').forEach(button=>{
    const blockers=getControlBlockers(button.dataset.action||'CLOSE_POSITION');
    button.disabled=activeCommandBusy();
    button.setAttribute('aria-disabled',String(blockers.length>0));
    button.title=blockers.join(' · ')||'سيُطلب التأكيد قبل إرسال الأمر إلى MT5.';
  });
}
function renderDeals(){if(!authenticated)return;const rows=privateData?.deals||[];if(!rows.length){replace('deals-list',empty('لم تصل عمليات MT5 فعلية بعد.'));return;}const wrap=e('div','table-wrap'),table=e('table'),head=e('thead'),hr=e('tr');for(const t of ['الوقت','رقم العملية','النوع','الحركة','اللوت','ربح/خسارة','العمولة','التبييت','الرسوم','الصافي'])hr.append(e('th','',t));head.append(hr);const tbody=e('tbody');for(const d of rows){const tr=e('tr'),net=d.profit+d.commission+d.swap+d.fee;for(const v of [time(d.time,true),d.ticket,sides[d.side],d.entry_type==='IN'?'دخول':d.entry_type==='OUT'?'خروج':d.entry_type,num(d.volume,3),num(d.profit),num(d.commission),num(d.swap),num(d.fee),num(net)])tr.append(e('td','',v));tbody.append(tr);}table.append(head,tbody);wrap.append(table);replace('deals-list',wrap);}
function confirmCommand(action,ticket='0'){if(!authenticated){$('login-dialog').showModal();return;}const issues=getControlBlockers(action);if(issues.length){toast(issues.join(' · '),true);return;}pendingCommand={action,ticket,...(action==='PARTIAL_CLOSE'?{fraction:.5}:{})};put('command-title',actions[action]);put('command-detail',action==='PAUSE'?'سيوقف البوت فتح صفقات جديدة، مع استمرار إدارة الصفقات القائمة.':action==='RESUME'?'سيُرفع إيقاف الدخول. التنفيذ يبقى خاضعًا لإعدادات البوت والفلاتر في MT5.':action==='CLOSE_ALL'?'سيحاول البوت إغلاق صفقاته المرتبطة بهذا الرمز والرقم السحري، بالسعر المتاح.':action==='BREAK_EVEN'?`سيُطلب نقل ستوب الصفقة #${ticket} لسعر الدخول إذا سمحت شروط البروكر. تكاليف الصفقة قد تجعل النتيجة غير صفرية.`:`سيُرسل طلب ${actions[action]} #${ticket} بالسعر المتاح، وينتظر تأكيد MT5.`);$('command-dialog').showModal();}
function renderDiagnostics(){const s=state||{},at=s.bridgeReceivedAt,bridgeRecent=at>0&&now()-at<=20,entries=[['حالة المصدر',labels[effectiveConnection()]||'—'],['وصول الجسر',!at?'لم يصل تحديث':bridgeRecent?'إرسال حديث':'الإرسال متوقف أو متأخر'],['آخر وصول من الجسر',time(at,true)],['آخر نبض للبوت',time(s.bot?.heartbeat_at,true)],['اتصال المنصة بالبروكر',!at?'غير معروف':!bridgeRecent?'آخر حالة محفوظة؛ ننتظر تحديثًا':s.terminalConnected?'متصل':'منقطع'],['البروكر',s.broker||'لم يصل'],['الرمز',s.symbol||'XAUUSD'],['آخر سعر',time(s.lastUpdate,true)],['نوع السبريد','نقاط البروكر'],['قيمة التيك للوت',num(s.spec?.tick_value_loss)+' '+(s.spec?.currency||'')],['أصغر لوت',num(s.spec?.volume_min,3)],['التحكم الآمن',s.controlsConfigured?'مضبوط بالخادم':'يحتاج ضبط الرموز بالخادم'],['سجل أوامر التحكم',s.storage?.commandJournal==='postgres'?'PostgreSQL (دائم)':s.storage?.commandJournal==='disk'?'قرص دائم':'غير متاح'],['سجل التحليل والنتائج',s.storage?.mode==='persistent'?'قرص دائم':s.storage?.checkpoint?.state==='SAVED'?'نسخة PostgreSQL دورية':s.storage?.checkpoint?.state==='RESTORED'?'مستعاد من PostgreSQL':'مؤقت أو النسخ غير مؤكد'],['محرك التحليل',s.strategy||'غير متاح']];replace('diagnostics',...entries.map(([label,val])=>{const row=e('div');row.append(e('dt','',label),e('dd','',val));return row;}));}
function renderStorage(){
  const storage=state?.storage||{}, persistent=storage.mode==='persistent',checkpoint=storage.checkpoint;
  const commandNote=storage.commandJournal==='postgres'
    ? 'سجل أوامر الأزرار محفوظ مباشرة في PostgreSQL، وليس في مساحة Render المؤقتة.'
    : storage.commandJournal==='disk'
      ? 'سجل أوامر الأزرار محفوظ على القرص الدائم.'
      : 'سجل أوامر الأزرار غير متاح دون تخزين دائم، ولن تُرسل أوامر عند غيابه.';
  const historyNote=persistent
    ? 'سجل التحليل والنتائج محفوظ على القرص الدائم.'
    : checkpoint?.lastSavedAt&&['SAVED','RESTORED'].includes(checkpoint.state)
      ? `سجل التحليل والنتائج له نسخة استرداد في PostgreSQL بتاريخ ${time(checkpoint.lastSavedAt,true)} (كل 30 ثانية؛ قد تضيع آخر التغييرات عند انقطاع مفاجئ).`
      : checkpoint?.state==='ERROR'
        ? 'تعذر تحديث نسخة الاسترداد في PostgreSQL؛ صدّر CSV لحفظ السجل.'
        : 'سجل التحليل والنتائج محلي ومؤقت، ولا توجد نسخة استرداد مؤكدة حاليًا.';
  document.querySelectorAll('[data-storage-note]').forEach(node=>node.textContent=commandNote+' '+historyNote);
}
function mainFresh(){return botHeartbeatFresh(state?.bot?.heartbeat_at,state?.execution?.main_connected,now());}
function controlFresh(){return botHeartbeatFresh(state?.bot?.heartbeat_at,state?.execution?.main_connected,now(),BOT_CONTROL_TTL);}
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
  const base=s.publicBaseUrl||window.location.origin;$('bridge-url').value=base;$('copy-bridge-url').disabled=false;
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
const stateConnection=createStateConnection({
  readState:()=>api('/api/state'),
  applyState:raw=>{applyState(raw);stateErrorShown=false;},
  onError:()=>{state={...state,connection:'ERROR',currentSignal:null,reasons:['تعذر الوصول للخادم؛ البيانات المعروضة قديمة.']};renderOverview();renderExecution();renderLink();renderDiagnostics();if(!stateErrorShown){toast('تعذر الاتصال بالخادم؛ عرض الإشارات معلّق.',true);stateErrorShown=true;}}
});
function fetchState(){return stateConnection.refresh();}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>switchView(b.dataset.view));document.querySelectorAll('[data-goto]').forEach(b=>b.onclick=()=>switchView(b.dataset.goto));$('diagnostics-open').onclick=()=>switchView('settings');$('refresh-now').onclick=fetchState;
document.querySelectorAll('.login-trigger').forEach(b=>b.onclick=async()=>{if(authenticated){privateEpoch++;privateReadAllowed=false;authenticated=false;privateData=null;commandTracker.clear();put('login-open','دخول المشغّل');renderPrivate();renderExecution();try{await api('/api/logout',{method:'POST',body:'{}'});}catch(err){toast(err.message,true);}}else{$('login-error').textContent='';$('login-dialog').showModal();}});
document.querySelectorAll('.dialog-close').forEach(b=>b.onclick=()=>b.closest('dialog').close());
$('login-form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget;try{await api('/api/login',{method:'POST',body:JSON.stringify({token:form.elements.token.value})});privateEpoch++;privateReadAllowed=true;form.reset();$('login-dialog').close();await loadPrivate();toast('تم تسجيل الدخول.');}catch(err){put('login-error',err.message);}};
$('command-confirm').onclick=async()=>{
  if(!pendingCommand || commandSending)return;
  const issues=getControlBlockers(pendingCommand.action);
  if(issues.length){$('command-dialog').close();pendingCommand=null;toast(issues.join(' · '),true);return;}
  const command={...pendingCommand},epoch=privateEpoch;
  if(!commandTracker.begin(command.action,command.ticket,now()))return;
  commandSending=true;$('command-confirm').disabled=true;
  // Close immediately so the same confirmation cannot be submitted twice.
  $('command-dialog').close();pendingCommand=null;renderExecution();
  try{
    const result=await api('/api/commands',{method:'POST',body:JSON.stringify(command)});
    if(epoch===privateEpoch){commandTracker.accepted(result);toast('استلم الموقع الأمر؛ ننتظر تأكيد MT5.');}
  }catch(err){
    if(epoch===privateEpoch){commandTracker.failed(err);toast(commandProgress(commandTracker.get(),now()).detail,true);}
  }finally{
    commandSending=false;$('command-confirm').disabled=false;renderExecution();
    if(epoch===privateEpoch)await loadPrivate();
  }
};
$('refresh-controls').onclick=async()=>{
  const button=$('refresh-controls');if(button.disabled)return;
  button.disabled=true;button.textContent='جارٍ تحديث الحالة…';
  try{await Promise.all([fetchState(),loadPrivate()]);}
  finally{button.disabled=false;button.textContent='تحديث الحالة والسجل';}
};
$('control-download-mt5').onclick=event=>{if(!authenticated){event.preventDefault();$('login-dialog').showModal();}};
$('command-dialog').addEventListener('close',()=>{pendingCommand=null;});

$('pause-bot').onclick=()=>confirmCommand('PAUSE');$('resume-bot').onclick=()=>confirmCommand('RESUME');$('close-all').onclick=()=>confirmCommand('CLOSE_ALL');$('signal-filter').onchange=renderSignals;$('signal-source-filter').onchange=renderSignals;$('results-source-filter').onchange=renderResults;$('news-filter').onchange=renderNews;
$('download-mt5').onclick=event=>{if(!authenticated){event.preventDefault();$('login-dialog').showModal();}};
$('copy-bridge-url').onclick=async()=>{try{await navigator.clipboard.writeText($('bridge-url').value);toast('تم نسخ رابط الجسر.');}catch{toast('انسخ الرابط من الحقل مباشرة.',true);$('bridge-url').select();}};
$('chart-tfs').querySelectorAll('button').forEach(b=>b.onclick=()=>{chartTf=b.dataset.tf;$('chart-tfs').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));chartKey='';loadChart();});
$('risk-form').onsubmit=event=>{event.preventDefault();try{if(effectiveConnection()!=='LIVE')throw new Error('بيانات البروكر غير حديثة؛ انتظر عودة الربط قبل حساب اللوت.');if(!state?.spec)throw new Error('مواصفات العقد لم تصل من البروكر؛ لا يمكن حساب اللوت بدقة.');const inputs=Object.fromEntries(new FormData(event.currentTarget).entries());for(const k of Object.keys(inputs))inputs[k]=Number(inputs[k]);const out=positionSize({...inputs,spec:state.spec,freeMargin:privateData?.account?.free_margin??Infinity});const box=e('div','calc-grid');box.append(metric('اللوت',num(out.volume,3)),metric('الخسارة المقدّرة',num(out.loss),state.spec.currency),metric('الهامش المقدّر',num(out.margin),state.spec.currency));replace('risk-result',box,e('p','subtle',out.reason+' الانزلاق وتغير التكاليف قد يؤثران على النتيجة.'));}catch(err){replace('risk-result',e('p','error-text',err.message));}};
try{$('signal-notifications').checked=localStorage.getItem('nabd-signal-notices')!=='off';}catch{}
$('signal-notifications').onchange=()=>{const notifications=$('signal-notifications').checked;try{localStorage.setItem('nabd-signal-notices',notifications?'on':'off');}catch{}if(memberIdentity)api('/api/auth/profile',{method:'POST',headers:{'X-NABD-CSRF':memberCsrf},body:JSON.stringify({name:memberIdentity.name,notifications})}).catch(err=>toast(err.message,true));};
api('/api/auth/me').then(d=>{memberIdentity=d.user;memberCsrf=d.csrf||'';if(d.user){$('signal-notifications').checked=d.user.notifications;try{localStorage.setItem('nabd-signal-notices',d.user.notifications?'on':'off');}catch{}}}).catch(()=>{});
new ResizeObserver(drawChart).observe($('chart'));
$('broker-details').addEventListener('toggle', drawChart);
setInterval(()=>{put('server-clock',time(now())+' · غزة');if(state){renderOverview();renderExecution();renderLink();if(view==='settings')renderDiagnostics();}},1000);
setInterval(()=>{if(stateConnection.needsPoll())fetchState();},5000);
setInterval(()=>{if(authenticated&&!activeCommandBusy()&&(view==='positions'||view==='results'))loadPrivate();if(view==='signals'||view==='results')loadSignals();},10000);
setInterval(()=>{if(authenticated&&activeCommandBusy())loadPrivate();},2000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)fetchState();});
await fetchState();loadSignals();loadPrivate();
stream=new EventSource('/api/events');stream.addEventListener('state',event=>{try{stateConnection.receive(JSON.parse(event.data));}catch{stateConnection.disconnected();}});stream.onerror=()=>stateConnection.disconnected();
initLiveWorkspace({stream,api,time,num,now,notify:toast});
