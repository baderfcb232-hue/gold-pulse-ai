/* NABD phase 11 — read-only member onboarding states.
 * No MT5 password, investor password, VPS provisioning or trading permissions.
 * Only broker registration/hosting statuses returned by the authenticated API. */
export const SUPPORTED_BROKERS=Object.freeze([{id:'JustMarkets',label:'JustMarkets',environment:'demo',available:true}]);
export const MONITORING_STATUSES=Object.freeze(['NOT_APPROVED','NOT_ISSUED','AWAITING_WORKER','STALE','MT5_OFFLINE','OBSERVED_DEMO']);
const HOSTING_STATUSES=new Set(['NOT_REQUESTED','REQUESTED','APPROVED','REJECTED']);
export function validateDemoRegistration({broker,server,login,environment,acknowledge}={}){
 if(broker!=='JustMarkets'||environment!=='demo'||typeof server!=='string'||
   !/^JustMarkets-Demo[0-9]{0,5}$/.test(server)||typeof login!=='string'||
   !/^[1-9][0-9]{3,15}$/.test(login)||acknowledge!==true)
  throw new RangeError('Only JustMarkets Demo metadata is currently supported');
 return {broker,server,login,environment,acknowledge:true};
}
export function deriveOnboardingStatus(user,record){
 const first=Array.isArray(record?.accounts)?record.accounts[0]:null;
 const registered=Boolean(first);
 const hosting=HOSTING_STATUSES.has(first?.hosting_status)?first.hosting_status:'NOT_REQUESTED';
 const monitor=MONITORING_STATUSES.includes(first?.monitoring_status)?first.monitoring_status:'NOT_ISSUED';
 let phase='SIGN_IN';
 if(user){
  if(!registered)phase='REGISTER_DEMO';
  else if(hosting==='NOT_REQUESTED'||hosting==='REJECTED')phase='REQUEST_HOSTING';
  else if(hosting==='REQUESTED')phase='ADMIN_REVIEW';
  else if(monitor==='NOT_ISSUED')phase='WORKER_SETUP';
  else if(monitor==='AWAITING_WORKER')phase='AWAITING_HEARTBEAT';
  else if(monitor==='STALE')phase='STALE';
  else if(monitor==='MT5_OFFLINE')phase='MT5_OFFLINE';
  else if(monitor==='OBSERVED_DEMO')phase='MONITORING_ONLY';
 }
 return {
  phase,account:first||null,
  steps:{signin:Boolean(user),register:registered,hosting:hosting==='REQUESTED'||hosting==='APPROVED',
   approved:hosting==='APPROVED',monitoring:hosting==='APPROVED'&&monitor==='OBSERVED_DEMO'},
  hostingStatus:hosting,monitoringStatus:monitor,
  mayRegister: Boolean(user&&!registered),
  mayRequestHosting: Boolean(user&&registered&&first?.broker==='JustMarkets'&&
    first.environment==='demo'&&(hosting==='NOT_REQUESTED'||hosting==='REJECTED')),
  canObserveDemo:hosting==='APPROVED'&&monitor==='OBSERVED_DEMO',
  accountScoped: Boolean(user&&registered),
  // A worker heartbeat is monitoring, NOT per-member trading authorization.
  connectionVerifiedForTrading:false,
  tradingEnabled:false,
  requiresOwnVps:false
 };
}
export function statusLabel(phase,lang='ar'){
 const texts={
  SIGN_IN:['سجّل الدخول للبدء','Sign in to start'],
  REGISTER_DEMO:['سجّل معلومات حساب JustMarkets Demo','Register your JustMarkets Demo account'],
  REQUEST_HOSTING:['اطلب استضافة الحساب على سيرفر نبض المركزي','Request central NABD hosting'],
  ADMIN_REVIEW:['طلبك قيد مراجعة الإدارة، ولا يوجد اتصال بعد','Administrative review pending; not connected'],
  WORKER_SETUP:['تمت الموافقة على التجهيز؛ بانتظار إعداد مراقب Windows','Provisioning approved; waiting for Windows monitor setup'],
  AWAITING_HEARTBEAT:['تم تجهيز المراقبة؛ بانتظار أول تقرير من Windows MT5','Monitor created; waiting for Windows MT5 heartbeat'],
  STALE:['تقارير مراقب Windows متأخرة؛ لا يوجد اتصال حديث مؤكد','Windows monitor heartbeat stale; no recent connection proof'],
  MT5_OFFLINE:['مراقب Windows يرسل، لكن حساب MT5 غير متصل','Windows monitor is online but MT5 account is offline'],
  MONITORING_ONLY:['تم رصد اتصال JustMarkets Demo — المراقبة فقط، التداول غير مفعّل','JustMarkets Demo observed — monitoring only; trading disabled']
 };
 return (texts[phase]||texts.SIGN_IN)[lang==='en'?1:0];
}
