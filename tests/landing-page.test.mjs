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

test('mobile marketing navigation is bilingual',()=>{
  for(const name of ['landing.html','landing-en.html'])
    assert.match(readFileSync(new URL('../public/'+name,import.meta.url),'utf8'),/<details class="mobile-menu">/);
  assert.match(readFileSync(new URL('../public/dashboard-themes.css',import.meta.url),'utf8'),/Mobile phase: keep dashboard navigation/);
});


test('phase 2 marketing sections are bilingual, transparent and accessible',()=>{
  for(const name of ['landing.html','landing-en.html']){
    const page=readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
    for(const id of ['market-strip-title','chart-previews','plans','faq','contact']) assert.ok(page.includes('id="'+id+'"'),name+': '+id);
    assert.match(page,/<details><summary>/);
    assert.match(page,/href="\/dashboard"/);
    assert.match(page,/href="\/account"/);
    assert.doesNotMatch(page,/\$\d+\s*\/\s*month|[0-9]+%\s*(?:win|success)/i);
  }
  const css=readFileSync(new URL('../public/landing.css',import.meta.url),'utf8');
  assert.match(css,/\.phase2-market-grid/);
  assert.match(css,/@media\(max-width:700px\)/);
});


test('landing market strip provides source-labelled prices and accessible preview switching',async()=>{
 for(const name of ['landing.html','landing-en.html']){
  const content=readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
  for(const symbol of ['XAUUSD','BTCUSD']) assert.ok(content.includes('data-landing-market="'+symbol+'"'));
  assert.match(content,/data-preview-symbol="BTCUSD"/);
  assert.match(content,/landing-live\.js/);
 }
 const client=readFileSync(new URL('../public/landing-live.js',import.meta.url),'utf8');
 assert.match(client,/\/api\/market/);
 assert.match(client,/connection==='LIVE'/);
 assert.match(client,/data-market-source/);
 assert.doesNotMatch(client,/\/api\/commands|\/api\/bridge\/next/);
});
