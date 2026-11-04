/* Local-only UI translation. No remote translation service, no API payload changes.
   Static source text and safety notices have exact English translations. */
import {dashboardStaticEnglish} from './dashboard-static-en.js';
import {accountStaticEnglish} from './account-static-en.js';
import {attributeStaticEnglish} from './attribute-static-en.js';
import {runtimeStatusEnglish} from './runtime-status-en.js';
import {liveStatusEnglish} from './live-status-en.js';
import {appExtraEnglish} from './app-extra-en.js';
import {safetyStatusEnglish} from './safety-status-en.js';
import {serverStatusEnglish} from './server-status-en.js';
import {localeOf,translations} from './i18n-core.js';

const corePairs=Object.fromEntries(Object.keys(translations.ar).map(k=>[translations.ar[k],translations.en[k]]));
const en=Object.freeze({...corePairs,...dashboardStaticEnglish,...accountStaticEnglish,...attributeStaticEnglish,...runtimeStatusEnglish,...liveStatusEnglish,...appExtraEnglish,...safetyStatusEnglish,...serverStatusEnglish});
const dynamicPatterns=[
  [/^عمر السعر ([\d,.]+) ثانية$/,m=>`Quote age: ${m[1]} seconds`],
  [/^عمر آخر تيك حقيقي ([\d,.]+) ثانية$/,m=>`Last real tick age: ${m[1]} seconds`],
  [/^([\d,.]+) نقطة$/,m=>`${m[1]} points`],
  [/^([\d,.]+) دقيقة$/,m=>`${m[1]} minutes`],
  [/^([\d,.]+) إشارة · (.+)$/,m=>`${m[1]} signals · ${translateUiText(m[2],'en')}`],
  [/^([\d,.]+) شمعة مغلقة$/,m=>`${m[1]} closed candles`],
  [/^إشارة (شراء|بيع) جديدة — (.+)$/,m=>`New ${translateUiText(m[1],'en')} signal — ${m[2]}`],
  [/^فرصة مضاربة (شراء|بيع) · (.+) · (.+)$/,m=>`Scalping ${translateUiText(m[1],'en')} opportunity · ${translateUiText(m[2],'en')} · ${m[3]}`],
  [/^تم تحديث شموع (.+) من (.+) بنجاح\.$/,m=>`Candles updated successfully: ${m[1]} · ${m[2]}`],
  [/^(.+) · (الذهب|البيتكوين)$/,m=>`${m[1]} · ${translateUiText(m[2],'en')}`],
  [/^(.+) · غزة$/,m=>`${m[1]} · Gaza`],
  [/^(.+) · مرجعي$/,m=>`${m[1]} · Reference`],
  [/^صدرت: (.+) · تنتهي: (.+) · (.+)$/,m=>`Issued: ${m[1]} · Expires: ${m[2]} · ${m[3]}`],
  [/^بعد (\d+)س (\d+)د$/,m=>`In ${m[1]}h ${m[2]}m`],
  [/^([\d,.]+) من (\d+) مراحل جاهزة · مصدر التوصية: (.+)$/,m=>`${m[1]} of ${m[2]} stages ready · Signal source: ${translateUiText(m[3],'en')}`],
  [/^رقم الحساب: ([\d]+) · السيرفر: (.+)$/,m=>`Account number: ${m[1]} · Server: ${m[2]}`],
  [/^صفحة (\d+)$/,m=>`Page ${m[1]}`],
  [/^متطلبات إرسال تليجرام · (\d+) بانتظار الإكمال$/,m=>'Telegram delivery requirements · '+m[1]+' incomplete'],
  [/^متطلبات إرسال تليجرام · (.+)$/,m=>'Telegram delivery requirements · '+translateUiText(m[1],'en')],
  [/^([\d,.]+)R · قبل التكاليف$/,m=>m[1]+'R · before costs'],
  [/^(.+) · شموع مغلقة$/,m=>translateUiText(m[1],'en')+' · Closed candles'],
  [/^(.+) · توصية #(.+) · أمر MT5 #(.+)$/,m=>m[1]+' · Signal #'+m[2]+' · MT5 order #'+m[3]],
  [/^(.+) · توصية #(.+) · (.+) · لم يصدر أمر MT5$/,m=>m[1]+' · Signal #'+m[2]+' · '+translateUiText(m[3],'en')+' · No MT5 order submitted'],
  [/^(.+)% عن آخر إغلاق$/,m=>m[1]+'% since previous close'],
  [/^(.+) دقيقة مرصودة · نحتاج نحو 110 دقائق متصلة لتأكيد اتجاه M5\.$/,m=>m[1]+' minutes observed · approximately 110 continuous minutes are needed to confirm the M5 trend.'],
  [/^ننتظر تحميل ([\d,.]+) شمعة مغلقة لكل إطار من البروكر؛ لا يلزم تجميعها من الصفر\.$/,m=>'Waiting for '+m[1]+' closed broker candles per timeframe; they do not need to be rebuilt from scratch.'],
  [/^الإشارة صدرت (.+) ومستوياتها ثابتة\. الشروط الحالية لفرصة جديدة: (.+)$/,m=>'Signal issued '+m[1]+'. Its levels are fixed. New opportunity conditions: '+translateUiText(m[2],'en')],
  [/^متوسط سعر الشراء والبيع لـ (.+)\. التحليل يستخدم شموع البروكر المغلقة؛ تاريخها يصل من الجسر دون انتظار تجميع جديد\.$/,m=>'Average broker Bid/Ask price for '+m[1]+'. Analysis uses closed broker candles, whose history arrives through the bridge.'],
  [/^اللوت المقترح: (.+) · ميزانية المخاطرة: (.+) · خسارة الوقف المقدّرة: (.+) · (.+)$/,m=>'Suggested lot: '+m[1]+' · Risk budget: '+m[2]+' · Estimated stop-loss exposure: '+m[3]+' · '+translateUiText(m[4],'en')],
  [/^لا يوجد لوت آمن ضمن الميزانية: (.+)$/,m=>'No lot size meets the risk budget: '+translateUiText(m[1],'en')],
  [/^([\d,.]+) خبر · وقت غزة$/,m=>m[1]+' headlines · Gaza time'],
  [/^آخر فحص قبل ([\d,.]+) ثانية · تحديث الواجهة كل ثانية$/,m=>'Last check '+m[1]+' seconds ago · Interface refreshes every second'],
  [/^آخر وصول (.+)$/,m=>'Last received: '+m[1]],
  [/^([\d,.]+) من ([\d,.]+) مراحل جاهزة · مصدر التوصية: (.+)$/,m=>m[1]+' of '+m[2]+' stages ready · Signal source: '+translateUiText(m[3],'en')],
  [/^خسارة مقدّرة من الدخول حتى الوقف: (.+)، قبل العمولات والانزلاق\.$/,m=>'Estimated entry-to-stop loss: '+m[1]+', excluding commission and slippage.'],
  [/^اللوت المحسوب ([\d,.]+) · خسارة الستوب المقدّرة (.+)\.$/,m=>'Calculated lot: '+m[1]+' · Estimated stop-loss exposure: '+m[2]+'.'],
  [/^(.+) خسارة أقل لوت لهذه الفرصة (.+) مقابل سقف (.+)\.$/,m=>translateUiText(m[1],'en')+' Minimum-lot stop loss for this opportunity is '+m[2]+' against a risk budget of '+m[3]+'.'],
  [/^مسافة الستوب القصوى لأقل لوت ضمن السقف الحالي: (.+) من وحدات سعر الذهب، قبل التكاليف\. لا يغيّر النظام وقف الاستراتيجية ليُجبر الصفقة على الدخول\.$/,m=>'Maximum stop distance for the minimum lot under the current risk cap: '+m[1]+' gold price units, before costs. The system never moves a strategy stop to force entry.'],
  [/^سيُطلب نقل ستوب الصفقة #(.+) لسعر الدخول إذا سمحت شروط البروكر\. تكاليف الصفقة قد تجعل النتيجة غير صفرية\.$/,m=>'A request to move the stop of position #'+m[1]+' to entry will be sent if broker conditions allow. Fees may produce a non-zero outcome.'],
  [/^سيُرسل طلب (.+) #(.+) بالسعر المتاح، وينتظر تأكيد MT5\.$/,m=>'Request '+translateUiText(m[1],'en')+' for position #'+m[2]+' will be sent at the available price and awaits MT5 confirmation.'],
  [/^سجل التحليل والنتائج له نسخة استرداد في PostgreSQL بتاريخ (.+) \(كل 30 ثانية؛ قد تضيع آخر التغييرات عند انقطاع مفاجئ\)\.$/,m=>'Analysis and results have a PostgreSQL recovery snapshot from '+m[1]+' (every 30 seconds; abrupt outages may lose the latest changes).'],
  [/^Demo · حدود الخسارة وعدد الدخولات اليومية معطّلة · ستوب التوصية والهدف الأول · حساب اللوت يبدأ من (.+)% مع السماح بأقل لوت · (.+)$/,m=>'Demo · daily loss and entry-count limits disabled · signal stop and first target · lot sizing begins at '+m[1]+'% and may use the minimum lot · '+translateUiText(m[2],'en')],
  [/^(.+) · هدف الربح الصغير (.+) · مخاطرة الإعداد المحلي (.+)% · (.+)$/,m=>translateUiText(m[1],'en')+' · Small-profit target '+m[2]+' · Local configured risk '+m[3]+'% · '+translateUiText(m[4],'en')],
  [/^(.+) · وصل للموقع (.+)$/,m=>translateUiText(m[1],'en')+' · Received by site '+m[2]],
  [/^بدأت (.+) · آخر نشاط (.+)$/,m=>'Started '+m[1]+' · Last activity '+m[2]],
  [/^المنفّذ: (.+)$/,m=>'Performed by: '+m[1]],
  [/^(.+) · آخر نسخة ناجحة: (.+)$/,m=>translateUiText(m[1],'en')+' · Last successful backup: '+m[2]],
  [/^(.+) \| نبض$/,m=>translateUiText(m[1],'en')+' | NABD'],
  [/^شارت (.+)$/,m=>'Chart '+m[1]],
  [/^(.+) · متابعة افتراضية$/,m=>m[1]+' · Simulated tracking']
  [/^متبقٍ نحو (\d+) ثانية لاستلام الأمر\. لا تعِد إرساله\.$/,m=>'About '+m[1]+' seconds remain to receive the command. Do not resend it.'],
  [/^(الذهب|البيتكوين): توقف وصول بيانات جسر MT5 لأكثر من دقيقة\. حالة الأصل الآخر مستقلة\.$/,m=>translateUiText(m[1],'en')+': MT5 bridge data has stopped for over a minute. The other asset has a separate status.'],
  [/^(الذهب|البيتكوين): جسر MT5 متصل لكن نبض البوت قديم أو غير متاح؛ أوامر التحكم معلّقة لهذا الأصل\.$/,m=>translateUiText(m[1],'en')+': The MT5 bridge is connected but bot heartbeat is stale or unavailable. Controls for this asset are suspended.'],
  [/^آخر سجل MT5 يحتوي على (\d+) من صفقات البوت\. اضغط الزر لفحص شروط الإغلاق وإرسال الأمر بعد التأكيد\.$/,m=>'Latest MT5 history reports '+m[1]+' bot positions. Select the button to check close conditions and submit after confirmation.'],
  [/^آخر أسعار مسجلة · (.+)$/,m=>'Recent price history · '+translateUiText(m[1],'en')],
  [/^آخر فحص قبل (\d+) ثانية$/,m=>'Last checked '+m[1]+' seconds ago'],
  [/^لا يوجد سعر حقيقي قبل (.+)$/,m=>'No real price before '+m[1]],
  [/^بيانات الشموع الحديثة (.+)$/,m=>'Recent candle data '+m[1]],
  [/^(.+) · ([\d,.]+) شمعة مغلقة$/,m=>translateUiText(m[1],'en')+' · '+m[2]+' closed candles'],
  [/^رسالة الخطأ: (.+)$/,m=>'Error message: '+translateUiText(m[1],'en')]
  [/^آخر تحديث (.+)$/,m=>`Last updated: ${m[1]}`]
];
const originals=new WeakMap(),attrs=new WeakMap();
const skipTags=new Set(['SCRIPT','STYLE','NOSCRIPT','CODE','PRE','SVG','CANVAS','TEXTAREA']);
export function currentLocale(){
  if(typeof document!=='undefined'&&document.documentElement?.lang==='en')return 'en';
  return 'ar';
}
export function translateUiText(value,locale=currentLocale()){
  if(value===null||value===undefined)return value;
  if(localeOf(locale)!=='en')return String(value);
  const raw=String(value),trim=raw.trim();
  if(!trim)return raw;
  const matching=en[trim];
  if(matching)return raw.replace(trim,matching);
  for(const [pattern,format]of dynamicPatterns){
    const found=trim.match(pattern);
    if(found)return raw.replace(trim,format(found));
  }
  return raw; // Do not suppress unknown server/trading safety explanations.
}
export function translateStaticUi(root,locale=currentLocale()){
  if(!root||typeof document==='undefined'||typeof document.createTreeWalker!=='function')return;
  const lang=localeOf(locale);
  const walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  let node;
  while((node=walk.nextNode())){
    if(skipTags.has(node.parentElement?.tagName)||node.parentElement?.closest?.('[data-nabd-no-translate]'))continue;
    const current=node.nodeValue;
    const prior=originals.get(node);
    // Real-time feeds can reuse a text node; a fresh Arabic value supersedes the old original.
    const original=current&&/[؀-ۿ]/.test(current)&&current!==prior?current:prior??current;
    if(!original||!/[؀-ۿ]/.test(original))continue;
    originals.set(node,original);
    const next=lang==='en'?translateUiText(original,lang):original;
    if(node.nodeValue!==next)node.nodeValue=next;
  }
  // Translate exact author-controlled attributes. Do not alter hrefs, values or data-*.
  const elements=[root,...(typeof root.querySelectorAll==='function'?root.querySelectorAll('*'):[])];
  for(const el of elements){
    if(!el?.getAttribute||skipTags.has(el.tagName)||el.closest?.('[data-nabd-no-translate]'))continue;
    for(const name of ['aria-label','placeholder','title','aria-description']){
      const value=el.getAttribute(name);
      const stored=attrs.get(el)||{};
      const original=value&&/[؀-ۿ]/.test(value)&&value!==stored[name]?value:stored[name]??value;
      if(!original||!/[؀-ۿ]/.test(original))continue;
      if(!attrs.has(el))attrs.set(el,{});
      attrs.get(el)[name]=original;
      const next=lang==='en'?translateUiText(original,lang):original;
      if(value!==next)el.setAttribute(name,next);
    }
  }
}
/* Translate newly rendered real-time UI nodes without rescanning the entire dashboard every tick.
   No API calls, order manipulation, or replacement of unknown safety/broker text. */
export function observeLocaleUi(root=typeof document!=='undefined'?document.body:null){
  if(!root||typeof MutationObserver==='undefined')return ()=>{};
  const pending=new Set();
  let scheduled=false,active=true;
  const flush=()=>{
    scheduled=false;
    if(!active||currentLocale()!=='en'){pending.clear();return;}
    const batch=[...pending];pending.clear();
    for(const el of batch){
      if(el?.isConnected!==false)translateStaticUi(el,currentLocale());
    }
  };
  const watch=new MutationObserver(mutations=>{
    if(currentLocale()!=='en')return;
    for(const mutation of mutations){
      if(mutation.type==='attributes'){
        pending.add(mutation.target);
      }else if(mutation.type==='characterData'){
        pending.add(mutation.target.parentElement||root);
      }else{
        for(const node of mutation.addedNodes){
          const element=node.nodeType===3?node.parentElement:node;
          if(element)pending.add(element);
        }
      }
    }
    if(pending.size&&!scheduled){scheduled=true;queueMicrotask(flush);}
  });
  watch.observe(root,{
    subtree:true,childList:true,characterData:true,attributes:true,
    attributeFilter:['aria-label','placeholder','title','aria-description']
  });
  return ()=>{active=false;watch.disconnect();pending.clear();};
}
export const staticTranslationCoverage=Object.freeze({
 dashboard:Object.keys(dashboardStaticEnglish).length,
 account:Object.keys(accountStaticEnglish).length,
 attributes:Object.keys(attributeStaticEnglish).length
});
