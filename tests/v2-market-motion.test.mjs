import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createApplication} from '../server.mjs';
const read=p=>readFileSync(new URL('../public/'+p,import.meta.url),'utf8');
test('marketing motion is clearly decorative and bilingual',()=>{
 const css=read('market-motion.css'),ar=read('landing.html'),en=read('landing-en.html');
 for(const s of [ar,en]){
  assert.match(s,/market-motion\.css\?v=motion-1/);
  assert.match(s,/class="market-motion"/);
  assert.match(s,/aria-hidden="true"/);
  assert.match(s,/market-motion-label/);
 }
 assert.match(ar,/لا يعرض أسعارًا أو توصيات فعلية/);
 assert.match(en,/No live prices or trading signals/);
 assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(css,/nabd-market-pulse-draw/);
 assert.doesNotMatch(css,/fetch\(|OrderSend|WebSocket|\/api\//);
 assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length);
});
test('decorative animation never enters real dashboard or changes protected API routes',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'nabd-motion-')),app=createApplication({dataDir:dir});
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;
 const [css,home,en,dashboard,account]=await Promise.all(['/market-motion.css','/','/en','/dashboard','/api/account'].map(x=>fetch(base+x)));
 assert.equal(css.status,200);assert.equal(home.status,200);assert.equal(en.status,200);
 assert.equal(dashboard.status,200);assert.equal(account.status,401);
 assert.doesNotMatch(await dashboard.text(),/market-motion\.css/);
});
