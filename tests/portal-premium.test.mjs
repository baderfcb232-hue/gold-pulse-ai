import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../server.mjs';

const html=readFileSync(new URL('../public/accounts.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/portal-premium.css',import.meta.url),'utf8');
const js=readFileSync(new URL('../public/accounts.js',import.meta.url),'utf8');

test('premium account design preserves all security, registration and admin controls',()=>{
  for(const id of ['member-login','member-register','member-forgot','member-mfa-login',
    'member-verify','member-reset','member-mt5-form','admin-users','restore-form',
    'member-logout','dashboard-theme-choice'])assert.match(html,new RegExp('id="'+id+'"'));
  for(const path of ['auth','account','admin','privacy'])
    assert.match(html,new RegExp('data-page="'+path+'"'));
  assert.match(html,/href="\/dashboard">السوق/);
  assert.match(html,/portal-premium\.css\?v=20261104/);
  assert.match(html,/theme-init\.js\?v=light-default-1/);
  assert.match(css,/#f8fafc/i);
  assert.match(css,/#0f766e/i);
  assert.match(css,/data-nabd-theme="dark"/);
  assert.match(css,/@media\(max-width:560px\)/);
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length);
  assert.doesNotMatch(css,/OrderSend|MT5_INGEST_TOKEN|\/api\//);
  assert.match(js,/member-login/);
  assert.match(js,/member-mfa-login/);
});

test('all account routes use premium stylesheet; protected APIs remain protected',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'nabd-portal-premium-'));
  const app=createApplication({dataDir:dir});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+app.server.address().port;
  for(const path of ['/auth','/account','/admin','/privacy']){
    const r=await fetch(base+path);
    assert.equal(r.status,200,path);
    assert.match(await r.text(),/portal-premium\.css\?v=20261104/);
  }
  const theme=await fetch(base+'/portal-premium.css');
  assert.equal(theme.status,200);
  assert.match(theme.headers.get('content-type'),/text\/css/);
  assert.match(await theme.text(),/#0f766e/);
  assert.equal((await fetch(base+'/api/auth/me')).status,401);
  assert.equal((await fetch(base+'/api/account')).status,401);
  const health=await (await fetch(base+'/healthz')).json();
  assert.equal(health.ok,true);
});
