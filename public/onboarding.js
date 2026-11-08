/* NABD Phase 11 — safe, authenticated member setup wizard.
 * Reuses existing CSRF-bound registration and hosting-review endpoints.
 * Never collects password, investor password, MT5 tokens, or VPS credentials. */
import {requestJson} from './http.js';
import {deriveOnboardingStatus,validateDemoRegistration,statusLabel} from './onboarding-flow.js?v=phase11-1';
const T={
 ar:{
  skip:'تجاوز إلى المعالج',dashboard:'لوحة نبض',account:'حسابي',heading:'ربط حساب MT5 خطوة بخطوة',
  intro:'رحلة واضحة لتسجيل الحساب التجريبي وطلب المراقبة على سيرفر نبض المركزي، دون الحاجة إلى VPS خاص بالمشترك.',
  safeTitle:'بدون كلمات مرور MT5',safeText:'المعالج لا يجمع كلمة مرور التداول أو المستثمر ولا يفتح صفقات.',
  statusDisclaimer:'حفظ الحساب أو قبول الطلب لا يعني اتصال MT5 أو تفعيل التداول.',refresh:'تحديث الحالة',progress:'تقدّم الإعداد',
  step1:'تسجيل الدخول',step2:'تسجيل Demo',step3:'طلب الاستضافة',step4:'موافقة الإدارة',step5:'التحقق من المراقبة',
  alertsTitle:'إعداد التنبيهات',alertsDescription:'شغّل أو أوقف إشعارات التوصيات داخل الموقع. لا يعني هذا ربط Telegram شخصيًا.',
  alertsSite:'تنبيهات التوصيات داخل الموقع',alertsSave:'حفظ إعداد التنبيهات',
  alertsSaved:'تم حفظ تفضيلات التنبيهات.',alertsTelegram:'يُستخدم بوت منفصل للتنبيهات الخاصة، ولا يغيّر قناة التوصيات العامة.',
  alertsGold:'تنبيهات الذهب XAUUSD',alertsBitcoin:'تنبيهات البيتكوين BTCUSD',
  alertsSignals:'التوصيات الجديدة',alertsExecution:'تحديثات تنفيذ الصفقات المؤكدة فقط',
  alertsSystem:'اتصال MT5 وحالة النظام',telegramLink:'ربط Telegram الخاص بي',
  telegramTest:'إرسال رسالة اختبار',telegramUnlink:'إلغاء الربط',
  telegramOpen:'افتح البوت، ثم اضغط Start لتأكيد الربط',
  telegramNote:'إرسال رسالة الاختبار يثبت الربط فقط؛ نشر توصيات فردية تلقائيًا يحتاج تفعيل خدمة التوزيع لاحقًا.',
  telegramDisabled:'ربط Telegram الشخصي غير مُعدّ من إدارة نبض بعد.',
  telegramUnlinked:'لم تربط Telegram الشخصي بعد.',telegramLinked:'Telegram الخاص بك مربوط.',
  telegramTestSent:'تم تأكيد وصول رسالة الاختبار إلى Telegram.',
  telegramLinkCreated:'افتح رابط البوت وأرسل Start ثم حدّث الحالة.',
  telegramUnlinkedDone:'تم إلغاء ربط Telegram الشخصي.',
  telegramSaveError:'تعذر تحديث التفضيلات؛ حاول مجددًا.',
  signin:'ابدأ بتسجيل الدخول',signinDescription:'سجّل الدخول إلى حساب نبض الموثّق لعرض طلبات MT5 الخاصة بك فقط.',
  signinAction:'إنشاء حساب أو تسجيل الدخول',register:'معلومات حساب Demo',
  registerDescription:'الوسيط المدعوم حاليًا: JustMarkets Demo فقط. وسطاء آخرون في مراحل لاحقة.',
  broker:'الوسيط',environment:'نوع الحساب',server:'اسم سيرفر MT5',login:'رقم حساب MT5',
  others:'وسطاء آخرون — غير متاحين حاليًا',realDisabled:'Live — غير مفعّل للمشتركين',
  acknowledge:'أفهم أن هذا تسجيل بيانات الحساب فقط، ولا يتصل بمنصة MT5 أو يفعّل التداول.',
  save:'حفظ حساب Demo',hosting:'طلب استضافة مركزية',
  hostingDescription:'يُرسل الطلب لإدارة نبض لمراجعة تجهيز مراقبة حساب Demo على Windows المركزي. الموافقة ليست ربطًا أو تشغيلًا للتداول.',
  hostingConsent:'أوافق على إرسال طلب الاستضافة للمراجعة. أدرك أن كلمة المرور غير مطلوبة وأن التداول معطّل.',
  sendHosting:'إرسال طلب الاستضافة',monitor:'مراقبة اتصال Windows/MT5',
  hostingStatus:'حالة طلب الاستضافة',lastReport:'آخر تقرير من المراقب',manage:'إدارة طلب MT5 من حسابي',
  central:'كيف يعمل السيرفر المركزي؟',
  centralDescription:'تُقدّم طلبًا من موقع نبض، ثم تراجع الإدارة تجهيزه على Windows المركزي. كل حساب له طلب ومراقب مستقلان. إصدار رمز مراقبة لا يمنح صلاحية التداول، ولا يحتاج المشترك إلى استئجار VPS خاص.',
  later:'تفعيل ربط التداول الفعلي لكل مشترك يتطلب بنية تشغيل آمنة منفصلة واختبارات إضافية، وهو غير متاح في هذه الخطوة.',
  loading:'جاري فحص حالة حسابك على نبض…',loadError:'تعذر التحقق من حالة الحساب حاليًا. لا تعتبر MT5 متصلًا.',
  sentRegistration:'تم تسجيل معلومات Demo. الخطوة التالية تقديم طلب الاستضافة.',sentHosting:'وصل طلب الاستضافة للإدارة. المراجعة لا تفعّل التداول.',
  confirmRequired:'وافق على شروط إرسال طلب الاستضافة أولًا.',accountSummary:'رقم الحساب: ',
  hostingPending:'قيد المراجعة',hostingApproved:'موافقة إدارية',hostingRejected:'طلب سابق مرفوض',hostingNone:'لم يُطلب بعد',
  reported:'آخر تقرير: ',never:'لم يصل تقرير',monitorPending:'المراقبة ليست مفعّلة. لا توجد صلاحية لفتح صفقات من هذا المعالج.',
  onlineReadOnly:'رصد اتصال Demo للمراقبة فقط. فتح الصفقات الآلي غير مفعّل للمشترك.',sessionExpired:'انتهت جلسة الحساب. سجّل الدخول مجددًا.'
 },
 en:{
  skip:'Skip to setup',dashboard:'NABD Dashboard',account:'My account',heading:'MT5 setup, step by step',
  intro:'Register your demo account and request review for monitoring on NABD’s central Windows server, without renting an individual VPS.',
  safeTitle:'No MT5 passwords requested',safeText:'This wizard does not collect trading or investor passwords and cannot place trades.',
  statusDisclaimer:'Saving an account or approving a request does not mean MT5 is connected or auto-trading is enabled.',refresh:'Refresh status',progress:'Setup progress',
  step1:'Sign in',step2:'Register demo',step3:'Hosting request',step4:'Admin approval',step5:'Monitor verification',
  alertsTitle:'Notification setup',alertsDescription:'Enable or disable on-site recommendation notices. This does not link your personal Telegram account.',
  alertsSite:'On-site recommendation notices',alertsSave:'Save notification preferences',
  alertsSaved:'Notification preferences saved.',alertsTelegram:'Personal alerts use a separate bot and do not change the public signal channel.',
  alertsGold:'Gold XAUUSD alerts',alertsBitcoin:'Bitcoin BTCUSD alerts',
  alertsSignals:'New signals',alertsExecution:'Confirmed trade execution updates only',
  alertsSystem:'MT5 connection and system status',telegramLink:'Link my Telegram',
  telegramTest:'Send test message',telegramUnlink:'Unlink Telegram',
  telegramOpen:'Open the bot and press Start to confirm',
  telegramNote:'A test message verifies your personal connection only. Automatic individual signal delivery requires a separate dispatch service.',
  telegramDisabled:'Personal Telegram linking has not been configured by NABD admins.',
  telegramUnlinked:'Your personal Telegram is not linked.',telegramLinked:'Your personal Telegram is linked.',
  telegramTestSent:'Telegram test delivery confirmed.',
  telegramLinkCreated:'Open the bot and press Start, then refresh status.',
  telegramUnlinkedDone:'Your personal Telegram link was removed.',
  telegramSaveError:'Unable to update preferences. Please retry.',
  signin:'Sign in to start',signinDescription:'Sign in to your verified NABD account to see only your own MT5 requests.',
  signinAction:'Create account or sign in',register:'Demo account details',
  registerDescription:'Currently supported: JustMarkets Demo only. Other brokers are planned but unavailable.',
  broker:'Broker',environment:'Account type',server:'MT5 server name',login:'MT5 account number',
  others:'Other brokers — not available',realDisabled:'Live — not enabled for subscribers',
  acknowledge:'I understand this saves demo account metadata only; it does not connect MT5 or authorize trading.',
  save:'Save demo account',hosting:'Request central hosting',
  hostingDescription:'This submits a request for administrative review of Demo monitoring on NABD’s central Windows server. Approval does not mean trading is live.',
  hostingConsent:'I consent to a hosting review. I understand no password is needed and trading is disabled.',
  sendHosting:'Send hosting request',monitor:'Windows/MT5 monitoring',
  hostingStatus:'Hosting request',lastReport:'Last monitor report',manage:'Manage MT5 request in my account',
  central:'How does the central server work?',
  centralDescription:'Submit a request from NABD. An administrator reviews a separate Windows monitoring worker for your demo account. Monitoring tokens grant no trading rights, and you do not need your own VPS.',
  later:'Enabling real per-subscriber trading requires a separate secure architecture and additional verification. It is not available in this step.',
  loading:'Checking your NABD account status…',loadError:'Unable to verify account status. Do not assume MT5 is connected.',
  sentRegistration:'Demo metadata saved. You can now request central hosting.',sentHosting:'Hosting request sent for review. Trading is not enabled.',
  confirmRequired:'Agree to the hosting review conditions first.',accountSummary:'Account number: ',
  hostingPending:'Pending review',hostingApproved:'Admin approved',hostingRejected:'Previously rejected',hostingNone:'Not requested',
  reported:'Last report: ',never:'No report received',monitorPending:'Monitoring not verified. This wizard never enables automatic trading.',
  onlineReadOnly:'Demo connection observed for monitoring only; subscriber auto-trading is disabled.',
  sessionExpired:'Session expired. Sign in again.'
 }
};
const $=id=>document.getElementById(id);
const lang=()=>document.documentElement.lang==='en'?'en':'ar';
const words=()=>T[lang()];
let user=null,csrf='',registry=null,alertState=null,loading=false,sequence=0;
const statusText=(value)=>value===null||value===undefined?'—':String(value);
const localizedTime=v=>Number.isFinite(Number(v))&&Number(v)>0?
 new Date(Number(v)*1000).toLocaleString(lang()==='ar'?'ar-PS':'en-GB',{
  timeZone:'Asia/Gaza',dateStyle:'medium',timeStyle:'short'}):words().never;
function notify(message='',error=false){
 const el=$('onboarding-message');el.textContent=message;el.dataset.error=String(error);
}
function localize(){
 const text=words();
 document.title='NABD | '+text.heading;
 document.querySelectorAll('[data-t]').forEach(el=>{
  const value=text[el.dataset.t];if(value)el.textContent=value;
 });
 $('onboarding-language').textContent=lang()==='ar'?'EN':'AR';
 $('onboarding-logo').src=lang()==='ar'?'/nabd-logo.svg':'/nabd-logo-en.svg';
 paint();
}
function theme(){
 let choice='light';
 try{choice=localStorage.getItem('nabd:dashboard:theme')||'light';}catch{}
 if(choice==='system')choice=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
 document.documentElement.dataset.nabdTheme=choice==='dark'?'dark':'light';
 $('onboarding-theme').textContent=choice==='dark'?'☀':'☾';
}
function paint(){
 const w=words(),s=deriveOnboardingStatus(user,registry),a=s.account;
 $('onboarding-state').textContent=statusLabel(s.phase,lang());
 $('onboarding-state-dot').dataset.state=s.canObserveDemo?'monitoring':'pending';
 const keys=['signin','register','hosting','review','monitoring'];
 const values=[s.steps.signin,s.steps.register,s.steps.hosting,s.steps.approved,s.steps.monitoring];
 document.querySelectorAll('#onboarding-steps li').forEach((li,i)=>{
  li.dataset.complete=String(values[i]);
  li.dataset.active=String(i===keys.findIndex((_,n)=>!values[n]));
 });
 $('onboarding-alerts').hidden=!user;
 if(user){$('onboarding-alerts-form').elements.notifications.checked=user.notifications===true||user.notifications===1;}
 const pref=alertState?.preferences;
 if(user&&pref){
  for(const name of ['gold','bitcoin','signals','execution','system'])
   $('onboarding-alerts-form').elements[name].checked=pref[name]===true;
 }
 const personal=alertState?.telegram;
 const configured=personal?.configured===true,linked=personal?.linked===true;
 $('onboarding-telegram-status').textContent=!configured?w.telegramDisabled:linked?w.telegramLinked:w.telegramUnlinked;
 $('onboarding-telegram-link').disabled=!configured||linked;
 $('onboarding-telegram-test').disabled=!configured||!linked;
 $('onboarding-telegram-unlink').disabled=!configured||!linked;
 $('onboarding-signin').hidden=s.phase!=='SIGN_IN';
 $('onboarding-register').hidden=!s.mayRegister;
 $('onboarding-hosting').hidden=!s.mayRequestHosting;
 $('onboarding-monitor').hidden=!a||s.mayRegister||s.mayRequestHosting;
 if(a){
  $('onboarding-account-summary').textContent=a.broker+' · '+a.server_name+
    ' · '+w.accountSummary+statusText(a.login);
  $('onboarding-monitor-broker').textContent=statusText(a.broker);
  $('onboarding-monitor-server').textContent=statusText(a.server_name);
  $('onboarding-monitor-hosting').textContent=({
    NOT_REQUESTED:w.hostingNone,REQUESTED:w.hostingPending,
    APPROVED:w.hostingApproved,REJECTED:w.hostingRejected
  })[s.hostingStatus]||w.hostingNone;
  $('onboarding-monitor-last').textContent=localizedTime(a.last_seen_at);
  $('onboarding-monitor-description').textContent=s.canObserveDemo?w.onlineReadOnly:w.monitorPending;
 }
}
async function refresh(){
 if(loading)return;
 loading=true;const tick=++sequence;
 $('onboarding-refresh').disabled=true;notify(words().loading);
 try{
  const me=await requestJson('/api/auth/me');
  if(tick!==sequence)return;
  user=me.user||null;csrf=me.csrf||'';
  if(!user){registry=null;alertState=null;notify('');paint();return;}
  const [accountData,prefsData]=await Promise.all([
   requestJson('/api/auth/mt5-accounts'),
   requestJson('/api/auth/alerts').catch(()=>null)
  ]);
  registry=accountData;alertState=prefsData;
  if(tick===sequence){notify('');paint();}
 }catch(error){
  user=null;registry=null;alertState=null;csrf='';paint();
  notify(error?.status===401?words().sessionExpired:words().loadError,true);
 }finally{loading=false;$('onboarding-refresh').disabled=false;}
}
async function write(path,data,button){
 if(!user||!csrf)throw new Error(words().sessionExpired);
 button.disabled=true;
 try{
  return await requestJson(path,{
   method:'POST',
   headers:{'Content-Type':'application/json','X-NABD-CSRF':csrf},
   body:JSON.stringify(data)
  },30000);
 }finally{button.disabled=false;}
}
function init(){
 $('onboarding-language').addEventListener('click',()=>{
  const next=lang()==='ar'?'en':'ar';
  document.documentElement.lang=next;document.documentElement.dir=next==='en'?'ltr':'rtl';
  try{localStorage.setItem('nabd:dashboard:language',next);}catch{}
  localize();
 });
 $('onboarding-theme').addEventListener('click',()=>{
  const next=document.documentElement.dataset.nabdTheme==='dark'?'light':'dark';
  try{localStorage.setItem('nabd:dashboard:theme',next);}catch{}
  theme();
 });
 window.addEventListener('storage',event=>{
  if(event.key==='nabd:dashboard:language'){
   const next=event.newValue==='en'?'en':'ar';
   document.documentElement.lang=next;document.documentElement.dir=next==='en'?'ltr':'rtl';
   localize();
  }
  if(event.key==='nabd:dashboard:theme')theme();
 });
 $('onboarding-refresh').addEventListener('click',refresh);
 $('onboarding-alerts-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const form=event.currentTarget,button=$('onboarding-alerts-save');
  const feedback=$('onboarding-alerts-feedback');
  const notifications=form.elements.notifications.checked;
  if(!user||!csrf||typeof user.name!=='string'||!user.name.trim()){
   feedback.textContent=words().sessionExpired;return;
  }
  try{
   await write('/api/auth/profile',{name:user.name,notifications},button);
   try{localStorage.setItem('nabd-signal-notices',notifications?'on':'off');}catch{}
   if(alertState?.telegram){
    try{
     const values=Object.fromEntries(['gold','bitcoin','signals','execution','system'].map(name=>[name,form.elements[name].checked]));
     await write('/api/auth/alerts',values,button);
    }catch(error){feedback.textContent=error?.message||words().telegramSaveError;return;}
   }else{
    feedback.textContent=words().telegramSaveError;return;
   }
   await refresh();
   feedback.textContent=words().alertsSaved;
  }catch(error){feedback.textContent=error?.message||words().loadError;}
 });
 $('onboarding-telegram-link').addEventListener('click',async()=>{
  const button=$('onboarding-telegram-link'),feedback=$('onboarding-alerts-feedback');
  try{
   const r=await write('/api/auth/telegram/link',{},button);
   if(typeof r.url!=='string'||!/^https:\/\/t\.me\/[A-Za-z][A-Za-z0-9_]{4,31}\?start=nabd_[A-Za-z0-9_-]{43}$/.test(r.url))throw Error(words().loadError);
   const anchor=$('onboarding-telegram-open');anchor.href=r.url;anchor.hidden=false;
   feedback.textContent=words().telegramLinkCreated;
  }catch(error){feedback.textContent=error?.message||words().loadError;}
 });
 $('onboarding-telegram-test').addEventListener('click',async()=>{
  const button=$('onboarding-telegram-test'),feedback=$('onboarding-alerts-feedback');
  try{await write('/api/auth/telegram/test',{},button);feedback.textContent=words().telegramTestSent;}
  catch(error){feedback.textContent=error?.message||words().loadError;}
 });
 $('onboarding-telegram-unlink').addEventListener('click',async()=>{
  const button=$('onboarding-telegram-unlink'),feedback=$('onboarding-alerts-feedback');
  try{await write('/api/auth/telegram/unlink',{},button);
   $('onboarding-telegram-open').hidden=true;await refresh();feedback.textContent=words().telegramUnlinkedDone;
  }catch(error){feedback.textContent=error?.message||words().loadError;}
 });
 $('onboarding-registration-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const form=event.currentTarget,button=$('onboarding-register-button');
  try{
   const fields=Object.fromEntries(new FormData(form));
   const payload=validateDemoRegistration({...fields,acknowledge:form.elements.acknowledge.checked});
   await write('/api/auth/mt5-accounts',payload,button);
   form.reset();await refresh();notify(words().sentRegistration);
  }catch(error){notify(error.message||words().loadError,true);}
 });
 $('onboarding-hosting-button').addEventListener('click',async()=>{
  const button=$('onboarding-hosting-button');
  if(!$('onboarding-hosting-consent').checked){notify(words().confirmRequired,true);return;}
  const a=deriveOnboardingStatus(user,registry);
  if(!a.mayRequestHosting||!a.account){notify(words().loadError,true);return;}
  try{
   await write('/api/auth/mt5-hosting/request',{id:a.account.id,consent:true},button);
   $('onboarding-hosting-consent').checked=false;
   await refresh();notify(words().sentHosting);
  }catch(error){notify(error.message||words().loadError,true);}
 });
 localize();theme();refresh();
 const timer=setInterval(()=>{if(!document.hidden)refresh();},15000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
 window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
}
if(typeof document!=='undefined'){
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
 else init();
}
