import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../server.mjs';

const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/dashboard-themes.css',import.meta.url),'utf8');
const script=readFileSync(new URL('../public/theme-init.js',import.meta.url),'utf8');

test('default light, optional dark and system modes are saved as visual preferences only',()=>{
  assert.match(html,/id="dashboard-theme-choice"/);
  for(const mode of ['light','dark','system']) assert.match(html,new RegExp('value="'+mode+'"'));
  assert.match(html,/\/dashboard-themes\.css\?v=premium-1/);
  assert.match(html,/\/theme-init\.js\?v=light-default-1/);
  assert.match(css,/:root\[data-nabd-theme="light"\]/);
  assert.match(css,/:root\[data-nabd-theme="dark"\]/);
  for(const color of ['#f8fafc','#0f172a','#0f766e','#14b8a6','#e2e8f0'])assert.ok(css.toLowerCase().includes(color));
  assert.match(script,/localStorage\.setItem/);
  assert.match(script,/prefers-color-scheme: dark/);
  assert.doesNotMatch(script,/fetch\(|OrderSend|\/api\/|MT5_INGEST_TOKEN|DASHBOARD_TOKEN/);
  assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length);
  assert.match(html,/id="market-symbols"/);
  assert.match(html,/id="pause-bot"/);
});

test('theme endpoints are static and protected trading routes retain their original behavior',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'nabd-theme-'));
  const app=createApplication({dataDir:dir});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+app.server.address().port;
  for(const [path,type] of [['/dashboard-themes.css','text/css'],['/theme-init.js','text/javascript']]){
    const r=await fetch(base+path);
    assert.equal(r.status,200,path);
    assert.match(r.headers.get('content-type'),new RegExp(type));
  }
  const dash=await (await fetch(base+'/dashboard')).text();
  assert.match(dash,/dashboard-theme-choice/);
  const home=await (await fetch(base+'/')).text();
  assert.doesNotMatch(home,/dashboard-theme-choice/);
  assert.equal((await fetch(base+'/api/account')).status,401);
  assert.equal((await (await fetch(base+'/healthz')).json()).ok,true);
});
