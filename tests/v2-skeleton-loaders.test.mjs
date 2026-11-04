import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMarketLoaders} from '../public/market-loaders.js';
import {createApplication} from '../server.mjs';
const read=path=>readFileSync(new URL('../public/'+path,import.meta.url),'utf8');
test('initial quote/MT5 chart/news loaders reveal real states when resolved',()=>{
 const records=new Map();
 const element=()=>({attrs:new Map(),setAttribute(k,v){this.attrs.set(k,v)},removeAttribute(k){this.attrs.delete(k)}});
 const root={querySelectorAll(selector){if(!records.has(selector))records.set(selector,[element()]);return records.get(selector)}};
 const l=createMarketLoaders({root,timeoutMs:0});
 assert.equal(l.pending,true);
 l.ready('market');
 for(const selector of ['.live-quote-card','.live-top-grid .decision-card','.featured-signal'])
   assert.equal(records.get(selector)[0].attrs.get('aria-busy'),'false');
 l.ready('chart');l.ready('news');
 assert.equal(l.pending,false);
 l.destroy();
});
test('visual loading does not claim synthetic prices, stays bounded and respects reduced motion',()=>{
 const css=read('market-loaders.css');
 const js=read('market-loaders.js');
 const live=read('live.js');
 assert.match(css,/@keyframes nabd-skeleton-shimmer/);
 assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(js,/timeoutMs=8000/);
 assert.match(js,/aria-busy/);
 assert.match(live,/loaders.ready\('market'\)/);
 assert.match(live,/loaders.ready\('chart'\)/);
 assert.match(live,/loaders.ready\('news'\)/);
 assert.doesNotMatch(js,/fetch\(|\/api\/|OrderSend|Math.random/);
 assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length);
});
test('skeleton static resources serve without changing auth or health',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'nabd-skeleton-'));
 const app=createApplication({dataDir:dir});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;
 const home=await fetch(base+'/dashboard');assert.equal(home.status,200);
 assert.match(await home.text(),/market-loaders.css/);
 for(const path of ['/market-loaders.js','/market-loaders.css']){
   const r=await fetch(base+path);assert.equal(r.status,200,path);
 }
 assert.equal((await fetch(base+'/api/account')).status,401);
 assert.equal((await (await fetch(base+'/healthz')).json()).ok,true);
});
