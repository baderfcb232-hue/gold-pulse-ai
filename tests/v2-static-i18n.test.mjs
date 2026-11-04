import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createApplication} from '../server.mjs';
import {dashboardStaticEnglish} from '../public/dashboard-static-en.js';
import {accountStaticEnglish} from '../public/account-static-en.js';
import {translateUiText,staticTranslationCoverage} from '../public/i18n-dom.js';
const read=p=>readFileSync(new URL('../public/'+p,import.meta.url),'utf8');
const htmlCopy=p=>[...new Set(read(p)
  .replace(/<script[\s\S]*?<\/script>/g,'').replace(/<style[\s\S]*?<\/style>/g,'')
  .replace(/<[^>]+>/g,'\n').split('\n').map(v=>v.trim())
  .filter(v=>/[\u0600-\u06FF]/.test(v)&&v.length<400))];

test('exact English translations cover every static dashboard and account phrase',()=>{
  for(const [page,translations,expected]of [
    ['index.html',dashboardStaticEnglish,238],
    ['accounts.html',accountStaticEnglish,137]
  ]){
    const source=htmlCopy(page);
    assert.equal(source.length,expected,'source count changed: '+page);
    assert.deepEqual(source.filter(v=>!Object.hasOwn(translations,v)),[],'missing translations in '+page);
    assert.equal(Object.keys(translations).length,expected);
    for(const translated of Object.values(translations)){
      assert.ok(typeof translated==='string'&&translated.length>0);
      assert.doesNotMatch(translated,/[\u0600-\u06FF]/,'no Arabic in English static content');
    }
  }
  assert.equal(staticTranslationCoverage.dashboard,238);
  assert.equal(staticTranslationCoverage.account,137);
});

test('localized display text never overwrites unknown trading, broker or customer values',()=>{
  assert.equal(translateUiText(' وقف الخسارة ','en'),' Stop loss ');
  assert.equal(translateUiText('نسبة المخاطرة %','en'),'Risk percentage %');
  assert.equal(translateUiText('لا توجد بيانات تقويم','en'),'No calendar data');
  assert.equal(translateUiText('PRICE_OR_SPREAD_MOVE','en'),'PRICE_OR_SPREAD_MOVE');
  assert.equal(translateUiText('4050.27','en'),'4050.27');
  assert.equal(translateUiText('وقف الخسارة','ar'),'وقف الخسارة');
  assert.equal(translateUiText(null,'en'),null);
});

test('dashboard and account translation scripts are browser modules with shared locale preference',()=>{
 const dashboard=read('index.html'),account=read('accounts.html');
 assert.match(dashboard,/dashboard-locale\.js\?v=v2-i18n-1" type="module"/);
 assert.match(account,/account-language\.js\?v=v2-i18n-1" type="module"/);
 assert.match(account,/id="portal-language-choice"/);
 assert.match(read('dashboard-locale.js'),/translateStaticUi\(document.body,lang\)/);
 assert.match(read('account-language.js'),/translateStaticUi\(document.body,lang\)/);
 for(const script of ['i18n-dom.js','dashboard-static-en.js','account-static-en.js','account-language.js','dashboard-locale.js']){
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
 for(const path of ['/i18n-core.js','/i18n-dom.js','/dashboard-static-en.js','/account-static-en.js','/account-language.js']){
   const r=await fetch(base+path);assert.equal(r.status,200,path);
 }
 assert.equal((await fetch(base+'/dashboard')).status,200);
 assert.equal((await fetch(base+'/account')).status,200);
 assert.equal((await fetch(base+'/api/account')).status,401);
 assert.equal((await (await fetch(base+'/healthz')).json()).ok,true);
});
