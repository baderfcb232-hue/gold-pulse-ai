// NABD Phase 13: authenticated, read-only notification bell; actions only update
// the current member's own notification status. Never sends any trading command.
const byId=id=>document.getElementById(id);
const ui={
 host:byId('nabd-inbox-host'),button:byId('nabd-inbox-bell'),
 count:byId('nabd-inbox-count'),panel:byId('nabd-inbox-panel'),
 title:byId('nabd-inbox-title'),close:byId('nabd-inbox-close'),
 type:byId('nabd-inbox-type'),market:byId('nabd-inbox-market'),
 state:byId('nabd-inbox-state'),list:byId('nabd-inbox-list'),
 status:byId('nabd-inbox-status'),more:byId('nabd-inbox-more'),
 subtitle:byId('nabd-inbox-subtitle')
};
const options={
 type:['ALL','GOLD_SIGNAL','BTC_SIGNAL','TRADE_EXECUTED','TRADE_REJECTED','TP_HIT','SL_HIT',
 'MT5_DISCONNECTED','MT5_RECONNECTED','MT5_STATUS','DAILY_LOSS',
 'SUBSCRIPTION_EXPIRING','SUBSCRIPTION_EXPIRED'],
 market:['ALL','XAUUSD','BTCUSD'],
 state:['active','unread','read','archived']
};
const dictionary={
 ar:{bell:'الإشعارات',title:'مركز الإشعارات',close:'إغلاق',subtitle:'إشعارات حسابك فقط؛ لا تعني تنفيذ صفقة دون إثبات.',
   empty:'لا توجد إشعارات مطابقة',login:'سجّل الدخول من حسابي لعرض إشعاراتك الخاصة.',
   unavailable:'خدمة الإشعارات غير متاحة حاليًا.',more:'عرض المزيد',read:'مقروء',unread:'غير مقروء',
   archive:'أرشفة',restore:'استعادة',delete:'حذف',type:'نوع الإشعار',market:'السوق',state:'الحالة',
   ALL:'الكل',active:'الحديثة',archived:'المؤرشفة',GOLD_SIGNAL:'توصيات الذهب',
   BTC_SIGNAL:'توصيات البيتكوين',TRADE_EXECUTED:'تنفيذ صفقة',TRADE_REJECTED:'رفض صفقة',
   TP_HIT:'وصول الهدف',SL_HIT:'وقف الخسارة',MT5_DISCONNECTED:'انقطاع MT5',
   MT5_RECONNECTED:'عودة MT5',MT5_STATUS:'حالة MT5',DAILY_LOSS:'الخسارة اليومية',
   SUBSCRIPTION_EXPIRING:'الاشتراك يوشك أن ينتهي',SUBSCRIPTION_EXPIRED:'اشتراك منتهي',
   statusRead:'مقروء',statusUnread:'غير مقروء',detail:'التفاصيل'},
 en:{bell:'Notifications',title:'Notification center',close:'Close',
   subtitle:'Private account events only. A signal does not confirm a filled trade.',
   empty:'No matching notifications',login:'Sign in to your account to see private notifications.',
   unavailable:'Notifications are currently unavailable.',more:'Load more',read:'Mark read',
   unread:'Mark unread',archive:'Archive',restore:'Restore',delete:'Delete',
   type:'Notification type',market:'Market',state:'Status',ALL:'All',active:'Recent',
   archived:'Archived',GOLD_SIGNAL:'Gold signals',BTC_SIGNAL:'Bitcoin signals',
   TRADE_EXECUTED:'Trade executed',TRADE_REJECTED:'Trade rejected',TP_HIT:'Target reached',
   SL_HIT:'Stop loss reached',MT5_DISCONNECTED:'MT5 disconnected',
   MT5_RECONNECTED:'MT5 reconnected',MT5_STATUS:'MT5 status',DAILY_LOSS:'Daily loss',
   SUBSCRIPTION_EXPIRING:'Subscription expiring',SUBSCRIPTION_EXPIRED:'Subscription expired',
   statusRead:'Read',statusUnread:'Unread',detail:'Details'}
};
let csrf='',signedIn=false,userId=null,sessionGeneration=0,items=[],offset=0,nextOffset=null,busy=false;
const currentLang=()=>document.documentElement.lang?.toLowerCase().startsWith('en')?'en':'ar';
const tr=key=>(dictionary[currentLang()][key]||key);
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
async function request(path,payload){
 const res=await fetch(path,{method:payload===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',
 headers:payload===undefined?{}:{'Content-Type':'application/json','X-NABD-CSRF':csrf},
 ...(payload===undefined?{}:{body:JSON.stringify(payload)})});
 if(!res.ok)throw Object.assign(Error('HTTP '+res.status),{status:res.status});
 return res.json();
}
async function refreshSession(){
 const me=await request('/api/auth/me');
 const next=me.user?.id&&me.csrf?me.user.id:null;
 if(next!==userId){
   items=[];offset=0;nextOffset=null;updateCount(0);
   userId=next;sessionGeneration++;render();
 }
 signedIn=Boolean(next);csrf=next?me.csrf:'';
}
function translate(){
 ui.button.setAttribute('aria-label',tr('bell'));
 ui.title.textContent=tr('title');ui.close.setAttribute('aria-label',tr('close'));
 ui.subtitle.textContent=tr('subtitle');ui.more.textContent=tr('more');
 for(const [key,values] of Object.entries(options)){
   const select=ui[key],selected=select.value;
   const label=select.previousElementSibling;
   if(label?.tagName==='SPAN')label.textContent=tr(key);
   select.replaceChildren(...values.map(value=>{
     const option=el('option','',tr(value));option.value=value;return option;
   }));
   select.value=values.includes(selected)?selected:values[0];
 }
 render();
}
function status(message){ui.status.textContent=message;}
function updateCount(n){
 const count=Number.isFinite(n)?Math.max(0,Number(n)):0;
 ui.count.hidden=count===0;
 ui.count.textContent=count>99?'99+':String(count);
}
function render(){
 ui.list.replaceChildren();
 if(items.length===0){ui.list.append(el('p','nabd-inbox-empty',tr('empty')));}
 for(const event of items){
   const item=el('article','nabd-inbox-item'+(event.read?'':' is-unread'));
   const title=el('strong','nabd-inbox-item-title',currentLang()==='en'?event.titleEn:event.titleAr);
   const meta=el('small','',[
     event.market||tr('MT5_STATUS'),event.read?tr('statusRead'):tr('statusUnread'),
     new Intl.DateTimeFormat(currentLang()==='en'?'en-GB':'ar-PS',
       {dateStyle:'short',timeStyle:'short',timeZone:'Asia/Gaza'}).format(event.createdAt*1000)
   ].join(' · '));
   const details=el('details','nabd-inbox-detail');
   details.append(el('summary','',tr('detail')),
     el('p','',currentLang()==='en'?event.bodyEn:event.bodyAr));
   const controls=el('div','nabd-inbox-actions');
   const actions=[event.read?'unread':'read',event.archived?'restore':'archive','delete'];
   for(const action of actions){
     const button=el('button','nabd-inbox-action',tr(action));
     button.type='button';button.onclick=()=>mutate(event.id,action);
     controls.append(button);
   }
   item.append(title,meta,details,controls);
   ui.list.append(item);
 }
 ui.more.hidden=nextOffset==null;
}
async function load(reset=true){
 if(!signedIn)return;
 if(busy)return;
 busy=true;
 ui.more.disabled=true;
 try{
   const params=new URLSearchParams({type:ui.type.value,market:ui.market.value,
     state:ui.state.value,limit:'20',offset:String(reset?0:offset)});
   const generation=sessionGeneration;
   const data=await request('/api/auth/notifications?'+params.toString());
   if(generation!==sessionGeneration)return;
   if(!Array.isArray(data.items))throw Error('Invalid inbox response');
   items=reset?data.items:items.concat(data.items);
   nextOffset=data.nextOffset;
   offset=nextOffset??0;
   updateCount(data.unreadCount);
   status('');
   render();
 }catch(error){
   status(error.status===401?tr('login'):tr('unavailable'));
   if(error.status===401){signedIn=false;userId=null;csrf='';sessionGeneration++;items=[];updateCount(0);render();}
 }finally{busy=false;ui.more.disabled=false;}
}
async function mutate(id,action){
 if(!signedIn||busy)return;
 busy=true;ui.list.setAttribute('aria-busy','true');
 try{await request('/api/auth/notifications/update',{id,action});}
 catch{status(tr('unavailable'));}
 finally{busy=false;ui.list.removeAttribute('aria-busy');}
 await load(true);
}
function toggle(open){
 ui.panel.hidden=!open;ui.button.setAttribute('aria-expanded',String(open));
 if(open){translate();if(signedIn)void load(true);else status(tr('login'));}
 else ui.button.focus();
}
ui.button.onclick=async()=>{
 if(!ui.panel.hidden){toggle(false);return;}
 // Do not display cached private data while session identity is rechecked.
 signedIn=false;items=[];nextOffset=null;updateCount(0);render();
 toggle(true);
 try{
   await refreshSession();
   if(signedIn)await load(true);else status(tr('login'));
 }catch{status(tr('unavailable'));}
};
ui.close.onclick=()=>toggle(false);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!ui.panel.hidden)toggle(false);});
document.addEventListener('pointerdown',e=>{
 if(!ui.panel.hidden&&!ui.host.contains(e.target))toggle(false);
});
for(const name of ['type','market','state'])ui[name].onchange=()=>void load(true);
ui.more.onclick=()=>void load(false);
document.addEventListener('nabd:language-change',translate);
async function init(){
 translate();
 try{await refreshSession();if(signedIn)await load(true);}
 catch{status(tr('unavailable'));}
 // Refetch session on every tick to avoid exposing the previous account's inbox
 // after login/logout in a different tab.
 setInterval(async()=>{
   if(document.hidden)return;
   try{await refreshSession();if(signedIn)await load(true);}
   catch{signedIn=false;userId=null;csrf='';sessionGeneration++;items=[];updateCount(0);render();}
 },30000);
}
void init();
