import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {createApplication} from '../server.mjs';
const read=path=>readFileSync(new URL('../public/'+path,import.meta.url),'utf8');

test('transparent responsive premium NABD branding is present on every public account and marketing entry',()=>{
  const html=read('index.html');
  const marketing=read('landing.html'),en=read('landing-en.html'),accounts=read('accounts.html');
  assert.match(html,/nabd-logo\.svg\?v=v2-1/);
  assert.match(html,/nabd-logo-en\.svg\?v=v2-1/);
  assert.match(html,/nabd-locale-init\.js\?v=v2-1/);
  assert.match(html,/nabd-ltr-brand\.css\?v=v2-1/);
  assert.match(marketing,/nabd-mark\.svg\?v=v2-1/);
  assert.match(en,/nabd-mark\.svg\?v=v2-1/);
  assert.match(accounts,/nabd-mark\.svg\?v=v2-1/);
  assert.doesNotMatch(html,/brand-art|brand-logo\.png/);
  assert.doesNotMatch(en,/<span class="brand-word">NABD <b>NABD<\/b>/);
  for(const path of ['icon.svg','nabd-mark.svg','nabd-logo.svg','nabd-logo-en.svg']){
    const svg=read(path);
    assert.match(svg,/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg,/<\/svg>/);
    assert.match(svg,/#0F766E/);
    assert.match(svg,/#D4A24C/);
    assert.doesNotMatch(svg,/<rect\b/,'Logo must be transparent, no opaque background');
  }
  assert.doesNotMatch(read('nabd-logo-en.svg'),/[\u0600-\u06FF]/,'English logo must not include Arabic text');
});

test('English desktop layout really moves navigation left, mirrors instructions, and keeps financial numbers LTR',()=>{
  const css=read('nabd-ltr-brand.css');
  for(const segment of [
    'html[dir="ltr"] .nav{left:22px;right:auto}',
    'html[dir="ltr"] .main{margin-left:200px;margin-right:auto',
    'html[dir="ltr"] .nav-footer{left:22px;right:auto}',
    'html[dir="ltr"] .setup-instructions{border-right:0;border-left:1px',
    'html[dir="ltr"] .broker-quote-values strong{text-align:left}',
    'html[dir="ltr"] .number,html[dir="ltr"] .price-value',
    '@media(max-width:760px)'
  ])assert.ok(css.includes(segment),'missing semantic mirror: '+segment);
  assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length);
  assert.doesNotMatch(css,/OrderSend|\/api\//);
});

test('selected language sets page direction before render without changing trade state',()=>{
  const script=read('nabd-locale-init.js');
  for(const [stored,expected] of [['en','ltr'],['ar','rtl'],[null,'rtl']]){
    const document={documentElement:{lang:'',dir:''}};
    const localStorage={getItem:()=>stored};
    assert.doesNotThrow(()=>runInNewContext(script,{document,localStorage}));
    assert.equal(document.documentElement.dir,expected);
    assert.equal(document.documentElement.lang,stored==='en'?'en':'ar');
  }
  assert.doesNotMatch(script,/fetch\(|\/api\/|WebSocket|EventSource/);
});

test('brand assets respond through production server while account privacy and health remain intact',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'nabd-brand-ltr-'));
 const app=createApplication({dataDir:dir});
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;
 for(const path of ['/nabd-mark.svg','/nabd-logo.svg','/nabd-logo-en.svg','/nabd-locale-init.js','/nabd-ltr-brand.css','/icon.svg']){
   const response=await fetch(base+path);
   assert.equal(response.status,200,path);
   assert.ok((await response.text()).length>100,path);
 }
 for(const path of ['/dashboard','/account','/en','/']){
   const response=await fetch(base+path);assert.equal(response.status,200,path);
 }
 assert.equal((await fetch(base+'/api/account')).status,401);
 assert.equal((await (await fetch(base+'/healthz')).json()).ok,true);
});
