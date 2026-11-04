/* Local-only UI translation. No remote translation service, no API payload changes.
   Static source text and safety notices have exact English translations. */
import {dashboardStaticEnglish} from './dashboard-static-en.js';
import {accountStaticEnglish} from './account-static-en.js';
import {attributeStaticEnglish} from './attribute-static-en.js';
import {localeOf,translations} from './i18n-core.js';

const corePairs=Object.fromEntries(Object.keys(translations.ar).map(k=>[translations.ar[k],translations.en[k]]));
const en=Object.freeze({...corePairs,...dashboardStaticEnglish,...accountStaticEnglish,...attributeStaticEnglish});
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
  if(!matching)return raw; // Do not suppress unknown server/trading safety explanations.
  return raw.replace(trim,matching);
}
export function translateStaticUi(root,locale=currentLocale()){
  if(!root||typeof document==='undefined'||typeof document.createTreeWalker!=='function')return;
  const lang=localeOf(locale);
  const walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  let node;
  while((node=walk.nextNode())){
    if(skipTags.has(node.parentElement?.tagName)||node.parentElement?.closest?.('[data-nabd-no-translate]'))continue;
    const original=originals.get(node)??node.nodeValue;
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
      const original=stored[name]??value;
      if(!original||!/[؀-ۿ]/.test(original))continue;
      if(!attrs.has(el))attrs.set(el,{});
      attrs.get(el)[name]=original;
      const next=lang==='en'?translateUiText(original,lang):original;
      if(value!==next)el.setAttribute(name,next);
    }
  }
}
export const staticTranslationCoverage=Object.freeze({
 dashboard:Object.keys(dashboardStaticEnglish).length,
 account:Object.keys(accountStaticEnglish).length,
 attributes:Object.keys(attributeStaticEnglish).length
});
