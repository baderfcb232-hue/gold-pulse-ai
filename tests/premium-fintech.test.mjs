import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../server.mjs';

const html=readFileSync(new URL('../public/landing.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/premium-fintech.css',import.meta.url),'utf8');

test('premium light-fintech design tokens, contrast and CTA remain clear',()=>{
  for(const color of ['#f8fafc','#0f172a','#0f766e','#14b8a6','#d4a24c'])
    assert.ok(css.toLowerCase().includes(color),'missing palette '+color);
  assert.match(html,/premium-fintech\.css\?v=20261104/);
  assert.match(html,/ابدأ الآن — استكشف نبض/);
  assert.match(html,/DEMO PREVIEW/);
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length);
  assert.doesNotMatch(css,/fetch\(|\/api\/|OrderSend|InpEnableLiveTrading/);
});

test('homepage new theme loads without changing /dashboard or API contracts',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'nabd-premium-'));
  const app=createApplication({dataDir:dir});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+app.server.address().port;
  const [home,theme,dashboard,health]=await Promise.all([
    fetch(base+'/'),fetch(base+'/premium-fintech.css'),fetch(base+'/dashboard'),fetch(base+'/healthz')
  ]);
  assert.equal(home.status,200);
  assert.match(await home.text(),/premium-fintech\.css/);
  assert.equal(theme.status,200);
  assert.match(theme.headers.get('content-type'),/text\/css/);
  assert.match(await theme.text(),/--nabd-brand:#0f766e/);
  assert.equal(dashboard.status,200);
  const existing=await dashboard.text();
  assert.match(existing,/id="market-symbols"/);
  assert.doesNotMatch(existing,/premium-fintech\.css/);
  assert.equal(health.status,200);
  assert.equal((await health.json()).ok,true);
});
