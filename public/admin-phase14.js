// Phase 14 - MFA admin-only view. Reads aggregate operational status and
// edits DRAFT plan metadata; NEVER grants entitlements, billing or MT5 trading.
const el=(tag,className,text)=>{
 const n=document.createElement(tag);
 if(className)n.className=className;
 if(text!==undefined)n.textContent=String(text);
 return n;
};
const labels={
 ar:{users:'المستخدمون',active:'حسابات مفعّلة',disabled:'حسابات معطّلة',
  deletionRequested:'طلبات حذف',requested:'طلبات استضافة بانتظار الموافقة',
  approved:'طلبات استضافة تمت الموافقة عليها',rejected:'طلبات استضافة مرفوضة',
  provisioned:'مراقبو MT5 المسجّلون',recentHeartbeat:'تقارير مراقبة حديثة',
  onlineReports:'تقارير مراقب متصل',linkedAccounts:'حسابات Telegram المربوطة',
  eventsLast24Hours:'أحداث أمان خلال 24 ساعة',database:'قاعدة الحسابات',
  mt5:'حالة MT5 المبلغ عنها',publication:'جاهزية نشر التوصيات',
  telegram:'قناة Telegram المبلغ عنها',render:'حالة Render الخارجية',
  NOT_CHECKED:'لم يتم التحقق مباشرة',UNKNOWN:'غير معروفة',CONNECTED:'متصلة من الخادم',
  unavailable:'تعذّر تحميل البيانات الإدارية',loading:'جارٍ التحميل…',
  saved:'تم حفظ مسودة فقط؛ لا دفع ولا اشتراك ولا تداول',
  archived:'تم أرشفة المسودة',edit:'تعديل المسودة',archive:'أرشفة',
  noPlans:'لا توجد باقات تجريبية بعد',draft:'مسودة غير قابلة للبيع',
  stateArchived:'مؤرشفة',GOLD_SIGNALS:'إشارات الذهب',
  BTC_SIGNALS:'إشارات البيتكوين',DEMO_MT5_MONITORING:'مراقبة MT5 Demo',
  rejectedData:'أدخل أسماء صحيحة واختر ميزة واحدة على الأقل',
  confirmArchive:'أرشفة هذه المسودة؟ لا تُفعّل أي اشتراك.',
  note:'ملخص داخلي فقط؛ حالة اتصال الوسيط والدفع والنشر Live غير مؤكدة.'},
 en:{users:'Users',active:'Active accounts',disabled:'Disabled accounts',
  deletionRequested:'Deletion requests',requested:'Hosting requests awaiting review',
  approved:'Approved hosting requests',rejected:'Rejected hosting requests',
  provisioned:'Registered MT5 monitors',recentHeartbeat:'Recent monitor heartbeats',
  onlineReports:'Monitors reporting online',linkedAccounts:'Linked Telegram accounts',
  eventsLast24Hours:'Security events in 24 hours',database:'Account database',
  mt5:'MT5 reported status',publication:'Signal publication readiness',
  telegram:'Telegram reported status',render:'External Render service status',
  NOT_CHECKED:'Not directly checked',UNKNOWN:'Unknown',CONNECTED:'Connected from server',
  unavailable:'Admin services unavailable',loading:'Loading…',
  saved:'Draft saved only: no payments, subscriptions, or trading',
  archived:'Draft archived',edit:'Edit draft',archive:'Archive',
  noPlans:'No plan drafts yet',draft:'Non-purchasable draft',
  stateArchived:'Archived',GOLD_SIGNALS:'Gold signals',
  BTC_SIGNALS:'Bitcoin signals',DEMO_MT5_MONITORING:'Demo MT5 monitoring',
  rejectedData:'Enter valid names and choose at least one feature',
  confirmArchive:'Archive this draft? No subscription will be activated.',
  note:'Server observations only; broker, payment and Live deployment are not verified.'}
};
export function initPhase14Admin({api,message,currentLocale,date}){
 const id=n=>document.getElementById(n);
 const lang=()=>currentLocale()==='en'?'en':'ar';
 const tr=k=>labels[lang()][k]??k;
 const metrics=id('phase14-metrics'),services=id('phase14-services'),
  plans=id('phase14-plan-list'),status=id('phase14-plan-status'),
  readiness=id('phase14-readiness'),form=id('phase14-plan-form'),
  refresh=id('phase14-refresh');
 let rows=[],lastOverview=null;
 const staticText={
  ar:{
   '#phase14-title':'لوحة متابعة المنصة',
   '.phase14-control > .portal-note':'قراءات تشغيلية من خادم نبض. لا تؤكد اتصال الوسيط أو سلامة Render الخارجية؛ ولا تفعّل التداول أو صلاحيات أي مشترك.',
   '.phase14-control h3':'حالة الخدمات كما يراها الخادم',
   '#phase14-refresh':'تحديث الحالة',
   '#phase14-plans-title':'مسودات باقات الاشتراك',
   '.phase14-plans > .portal-note':'للتخطيط فقط: الأسعار والمدة والمميزات لا تنشئ اشتراكات مدفوعة ولا تمنح توصيات أو تداولًا. لا يوجد ربط دفع مفعّل.',
   '#phase14-plan-details > summary':'إضافة أو تعديل مسودة باقة',
   '.phase14-features legend':'المميزات المقترحة',
   '#phase14-plan-form button[type="submit"]':'حفظ المسودة فقط',
   '#phase14-plan-reset':'إلغاء التعديل'},
  en:{
   '#phase14-title':'Platform operations dashboard',
   '.phase14-control > .portal-note':'Observations from the NABD server only. These do not verify broker or external Render availability, activate trading or grant permissions.',
   '.phase14-control h3':'Services as reported by this server',
   '#phase14-refresh':'Refresh status',
   '#phase14-plans-title':'Subscription plan drafts',
   '.phase14-plans > .portal-note':'Planning only. Draft prices, durations and features do not create paid subscriptions or grant trading rights. Payment integration is disabled.',
   '#phase14-plan-details > summary':'Create or edit a plan draft',
   '.phase14-features legend':'Proposed features',
   '#phase14-plan-form button[type="submit"]':'Save draft only',
   '#phase14-plan-reset':'Cancel editing'}
 };
 const formLabels={
  ar:{code:'رمز الباقة (لاتيني كبير)',nameAr:'الاسم بالعربية',nameEn:'English name',
   currency:'العملة',price:'سعر مقترح (غير مستحق)',durationDays:'المدة بالأيام'},
  en:{code:'Plan code (uppercase)',nameAr:'Arabic name',nameEn:'English name',
   currency:'Currency',price:'Proposed price (not payable)',durationDays:'Duration in days'}
 };
 const featureLabels={
  ar:{GOLD_SIGNALS:' إشارات الذهب',BTC_SIGNALS:' إشارات البيتكوين',
   DEMO_MT5_MONITORING:' مراقبة MT5 Demo فقط'},
  en:{GOLD_SIGNALS:' Gold signals',BTC_SIGNALS:' Bitcoin signals',
   DEMO_MT5_MONITORING:' Demo MT5 monitoring only'}
 };
 function translateStatic(){
  const locale=lang();
  for(const [selector,copy] of Object.entries(staticText[locale])){
   const target=document.querySelector(selector);if(target)target.textContent=copy;
  }
  for(const [name,copy] of Object.entries(formLabels[locale])){
   const target=form.elements.namedItem(name)?.closest('label');
   if(target && target.firstChild?.nodeType===Node.TEXT_NODE)target.firstChild.nodeValue=copy;
  }
  for(const check of form.querySelectorAll('input[name="features"]')){
   const label=check.closest('label');
   const suffix=check.nextSibling;
   if(suffix?.nodeType===Node.TEXT_NODE) suffix.nodeValue=featureLabels[locale][check.value]||'';
  }
  form.elements.namedItem('code').placeholder=locale==='en'?'GOLD_BASIC':'GOLD_BASIC';
 }
 function metric(key,value){
   const card=el('div','phase14-stat');
   card.append(el('span','',tr(key)),el('strong','',Number(value).toLocaleString(lang()==='en'?'en-US':'ar-PS')));
   return card;
 }
 function showOverview(data){
   lastOverview=data;
   const {users,hosting,mt5Monitor,telegram,audit,services:systems}=data;
   if(!data.observationOnly||data.restrictions?.liveTradingEnabledByAdmin!==false)
     throw Error('Invalid admin observation mode');
   metrics.replaceChildren(
     metric('users',users.total),metric('active',users.active),metric('disabled',users.disabled),
     metric('deletionRequested',users.deletionRequested),
     metric('requested',hosting.requested),metric('approved',hosting.approved),
     metric('rejected',hosting.rejected),metric('provisioned',mt5Monitor.provisioned),
     metric('recentHeartbeat',mt5Monitor.recentHeartbeat),metric('onlineReports',mt5Monitor.onlineReports),
     metric('linkedAccounts',telegram.linkedAccounts),metric('eventsLast24Hours',audit.eventsLast24Hours)
   );
   services.replaceChildren(...['database','mt5','publication','telegram','render'].map(key=>{
     const card=el('div','phase14-service');
     card.append(el('span','',tr(key)),el('strong','',tr(systems[key]||'UNKNOWN')));
     return card;
   }));
   readiness.textContent=tr('note')+' · '+date(data.generatedAt);
 }
 function renderPlans(){
   plans.replaceChildren();
   if(!rows.length)plans.append(el('p','subtle',tr('noPlans')));
   for(const plan of rows){
     const row=el('div','phase14-plan-row');
     const copy=el('div','phase14-plan-copy');
     copy.append(
       el('strong','',lang()==='en'?plan.nameEn:plan.nameAr),
       el('small','',plan.code+' · '+(plan.priceMinor/100).toFixed(2)+' '+plan.currency+
         ' · '+plan.durationDays+' '+(lang()==='en'?'days':'يوم')),
       el('p','subtle',plan.features.map(tr).join(' · ')),
       el('small','',plan.state==='ARCHIVED'?tr('stateArchived'):tr('draft'))
     );
     row.append(copy);
     if(plan.state==='DRAFT'){
       const actions=el('div','phase14-plan-actions');
       const edit=el('button','button ghost',tr('edit'));
       edit.type='button';
       edit.onclick=()=>{
         for(const key of ['id','code','nameAr','nameEn','currency','durationDays'])
           form.elements.namedItem(key).value=plan[key];
         form.elements.namedItem('price').value=(plan.priceMinor/100).toFixed(2);
         for(const check of form.querySelectorAll('input[name="features"]'))check.checked=plan.features.includes(check.value);
         id('phase14-plan-details').open=true;
         form.elements.namedItem('code').focus();
       };
       const archive=el('button','button danger',tr('archive'));
       archive.type='button';
       archive.onclick=async()=>{
         if(!window.confirm(tr('confirmArchive')))return;
         archive.disabled=true;
         try{
           const result=await api('/api/admin/plan-drafts',{action:'archive',id:plan.id});
           if(result.state!=='ARCHIVED'||result.billingEnabled!==false)throw Error('Unexpected archive response');
           status.textContent=tr('archived');await loadPlans();
         }catch(e){message(e.message,true);}
         finally{archive.disabled=false;}
       };
       actions.append(edit,archive);row.append(actions);
     }
     plans.append(row);
   }
 }
 async function loadOverview(){
   refresh.disabled=true;
   try{showOverview(await api('/api/admin/control-center'));}
   catch(e){readiness.textContent=tr('unavailable');message(e.message,true);}
   finally{refresh.disabled=false;}
 }
 async function loadPlans(){
   const result=await api('/api/admin/plan-drafts');
   if(result.billingEnabled!==false||result.subscriptionsEnabled!==false||!Array.isArray(result.plans))
     throw Error('Unsafe catalog response');
   rows=result.plans;
   renderPlans();
 }
 refresh.onclick=()=>void loadOverview();
 form.onsubmit=async event=>{
   event.preventDefault();
   if(!form.reportValidity())return;
   const data=new FormData(form);
   const amount=String(data.get('price')??'');
   const cents=Math.round(Number(amount)*100);
   const features=data.getAll('features');
   if(!/^\d+(?:\.\d{1,2})?$/.test(amount)||!Number.isSafeInteger(cents)||!features.length){
     status.textContent=tr('rejectedData');return;
   }
   const idValue=String(data.get('id')||'');
   const request={action:idValue?'update':'create',
    code:String(data.get('code')||''),nameAr:String(data.get('nameAr')||''),
    nameEn:String(data.get('nameEn')||''),currency:String(data.get('currency')||''),
    priceMinor:cents,durationDays:Number(data.get('durationDays')),features};
   if(idValue)request.id=idValue;
   const button=form.querySelector('[type="submit"]');button.disabled=true;
   try{
     const answer=await api('/api/admin/plan-drafts',request);
     if(answer.billingEnabled!==false||answer.subscriptionsEnabled!==false||answer.liveTradingEnabled!==false)
       throw Error('Unexpected draft response');
     status.textContent=tr('saved');form.reset();form.elements.namedItem('id').value='';
     await loadPlans();
   }catch(e){status.textContent=e.message;message(e.message,true);}
   finally{button.disabled=false;}
 };
 id('phase14-plan-reset').onclick=()=>{form.elements.namedItem('id').value='';};
 document.addEventListener('nabd:language-change',()=>{translateStatic();if(lastOverview)showOverview(lastOverview);renderPlans();});
 translateStatic();
 return Promise.all([loadOverview(),loadPlans()]).catch(e=>{
   status.textContent=tr('unavailable');message(e.message,true);
 });
}
