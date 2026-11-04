/* Shared account language controls. Presentation only, no authentication requests. */
import {layoutFor,t} from './i18n-core.js';
import {translateStaticUi,translateUiText,observeLocaleUi} from './i18n-dom.js?v=v2-i18n-4';
const key='nabd:dashboard:language',marketing='nabd-marketing-language';
const option=document.getElementById('portal-language-choice');
const originalTitle=document.title;
let lang='ar';
try{lang=(localStorage.getItem(key)||localStorage.getItem(marketing))==='en'?'en':'ar'}catch{}
function apply(){
  const layout=layoutFor(lang);
  document.documentElement.lang=layout.lang;
  document.documentElement.dir=layout.dir;
  if(option){
    option.value=lang;
    option.querySelector('[value="ar"]').textContent=t('lang.ar',lang);
    option.querySelector('[value="en"]').textContent=t('lang.en',lang);
  }
  translateStaticUi(document.body,lang);
  document.title=lang==='en'?translateUiText(originalTitle,lang):originalTitle;
  document.dispatchEvent?.(new CustomEvent('nabd:language-change',{detail:{lang}}));
}
option?.addEventListener('change',()=>{
  lang=option.value==='en'?'en':'ar';
  try{localStorage.setItem(key,lang);localStorage.setItem(marketing,lang)}catch{}
  apply();
});
apply();
observeLocaleUi(document.body);
