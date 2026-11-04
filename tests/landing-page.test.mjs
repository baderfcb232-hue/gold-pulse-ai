import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../server.mjs';

const html=readFileSync(new URL('../public/landing.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/landing.css',import.meta.url),'utf8');

test('landing page is accessible, responsive, and never fabricates market performance',()=>{
  for(const part of ['lang="ar" dir="rtl"','id="main"','id="features"','id="how-it-works"','id="trust"',
    'href="/dashboard"','href="/account"','XAUUSD','BTCUSD','DEMO PREVIEW','ليست سعرًا مباشرًا'])
    assert.ok(html.includes(part),'missing: '+part);
  assert.match(html,/<a class="skip-link" href="#main">/);
  assert.match(css,/@media\(max-width:620px\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.doesNotMatch(html,/نسبة نجاح \d+%|أرباح مضمونة|ربح مضمون|مراجعات وهمية/);
  assert.doesNotMatch(html,/MT5_INGEST_TOKEN|DASHBOARD_TOKEN|password=|auth_token=/i);
});

test('new /welcome route is isolated and existing dashboard and API still respond',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'nabd-landing-'));
  const app=createApplication({dataDir:dir});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+app.server.address().port;
  const get=path=>fetch(base+path);
  const welcome=await get('/welcome');
  assert.equal(welcome.status,200);
  assert.match(welcome.headers.get('content-type'),/text\/html/);
  assert.match(await welcome.text(),/رؤية أوضح/);
  const style=await get('/landing.css');
  assert.equal(style.status,200);
  assert.match(style.headers.get('content-type'),/text\/css/);
  const dashboard=await get('/dashboard');
  assert.equal(dashboard.status,200);
  assert.match(await dashboard.text(),/id="market-symbols"/);
  const original=await get('/');
  assert.equal(original.status,200);
  assert.match(await original.text(),/رؤية أوضح/);
  const legacy=await get('/index.html');
  assert.equal(legacy.status,200);
  assert.match(await legacy.text(),/id="market-symbols"/);
  const account=await get('/account');
  assert.equal(account.status,200);
  assert.match(await account.text(),/href="\/dashboard">السوق/);
  const health=await get('/healthz');
  assert.equal(health.status,200);
  assert.equal((await health.json()).ok,true);
});
