import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../server.mjs';

const read=file=>readFileSync(new URL('../public/'+file,import.meta.url),'utf8');
const english=read('landing-en.html'),arabic=read('landing.html'),langJs=read('language-pref.js');
test('English homepage is genuinely LTR, translated and accurately describes risk',()=>{
  assert.match(english,/<html lang="en" dir="ltr">/);
  assert.match(english,/<title>NABD \| Clarity for Gold and Bitcoin<\/title>/);
  assert.match(english,/How NABD works/);
  assert.match(english,/A clearer view/);
  assert.match(english,/Trading involves risk/);
  assert.match(english,/DEMO PREVIEW/);
  assert.match(english,/href="\/dashboard"/);
  assert.match(english,/href="\/account"/);
  assert.match(english,/href="\/" data-lang-target="ar"/);
  assert.doesNotMatch(english,/[\u0600-\u06FF]{3,}/g,'Only the Arabic-language link may contain Arabic');
  assert.match(arabic,/href="\/en" data-lang-target="en"/);
  assert.match(arabic,/lang="ar" dir="rtl"/);
  assert.doesNotMatch(english,/guaranteed profit|90% win rate/i);
  assert.doesNotMatch(langJs,/\/api\/|OrderSend|fetch\(/);
});
test('both languages, styles and dashboard are served independently',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'nabd-locale-'));
  const app=createApplication({dataDir:dir});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+app.server.address().port;
  for(const path of ['/en','/','/dashboard','/language-pref.js','/marketing-i18n.css']){
    const r=await fetch(base+path);
    assert.equal(r.status,200,path+' should load');
  }
  const en=await (await fetch(base+'/en')).text();
  assert.match(en,/dir="ltr"/);
  const dash=await (await fetch(base+'/dashboard')).text();
  assert.match(dash,/id="market-symbols"/);
  const health=await fetch(base+'/healthz');
  assert.equal((await health.json()).ok,true);
});
