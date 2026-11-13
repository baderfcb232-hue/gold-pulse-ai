// Read-only diagnostic. Never sends control commands or local trading settings.
const terms={
ar:{heading:'مركز مراقبة المخاطر',intro:'عرض قراءة فقط لبيانات الذهب والبيتكوين الواردة من الخادم. لا يغيّر إعدادات حسابك أو يرسل أوامر إلى MT5.',safety:'مراقبة تجريبية فقط. تفضيلات المخاطر محفوظة لكنها لا تنفّذ أو توقف أوامر MT5.',back:'العودة للوحة التحكم',limitsHeading:'حدود التداول الفعلية',limitsText:'هذه ليست إعدادات شخصية مُعتمدة. تغيير الحدود أو إيقاف التداول يحتاج صلاحيات وحفظًا مستمرًا وتأكيد EA.',loading:'جارٍ التحقق من المصدر...',ready:'آخر قراءة من الخادم. قد تختلف عن حالة حسابك الشخصي.',error:'تعذر التحقق من بيانات الخادم؛ لا تُفترض جاهزية التداول.',yes:'مفعّل',no:'غير مفعّل',unknown:'غير متاح',live:'متصل',stale:'متأخر/غير متصل',disabled:'الأصل غير مفعّل',bridgeLabel:'حالة الجسر',quoteLabel:'حالة الأسعار',pauseLabel:'إيقاف EA العام (ليس خاصًا بالمشترك)',riskLabel:'نسبة مخاطرة EA المعلنة',locale:'English'},
en:{heading:'Risk Monitoring Center',intro:'Read-only gold and Bitcoin data received from the server. No MT5 controls or account settings are changed.',safety:'Monitoring and staged preferences only. Saved limits and stop preferences DO NOT control MT5 execution.',back:'Back to dashboard',limitsHeading:'Effective trading limits',limitsText:'These are not approved personal settings. Editing limits or stopping trading needs authorization, persistence and EA confirmation.',loading:'Checking server data...',ready:'Latest server reading. This may differ from your personal account.',error:'Cannot verify server data; trading readiness must not be assumed.',yes:'Enabled',no:'Disabled',unknown:'Unavailable',live:'Connected',stale:'Stale/offline',disabled:'Market disabled',bridgeLabel:'Bridge status',quoteLabel:'Quote status',pauseLabel:'Global EA stop (not your account)',riskLabel:'EA reported risk %',locale:'العربية'}
};
const safeRate = value => typeof value==='number' && Number.isFinite(value) && value>0 && value<=100 ? value.toFixed(2)+'%' : null;
export function summarizeMarket(state,symbol,now=Date.now()/1000) {
 const data=state?.controls?.[symbol];
 if(!data)return {bridge:'disabled',quote:'unknown',pause:null,risk:null};
 const bridgeFresh=data.terminalConnected===true&&Number.isFinite(data.bridgeReceivedAt)&&data.bridgeReceivedAt<=now+5&&now-data.bridgeReceivedAt<=10;
 const quoteFresh=data.connection==='LIVE'&&Number.isFinite(data.lastUpdate)&&data.lastUpdate<=now+5&&now-data.lastUpdate<=20;
 const pause=bridgeFresh ? (typeof data.bot?.emergency_stop==='boolean'?data.bot.emergency_stop:
   typeof data.ea?.emergency_stop==='boolean'?data.ea.emergency_stop:null) : null;
 return {bridge:bridgeFresh?'live':'stale',quote:quoteFresh?'live':'stale',pause,risk:safeRate(data.execution?.risk_percent)};
}
if(typeof document!=='undefined'){
 let lang='ar';const t=()=>terms[lang];
 const translated=['heading','intro','safety','back','limitsHeading','limitsText'];
 function paintText(){
  document.documentElement.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';
  for(const id of translated)document.getElementById(id).textContent=t()[id];
  document.getElementById('locale').textContent=t().locale;
  for(const label of document.querySelectorAll('[data-key]'))label.textContent=t()[label.dataset.key];
 }
 async function refresh(){
  document.getElementById('status').textContent=t().loading;
  try{
   const response=await fetch('/api/state',{cache:'no-store',credentials:'same-origin'});
   if(!response.ok)throw Error('STATE_UNAVAILABLE');
   const state=await response.json();
   if(!state||!Number.isFinite(state.serverTime)||!state.controls)throw Error('INVALID_STATE');
   for(const symbol of ['XAUUSD','BTCUSD']){
    const serverAge=Math.abs(Date.now()/1000-state.serverTime);
    const summary=serverAge<=30?summarizeMarket(state,symbol,Date.now()/1000):{bridge:'stale',quote:'stale',pause:null,risk:null};
    const card=document.querySelector('[data-market="'+symbol+'"]');
    const status=val=>val==='live'?t().live:val==='stale'?t().stale:val==='disabled'?t().disabled:t().unknown;
    for(const [field,val] of Object.entries({bridge:status(summary.bridge),quote:status(summary.quote),
      pause:summary.pause===null?t().unknown:summary.pause?t().yes:t().no,risk:summary.risk||t().unknown}))
      card.querySelector('[data-field="'+field+'"]').textContent=val;
   }
   document.getElementById('status').textContent=t().ready;
  }catch{
   for(const el of document.querySelectorAll('[data-field]'))el.textContent=t().unknown;
   document.getElementById('status').textContent=t().error;
  }
 }
 document.getElementById('locale').addEventListener('click',()=>{lang=lang==='ar'?'en':'ar';paintText();refresh();});
 paintText();refresh();
}
