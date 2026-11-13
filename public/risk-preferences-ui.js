// Account-specific STAGED risk preferences; never sends an MT5 command.
// Do not treat a persisted "paused" preference as an enforced emergency stop.
const numeric=['riskPercent','maxDailyLoss','maxDailyTrades','maxOpenPositions','maxSpread','maxSlippage','quoteMaxAgeSeconds'];
const defaults = Object.freeze({riskPercent:0.4,maxDailyLoss:2,maxDailyTrades:6,maxOpenPositions:2,maxSpread:80,maxSlippage:10,quoteMaxAgeSeconds:5,paused:true});
export function riskPreferencePayload(values) {
 const obj={accountId:String(values.accountId||''),symbol:values.symbol,paused:values.paused===true};
 for(const k of numeric){if(typeof values[k]!=='string'||!values[k].trim())throw Error('Missing: '+k);obj[k]=Number(values[k]);}
 if(Object.values(obj).some(v=>typeof v==='number'&&!Number.isFinite(v)))throw Error('Invalid numeric preference');
 return obj;
}
const request=async (path,opts={})=>{
 const res=await fetch(path,{cache:'no-store',credentials:'same-origin',...opts});
 if(!res.ok)throw Error('HTTP_'+res.status);
 return res.json();
};
if(typeof document!=='undefined'){
 const form=document.getElementById('prefs-form'),status=document.getElementById('prefs-status');
 const accountSelect=form.elements.namedItem('accountId'),marketSelect=form.elements.namedItem('symbol');
 let csrf='',saved=[],busy=false;
 const notice=message=>{status.textContent=message;};
 const current=()=>saved.find(p=>p.accountId===accountSelect.value&&p.symbol===marketSelect.value);
 function loadValues(){
   const p=current();
   for(const key of numeric)form.elements.namedItem(key).value=p?.[key]??defaults[key];
   form.elements.namedItem('paused').checked=p?.paused??defaults.paused;
   notice(p?'Saved preferences only — NOT applied to MT5 / إعدادات محفوظة وغير مطبّقة على MT5':
     'New staged preferences — NOT applied to MT5 / تفضيلات جديدة غير مطبقة');
 }
 async function reload(){
   form.hidden=true;
   const me=await request('/api/auth/me');
   if(!me.user||!me.csrf){notice('سجّل الدخول من صفحة حسابي أولاً / Sign in to your account first.');return;}
   csrf=me.csrf;
   const [accounts,prefs]=await Promise.all([
      request('/api/auth/mt5-accounts'),request('/api/auth/risk-preferences')
   ]);
   saved=Array.isArray(prefs.preferences)?prefs.preferences:[];
   accountSelect.replaceChildren();
   for(const account of accounts.accounts||[]){
      if(account.environment!=='demo')continue;
      const option=document.createElement('option');
      option.value=account.id;
      option.textContent=[account.broker,account.server_name,account.login,'Demo'].join(' · ');
      accountSelect.append(option);
   }
   if(!accountSelect.options.length){notice('لا يوجد حساب Demo مسجّل / No registered Demo account.');return;}
   form.hidden=false;
   loadValues();
 }
 accountSelect.addEventListener('change',loadValues);
 marketSelect.addEventListener('change',loadValues);
 form.addEventListener('submit',async event=>{
   event.preventDefault();
   if(busy||!csrf||!form.reportValidity())return;
   const raw={accountId:accountSelect.value,symbol:marketSelect.value,
       paused:form.elements.namedItem('paused').checked};
   for(const key of numeric)raw[key]=form.elements.namedItem(key).value;
   let payload;try{payload=riskPreferencePayload(raw);}catch{notice('Missing/invalid fields / بيانات ناقصة أو غير صحيحة');return;}
   busy=true;form.querySelector('[type=submit]').disabled=true;
   try{
      const result=await request('/api/auth/risk-preferences',{method:'POST',
        headers:{'Content-Type':'application/json','X-NABD-CSRF':csrf},
        body:JSON.stringify(payload)});
      if(result.saved!==true||result.connectedToExecution!==false)throw Error('Unexpected server response');
      saved=saved.filter(p=>p.accountId!==payload.accountId||p.symbol!==payload.symbol).concat(payload);
      notice('حُفظت تفضيلات تجريبية فقط. MT5 لم يتغير / Saved STAGED only; MT5 unchanged.');
   }catch{notice('لم يتم تأكيد الحفظ. راجع الجلسة وحاول مجددًا / Save not confirmed.');}
   finally{busy=false;form.querySelector('[type=submit]').disabled=false;}
 });
 reload().catch(()=>notice('تعذر تحميل إعدادات حسابك / Account preferences unavailable.'));
}
