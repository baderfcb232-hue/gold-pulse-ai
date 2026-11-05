import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../server.mjs';
const read=name=>readFileSync(new URL('../public/'+name,import.meta.url),'utf8');

test('dashboard compact theme and language controls replace full-width mobile preference sheet',()=>{
 const html=read('index.html'),css=read('mobile-polish.css'),js=read('dashboard-locale.js');
 for(const id of ['nabd-theme-quick','nabd-language-quick','dashboard-theme-choice','dashboard-language-choice'])
  assert.match(html,new RegExp('id="'+id+'"'));
 for(const value of ['light','dark','system'])assert.match(html,new RegExp('value="'+value+'"'));
 assert.match(html,/mobile-polish\.css\?v=compact-20261105/);
 assert.match(html,/dashboard-locale\.js\?v=compact-20261105/);
 assert.match(css,/\.header \.nav-footer\.nabd-quick-button|\.header \.nav-footer \.nabd-quick-button/);
 assert.match(css,/grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
 assert.match(css,/inset-inline-end:12px/);
 assert.match(css,/bottom:calc\(77px \+ env\(safe-area-inset-bottom\)\)/);
 assert.match(css,/min-height:44px/);
 assert.match(js,/choice\.dispatchEvent\(new Event\('change'/);
 assert.match(js,/themeChoice\.dispatchEvent\(new Event\('change'/);
 assert.match(js,/localStorage\.setItem\(key,lang\)/);
 assert.match(js,/refreshQuickControls\(\)/);
 assert.doesNotMatch(css,/OrderSend|fetch\(|\/api\//);
 assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length);
});

test('toasts remain at bottom, above safe-area nav, never the old top overlay',()=>{
 const css=read('live-feedback.css'),html=read('index.html');
 assert.match(html,/live-feedback\.css\?v=bottom-20261105/);
 assert.match(css,/\.toast-stack\{top:auto;bottom:22px/);
 assert.match(css,/bottom:calc\(137px \+ env\(safe-area-inset-bottom\)\)/);
 assert.match(css,/max-height:min\(40dvh,320px\)/);
 assert.doesNotMatch(css,/top:100px|top:calc\(78px/);
 assert.match(css,/prefers-reduced-motion:reduce/);
 assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length);
});

test('compact controls and bottom toast styles are served with the original operator authorization intact',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'nabd-quick-settings-'));
 const app=createApplication({dataDir:dir});
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;
 const html=await (await fetch(base+'/dashboard')).text();
 assert.match(html,/nabd-language-quick/);
 assert.match(html,/nabd-theme-quick/);
 for(const p of ['/mobile-polish.css','/live-feedback.css','/dashboard-locale.js'])
  assert.equal((await fetch(base+p)).status,200,p);
 assert.equal((await fetch(base+'/api/account')).status,401);
 assert.equal((await (await fetch(base+'/healthz')).json()).ok,true);
});
