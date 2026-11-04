/* Local-only UI translation. No remote translation service, no API payload changes.
   Static source text and safety notices have exact English translations. */
import {dashboardStaticEnglish} from './dashboard-static-en.js';
import {accountStaticEnglish} from './account-static-en.js';
import {attributeStaticEnglish} from './attribute-static-en.js';
import {runtimeStatusEnglish} from './runtime-status-en.js';
import {liveStatusEnglish} from './live-status-en.js';
import {appExtraEnglish} from './app-extra-en.js';
import {localeOf,translations} from './i18n-core.js';

const corePairs=Object.fromEntries(Object.keys(translations.ar).map(k=>[translations.ar[k],translations.en[k]]));
const en=Object.freeze({...corePairs,...dashboardStaticEnglish,...accountStaticEnglish,...attributeStaticEnglish,...runtimeStatusEnglish,...liveStatusEnglish,...appExtraEnglish});
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
