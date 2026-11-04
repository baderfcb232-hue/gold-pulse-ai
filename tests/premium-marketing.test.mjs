import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../server.mjs';

const read=(name)=>readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
const palette=read('brand-system.css'),landing=read('landing.html'),style=read('marketing-premium.css');
const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4));
const luminance=hex=>{const [r,g,b]=rgb(hex);return .2126*r+.7152*g+.0722*b;};
const contrast=(a,b)=>{const v=[luminance(a),luminance(b)].sort((a,b)=>b-a);return(v[0]+.05)/(v[1]+.05)};
test('unified premium brand has accessible primary text and CTA color',()=>{
  for(const color of ['#F8FAFC','#FFFFFF','#0F172A','#0F766E','#14B8A6','#D4A24C','#E2E8F0'])
    assert.ok(palette.includes(color),'missing brand color '+color);
  assert.ok(contrast('#0F766E','#FFFFFF')>=4.5);
  assert.ok(contrast('#0F172A','#FFFFFF')>=7);
  assert.match(style,/\.hero h1/);
  assert.match(style,/\.feature-card/);
  assert.match(style,/\.site-header/);
  assert.match(style,/@media\(max-width:620px\)/);
  assert.match(style,/prefers-reduced-motion:reduce/);
  for(const s of [palette,style]) assert.equal((s.match(/\{/g)||[]).length,(s.match(/\}/g)||[]).length);
});
test('welcome hero has two truthful conversion actions and same trading app',()=>{
  assert.match(landing,/رؤية أوضح/);
  assert.match(landing,/href="\/brand-system\.css\?v=1"/);
  assert.match(landing,/href="\/marketing-premium\.css\?v=1"/);
  assert.match(landing,/href="\/account">ابدأ الآن/);
  assert.match(landing,/href="\/dashboard">استكشف المنصة/);
  assert.match(landing,/DEMO PREVIEW/);
  assert.match(landing,/لا تعرض أرباحًا أو أسعارًا حقيقية/);
  assert.doesNotMatch(landing,/(نسبة نجاح 9\d%|ربح مضمون|أرباح مضمونة)/);
  assert.doesNotMatch(landing,/MT5_INGEST_TOKEN|DASHBOARD_TOKEN/);
});
test('marketing CSS serves independently; dashboard and read-only health remain intact',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'nabd-premium-'));
  const app=createApplication({dataDir:dir});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+app.server.address().port;
  for(const path of ['/brand-system.css','/marketing-premium.css']){
    const r=await fetch(base+path);assert.equal(r.status,200);
    assert.match(r.headers.get('content-type'),/text\/css/);
  }
  const root=await fetch(base+'/');assert.equal(root.status,200);
  assert.match(await root.text(),/marketing-premium/);
  const dash=await fetch(base+'/dashboard');assert.equal(dash.status,200);
  assert.match(await dash.text(),/id="market-symbols"/);
  const health=await fetch(base+'/healthz');assert.equal(health.status,200);
  assert.equal((await health.json()).ok,true);
});
