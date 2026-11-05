import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createApplication} from '../server.mjs';
import {dashboardStaticEnglish} from '../public/dashboard-static-en.js';
import {accountStaticEnglish} from '../public/account-static-en.js';
import {attributeStaticEnglish} from '../public/attribute-static-en.js';
import {runtimeStatusEnglish} from '../public/runtime-status-en.js';
import {liveStatusEnglish} from '../public/live-status-en.js';
import {appExtraEnglish} from '../public/app-extra-en.js';
import {translations} from '../public/i18n-core.js';
import {translateUiText,translateStaticUi,observeLocaleUi,externalHeadlineForLocale,staticTranslationCoverage} from '../public/i18n-dom.js';
import {serverStatusEnglish} from '../public/server-status-en.js';
import {safetyStatusEnglish} from '../public/safety-status-en.js';
const read=p=>readFileSync(new URL('../public/'+p,import.meta.url),'utf8');
const htmlCopy=p=>[...new Set(read(p)
  .replace(/<script[\s\S]*?<\/script>/g,'').replace(/<style[\s\S]*?<\/style>/g,'')
  .replace(/<[^>]+>/g,'\n').split('\n').map(v=>v.trim())
  .filter(v=>/[\u0600-\u06FF]/.test(v)&&v.length<400))];

test('exact English translations cover every static dashboard and account phrase',()=>{
  for(const [page,translations,expected]of [
    ['index.html',dashboardStaticEnglish,238],
    ['accounts.html',accountStaticEnglish,139]
  ]){
    const source=htmlCopy(page);
    assert.equal(source.length,expected,'source count changed: '+page);
    const catalogue={...dashboardStaticEnglish,...accountStaticEnglish,...attributeStaticEnglish};
    assert.deepEqual(source.filter(v=>!Object.hasOwn(catalogue,v)),[],'missing translations in '+page);
    assert.equal(Object.keys(translations).length,page==='accounts.html'?137:238);
    for(const translated of Object.values(translations)){
      assert.ok(typeof translated==='string'&&translated.length>0);
      assert.doesNotMatch(translated,/[\u0600-\u06FF]/,'no Arabic in English static content');
    }
  }
  assert.equal(staticTranslationCoverage.dashboard,238);
  assert.equal(staticTranslationCoverage.account,137);
  assert.equal(staticTranslationCoverage.attributes,22);
  assert.ok(Object.keys(appExtraEnglish).length>=160);
  for(const translated of Object.values({...appExtraEnglish,...liveStatusEnglish}))assert.doesNotMatch(translated,/[\u0600-\u06FF]/);
  assert.ok(Object.keys(runtimeStatusEnglish).length>=240);
  assert.ok(Object.keys(serverStatusEnglish).length>=80);
  assert.ok(Object.keys(safetyStatusEnglish).length>=95);
  for(const text of Object.values({...serverStatusEnglish,...safetyStatusEnglish}))assert.doesNotMatch(text,/[\u0600-\u06FF]/);
  for(const value of Object.values(runtimeStatusEnglish))assert.doesNotMatch(value,/[\u0600-\u06FF]/);
  for(const path of ['index.html','accounts.html']){
    const attrs=[...read(path).matchAll(/(?:aria-label|placeholder|title|aria-description)="([^"]+)"/g)].map(x=>x[1]).filter(x=>/[\u0600-\u06FF]/.test(x));
    assert.deepEqual(attrs.filter(x=>!Object.hasOwn(attributeStaticEnglish,x)),[],path+' missing accessibility translations');
  }
});

test('localized display text never overwrites unknown trading, broker or customer values',()=>{
  assert.equal(translateUiText(' وقف الخسارة ','en'),' Stop loss ');
  assert.equal(translateUiText('نسبة المخاطرة %','en'),'Risk percentage %');
  assert.equal(translateUiText('لا توجد بيانات تقويم','en'),'No economic calendar data');
  assert.equal(translateUiText('PRICE_OR_SPREAD_MOVE','en'),'PRICE_OR_SPREAD_MOVE');
  assert.equal(translateUiText('4050.27','en'),'4050.27');
  assert.equal(translateUiText('عمر السعر 7 ثانية','en'),'Quote age: 7 seconds');
  assert.equal(translateUiText('1 ثانية','en'),'1 second');
  assert.equal(translateUiText('14 ثانية','en'),'14 seconds');
  assert.equal(translateUiText('بانتظار أول سعر','en'),'Waiting for first live quote');
  assert.equal(translateUiText('بانتظار المصادر.','en'),'Waiting for news sources.');
  assert.equal(translateUiText('شارت الذهب','en'),'Gold chart');
  assert.equal(translateUiText('شارت البيتكوين','en'),'Bitcoin chart');
  assert.equal(translateUiText('شموع مغلقة من مصدر السعر','en'),'Closed candles from the source');
  assert.match(translateUiText('الذهب المرجعي يُجلب كل نحو 30 ثانية؛ الشموع من عينات السعر المتاحة. مستقل عن سعر تنفيذ بروكرك.','en'),/separate from your broker/);
  assert.match(translateUiText('بث Coinbase المباشر؛ سعر BTC-USD على المنصة. مستقل عن سعر تنفيذ بروكرك.','en'),/Coinbase live stream/);
  assert.match(read('app.js'),/translateUiText\(stage.label\).*translateUiText\(stage.detail\)/);
  assert.equal(translateUiText('4,041.51','en'),'4,041.51');
  assert.equal(translateUiText('المس الشارت أو استخدم الأسهم لاستعراض السعر','en'),'Tap the chart or use arrow keys to inspect prices');
  assert.equal(translateUiText('الفحص التالي بعد 3 دقيقة حسب المصدر','en'),'Next source check in 3 minutes');
  assert.equal(translateUiText('معامل الربح: 1.75 · الإشارات المنتهية دون حسم: 4 · النتائج الفعلية تظهر في سجل MT5 أدناه.','en'),'Profit factor: 1.75 · Expired signals without a result: 4 · Actual trades are shown in the MT5 history below.');
  assert.equal(translateUiText('معامل الربح: غير قابل للتقييم · الإشارات المنتهية دون حسم: 0 · النتائج الفعلية تظهر في سجل MT5 أدناه.','en'),'Profit factor: Not assessable · Expired signals without a result: 0 · Actual trades are shown in the MT5 history below.');
  assert.equal(translateUiText('تقدير الفرصة الحالية؛ لا يؤكد اعتمادها أو تنفيذها · شراء · 10:30 · دخول 4,043.51 · وقف 4,040.20','en'),'Current opportunity estimate; not a confirmation of approval or execution · Buy · 10:30 · Entry 4,043.51 · Stop loss 4,040.20');
  assert.equal(translateUiText('تقدير آخر فرصة منتهية؛ لا يُرسل للتنفيذ · بيع · 11:42 · دخول 4,041.25 · وقف 4,043.50','en'),'Last expired opportunity estimate; not sent for execution · Sell · 11:42 · Entry 4,041.25 · Stop loss 4,043.50');
  assert.equal(translateUiText('الفحص التالي بعد 3 دقيقة حسب المصدر','ar'),'الفحص التالي بعد 3 دقيقة حسب المصدر');
  assert.equal(translateUiText('تم تحديث شموع XAUUSD من JustMarkets بنجاح.','en'),'Candles updated successfully: XAUUSD · JustMarkets');
  assert.equal(translateUiText('إشارة شراء جديدة — 4,043.51','en'),'New Buy signal — 4,043.51');
  assert.equal(translateUiText('فرصة مضاربة بيع · الذهب · 4000','en'),'Scalping Sell opportunity · Gold · 4000');
  assert.equal(translateUiText('وصلت للجسر — لم يصل تأكيد MT5','en'),'Received by bridge — MT5 has not confirmed execution');
  assert.equal(translateUiText('وقف الخسارة','ar'),'وقف الخسارة');
  assert.equal(translateUiText('السبريد 120 نقطة يتجاوز الحد 80.','en'),'Spread 120 points exceeds the permitted limit of 80.');
  assert.equal(translateUiText('انتظار توافق الاتجاه: M15 محايد، H1 بيع. لن تصدر توصية قبل توافقهما واستيفاء شروط الدخول الأخرى.','en'),'Waiting for trend alignment: M15 Neutral, H1 Sell. No signal will be issued until alignment and other entry conditions are satisfied.');
  assert.equal(translateUiText('تم إيقاف دخول صفقات جديدة.','en'),'New trade entries have been paused.');
  assert.equal(translateUiText('وقف الخسارة · الهدف الأول','en'),'Stop loss · First target');
  assert.match(externalHeadlineForLocale('المركزي الأوروبي يبقي سعر الفائدة','en'),/original source/);
  assert.doesNotMatch(externalHeadlineForLocale('المركزي الأوروبي يبقي سعر الفائدة','en'),/[\u0600-\u06FF]/);
  assert.equal(externalHeadlineForLocale('Bitcoin prices steady','en'),'Bitcoin prices steady');
  assert.equal(externalHeadlineForLocale('المركزي الأوروبي يبقي سعر الفائدة','ar'),'المركزي الأوروبي يبقي سعر الفائدة');
  assert.equal(translateUiText(null,'en'),null);
  assert.equal(translateUiText('بعد 2س 3د','en'),'In 2h 3m');
  assert.equal(translateUiText('XAUUSD · متابعة افتراضية','en'),'XAUUSD · Simulated tracking');
  assert.equal(translateUiText('عدد الشموع: 5','en'),'عدد الشموع: 5','Unrecognized server text must not be misrepresented');
  assert.equal(translateUiText('تسجيل الدخول | نبض','en'),'Sign in | NABD');
  assert.equal(translateUiText('لا يوجد لوت آمن ضمن الميزانية: بيانات الحساب قديمة؛ هذا تقدير محفوظ ويحتاج تحديث MT5.','en'),'No lot size meets the risk budget: Account data is stale; this saved estimate requires a fresh MT5 update.');
});

test('all short hard-coded dynamic Arabic UI literals have an exact, reviewed English counterpart',()=>{
  const catalogue={...Object.fromEntries(Object.keys(translations.ar).map(key=>[translations.ar[key],translations.en[key]])),
    ...dashboardStaticEnglish,...accountStaticEnglish,...attributeStaticEnglish,...runtimeStatusEnglish,
    ...liveStatusEnglish,...appExtraEnglish};
  for(const path of ['app.js','live.js','accounts.js']){
    const strings=[...read(path).matchAll(/'([^'\n]*[\u0600-\u06FF][^'\n]*)'|"([^"\n]*[\u0600-\u06FF][^"\n]*)"/g)]
      .map(m=>m[1]||m[2]).filter(v=>v.length<200&&!/[{}=;]/.test(v)&&v.trim()===v);
    const notTranslated=[...new Set(strings)].filter(value=>value!=='؟'&&!Object.hasOwn(catalogue,value));
    assert.deepEqual(notTranslated,[],path+' has untranslated static UI text');
  }
});

test('English translation remains correct across streaming updates and reverses to the original Arabic',async t=>{
  const original={document:globalThis.document,NodeFilter:globalThis.NodeFilter,MutationObserver:globalThis.MutationObserver};
  t.after(()=>{
    for(const [key,value] of Object.entries(original)){
      if(value===undefined)delete globalThis[key];else globalThis[key]=value;
    }
  });
  const attrs=new Map([['aria-label','أقسام الموقع']]);
  const el={nodeType:1,tagName:'DIV',isConnected:true,
    getAttribute:k=>attrs.get(k)??null,setAttribute:(k,v)=>attrs.set(k,v),
    querySelectorAll:()=>[],closest:()=>false};
  const text={nodeType:3,nodeValue:'الذهب',parentElement:el,isConnected:true};
  let callback;
  class Watcher{
    constructor(fn){callback=fn;}
    observe(target,config){assert.equal(target,el);assert.ok(config.subtree);}
    disconnect(){}
  }
  globalThis.document={documentElement:{lang:'en'},createTreeWalker:()=>{let used=false;return {nextNode:()=>used?null:(used=true,text)}}};
  globalThis.NodeFilter={SHOW_TEXT:4};
  globalThis.MutationObserver=Watcher;
  translateStaticUi(el,'en');
  assert.equal(text.nodeValue,'Gold');
  assert.equal(attrs.get('aria-label'),'Site sections');
  translateStaticUi(el,'ar');
  assert.equal(text.nodeValue,'الذهب');
  assert.equal(attrs.get('aria-label'),'أقسام الموقع');
  translateStaticUi(el,'en');
  const stop=observeLocaleUi(el);
  text.nodeValue='وقف الخسارة';
  callback([{type:'characterData',target:text}]);
  await Promise.resolve();
  assert.equal(text.nodeValue,'Stop loss');
  text.nodeValue='بيانات قديمة';
  callback([{type:'characterData',target:text}]);
  await Promise.resolve();
  assert.equal(text.nodeValue,'Stale data');
  // Real-time updates can replace an existing text node with English, a price or a broker code.
  // Localization must not restore a cached stale Arabic label over those fresh values.
  text.nodeValue='MT5 connected';
  callback([{type:'characterData',target:text}]);
  await Promise.resolve();
  assert.equal(text.nodeValue,'MT5 connected');
  text.nodeValue='4,032.81';
  callback([{type:'characterData',target:text}]);
  await Promise.resolve();
  assert.equal(text.nodeValue,'4,032.81');
  text.nodeValue='الذهب';
  callback([{type:'characterData',target:text}]);
  await Promise.resolve();
  assert.equal(text.nodeValue,'Gold');
  stop();
  translateStaticUi(el,'ar');
  assert.equal(text.nodeValue,'الذهب');
});

test('dashboard and account translation scripts are browser modules with shared locale preference',()=>{
 const dashboard=read('index.html'),account=read('accounts.html');
 assert.match(dashboard,/dashboard-locale\.js\?v=v2-i18n-4" type="module"/);
 assert.match(account,/account-language\.js\?v=v2-i18n-4" type="module"/);
 assert.match(account,/id="portal-language-choice"/);
 assert.match(read('dashboard-locale.js'),/translateStaticUi\(document.body,lang\)/);
 assert.match(read('account-language.js'),/translateStaticUi\(document.body,lang\)/);
 for(const script of ['i18n-dom.js','dashboard-static-en.js','account-static-en.js','attribute-static-en.js','runtime-status-en.js','live-status-en.js','app-extra-en.js','safety-status-en.js','server-status-en.js','account-language.js','dashboard-locale.js']){
   const path=new URL('../public/'+script,import.meta.url).pathname;
   const result=spawnSync(process.execPath,['--check',path],{encoding:'utf8'});
   assert.equal(result.status,0,script+': '+result.stderr);
 }
 assert.doesNotMatch(read('i18n-dom.js'),/fetch\(|postMessage|WebSocket|OrderSend/);
});

test('i18n assets are public but account and trade APIs remain protected',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'nabd-complete-i18n-'));
 const app=createApplication({dataDir:dir});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;
 for(const path of ['/i18n-core.js','/i18n-dom.js','/dashboard-static-en.js','/account-static-en.js','/attribute-static-en.js','/runtime-status-en.js','/live-status-en.js','/app-extra-en.js','/safety-status-en.js','/server-status-en.js','/account-language.js']){
   const r=await fetch(base+path);assert.equal(r.status,200,path);
 }
 assert.equal((await fetch(base+'/dashboard')).status,200);
 assert.equal((await fetch(base+'/account')).status,200);
 assert.equal((await fetch(base+'/api/account')).status,401);
 assert.equal((await (await fetch(base+'/healthz')).json()).ok,true);
});
