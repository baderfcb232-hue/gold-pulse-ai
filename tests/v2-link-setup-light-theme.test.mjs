import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../server.mjs';

const read=name=>readFileSync(new URL('../public/'+name,import.meta.url),'utf8');

test('light theme overrides the dark hardcoded MT5 setup cards without touching dark theme',()=>{
 const fixes=read('dashboard-fixes.css'),base=read('styles.css'),html=read('index.html');
 assert.match(base,/\.setup-check\{[^}]*background:#120f19/);
 for(const selector of [
  '.connection-guide .setup-check{',
  '.connection-guide .setup-check h3{',
  '.connection-guide .setup-check p{',
  '.connection-guide .setup-check .step-indicator{',
  '.connection-guide .setup-check.complete{',
  '.connection-guide .setup-check.complete h3{',
  '.connection-guide .setup-check.complete .step-indicator{'
 ]) assert.ok(fixes.includes(':root[data-nabd-theme="light"] '+selector),'missing day-mode override '+selector);
 assert.match(fixes,/\.connection-guide \.setup-check\{\s*background:#f4fafb/);
 assert.match(fixes,/\.connection-guide \.setup-check\.complete\{\s*background:#e8f6f0/);
 assert.doesNotMatch(fixes,/data-nabd-theme="dark"\] \.connection-guide \.setup-check/);
 assert.match(html,/dashboard-fixes\.css\?v=ux-20261104/);
 assert.doesNotMatch(fixes,/OrderSend|fetch\(|\/api\/|MAX_RISK|InpEnableLiveTrading/);
 assert.equal((fixes.match(/\{/g)||[]).length,(fixes.match(/\}/g)||[]).length);
});

test('day-mode card CSS is served from dashboard without changing protected operator routes',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'nabd-light-setup-'));
 const app=createApplication({dataDir:dir});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;
 const css=await fetch(base+'/dashboard-fixes.css');
 assert.equal(css.status,200);
 assert.match(await css.text(),/\.connection-guide \.setup-check\.complete/);
 assert.equal((await fetch(base+'/api/account')).status,401);
 assert.equal((await (await fetch(base+'/healthz')).json()).ok,true);
});
