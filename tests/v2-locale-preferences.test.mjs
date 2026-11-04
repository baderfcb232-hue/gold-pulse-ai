import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const read=path=>readFileSync(new URL('../public/'+path,import.meta.url),'utf8');
const script=read('language-pref.js');

function openLanding(pathname,seed={}){
  const values=new Map(Object.entries(seed)),handlers={};
  const links=Object.fromEntries(['ar','en'].map(target=>[target,{
    getAttribute:name=>name==='data-lang-target'?target:null,
    addEventListener:(event,callback)=>{if(event==='click')handlers[target]=callback;}
  }]));
  let redirected=null,ready=null;
  const document={
    addEventListener:(event,callback)=>{if(event==='DOMContentLoaded')ready=callback;},
    querySelectorAll:selector=>selector==='[data-lang-target]'?Object.values(links):[]
  };
  const location={pathname,replace:destination=>{redirected=destination;}};
  const localStorage={
    getItem:key=>values.get(key)??null,
    setItem:(key,value)=>values.set(key,value)
  };
  runInNewContext(script,{document,location,localStorage});
  ready?.();
  return {get:key=>values.get(key),redirected,choose:lang=>handlers[lang]?.()};
}

test('marketing language choice persists identically in dashboard and account',()=>{
  const browser=openLanding('/en');
  assert.equal(browser.get('nabd-marketing-language'),'en');
  assert.equal(browser.get('nabd:dashboard:language'),'en');
  browser.choose('ar');
  assert.equal(browser.get('nabd-marketing-language'),'ar');
  assert.equal(browser.get('nabd:dashboard:language'),'ar');
});
test('dashboard locale is authoritative when an older marketing preference disagrees',()=>{
  const browser=openLanding('/',{'nabd-marketing-language':'en','nabd:dashboard:language':'ar'});
  assert.equal(browser.redirected,null);
  assert.equal(browser.get('nabd-marketing-language'),'ar');
  assert.equal(browser.get('nabd:dashboard:language'),'ar');
  browser.choose('en');
  assert.equal(browser.get('nabd:dashboard:language'),'en');
});
test('Arabic marketing entry redirects once when English preference is already saved',()=>{
  const browser=openLanding('/',{'nabd-marketing-language':'ar','nabd:dashboard:language':'en'});
  assert.equal(browser.redirected,'/en');
  const arrived=openLanding('/en',{'nabd-marketing-language':'ar','nabd:dashboard:language':'en'});
  assert.equal(arrived.redirected,null);
  assert.equal(arrived.get('nabd-marketing-language'),'en');
});

test('every live UI entry imports the exact same i18n DOM module URL',()=>{
  for(const path of ['app.js','live.js','accounts.js','dashboard-locale.js','account-language.js']){
    const match=read(path).match(/from ['"](\.?\/i18n-dom\.js\?v=[^'"]+)['"]/);
    assert.ok(match,path+' must import the shared translation module');
    assert.equal(match[1].replace(/^\.?\//,'/'),'/i18n-dom.js?v=v2-i18n-3',path+' must reuse the same module instance');
  }
});
test('language change re-renders cached signal and calendar dates without placing orders',()=>{
  const live=read('live.js'),app=read('app.js'),account=read('accounts.js');
  assert.match(live,/document\.addEventListener\('nabd:language-change',[\s\S]*?renderHistory\(\)[\s\S]*?renderNews\(\)/);
  assert.match(app,/document\.addEventListener\('nabd:language-change',[\s\S]*?renderNews\(\)/);
  assert.match(account,/document\.addEventListener\('nabd:language-change',[\s\S]*?sessions\(\)/);
  assert.match(read('index.html'),/app\.js\?v=mobile-touch-1/);
  assert.match(read('accounts.html'),/accounts\.js\?v=v2-locale-3/);
  for(const page of ['landing.html','landing-en.html'])
    assert.match(read(page),/language-pref\.js\?v=2/);
});
