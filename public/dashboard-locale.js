/* NABD unified visual language selection. This module never changes prices or trading requests. */
import {t,layoutFor} from '/i18n-core.js';
import {translateStaticUi,translateUiText,observeLocaleUi} from '/i18n-dom.js?v=v2-i18n-3';
(function(){
 'use strict';
 const key='nabd:dashboard:language',marketing='nabd-marketing-language';
 const originalPageTitle=document.title;
 const pairs=[
  ['[data-view="overview"] span','الرئيسية','Overview'],
  ['[data-view="signals"] span','التوصيات','Signals'],
  ['[data-view="positions"] span','الصفقات','Trades'],
  ['[data-view="news"] span','الأخبار','News'],
  ['[data-view="results"] span','النتائج','Results'],
  ['[data-view="settings"] span','الربط','Connection'],
  ['.market-toolbar h2','تابع السوق وراقب الفرصة','Monitor markets and opportunities'],
  ['.market-toolbar .live-refresh','تحديث الواجهة كل ثانية','Live market updates'],
  ['.featured-signal .card-heading h2','بطاقة التوصية','Signal overview'],
  ['#live-chart-card .card-heading h2','شارت MT5 للذهب','MT5 market chart'],
  ['.live-quote-card .card-heading h2','الذهب / دولار','Gold / USD'],
  ['[data-panel="signals"] .card-heading h2','فرص المضاربة','Trading opportunities'],
  ['[data-panel="positions"] .card-heading h2','حالة الدخول التلقائي','Automated entry status'],
  ['[data-panel="news"] .card-heading h2','الأخبار الواردة','Market headlines'],
  ['[data-panel="results"] .card-heading h2','نتائج متابعة الإشارات','Signal tracking results'],
  ['.nav-footer .theme-picker label','المظهر','Appearance'],
  ['.nav-footer [value="light"]','فاتح','Light'],
  ['.nav-footer [value="dark"]','داكن','Dark'],
  ['.nav-footer [value="system"]','النظام','System'],
  ['[data-panel="signals"] #scalp-history-date [value="TWO_DAYS"]','اليوم وأمس','Today + yesterday'],
  ['[data-panel="signals"] #scalp-history-date [value="TODAY"]','اليوم','Today'],
  ['[data-panel="signals"] #scalp-history-date [value="YESTERDAY"]','أمس','Yesterday'],
  ['[data-panel="signals"] #scalp-history-date [value="ALL"]','كل السجل','Full history'],
  ['#signal-date-filter [value="TWO_DAYS"]','اليوم وأمس','Today + yesterday'],
  ['#signal-date-filter [value="TODAY"]','اليوم','Today'],
  ['#signal-date-filter [value="YESTERDAY"]','أمس','Yesterday'],
  ['#signal-date-filter [value="ALL"]','كل السجل','Full history']
 ];
 const viewLabels={overview:['نظرة السوق','Market overview'],signals:['التوصيات','Trading signals'],positions:['الصفقات','Trades'],news:['الأخبار الاقتصادية','Economic news'],results:['النتائج','Results'],settings:['الإعدادات والربط','Settings and connectivity']};
 let lang='ar';
 try{const saved=localStorage.getItem(key)||localStorage.getItem(marketing);lang=saved==='en'?'en':'ar'}catch{}
 function translate(){
  const layout=layoutFor(lang);
  document.documentElement.lang=layout.lang;document.documentElement.dir=layout.dir;
  const chooser=document.getElementById('dashboard-language-choice');
  if(chooser){const ar=chooser.querySelector('[value="ar"]'),en=chooser.querySelector('[value="en"]');if(ar)ar.textContent=t('lang.ar',lang);if(en)en.textContent=t('lang.en',lang);}
  for(const [selector,arabic,english]of pairs){
    const el=document.querySelector(selector);if(el&&el.textContent!==(lang==='en'?english:arabic))
      el.textContent=lang==='en'?english:arabic;
  }
  const choice=document.getElementById('dashboard-language-choice');if(choice)choice.value=lang;
  const selected=document.querySelector('.nav-button.selected')?.dataset.view||'overview';
  const h=document.getElementById('view-title'),label=viewLabels[selected];
  if(h&&label&&h.textContent!==(lang==='en'?label[1]:label[0]))h.textContent=lang==='en'?label[1]:label[0];
  translateStaticUi(document.body,lang);
  document.title=lang==='en'?translateUiText(originalPageTitle,lang):originalPageTitle;
  if(typeof CustomEvent==='function')document.dispatchEvent(new CustomEvent('nabd:language-change',{detail:{lang}}));
 }
 function init(){
  const choice=document.getElementById('dashboard-language-choice');
  if(choice){
    choice.value=lang;
    choice.addEventListener('change',()=>{
      lang=choice.value==='en'?'en':'ar';
      try{localStorage.setItem(key,lang);localStorage.setItem(marketing,lang)}catch{}
      translate();
    });
  }
  document.querySelector('.nav')?.addEventListener('click',event=>{
    if(event.target.closest('[data-view]'))queueMicrotask(translate);
  });
  translate();
  observeLocaleUi(document.body);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
