import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import {createApplication} from '../server.mjs';
const read=p=>readFileSync(new URL('../public/'+p,import.meta.url));
test('NABD PWA offers real raster icons, properly sized and decodable',()=>{
 const manifest=JSON.parse(read('manifest.webmanifest').toString());
 assert.equal(manifest.start_url,'/dashboard');
 assert.equal(manifest.scope,'/');
 assert.equal(manifest.display,'standalone');
 assert.deepEqual(manifest.icons.map(x=>x.sizes),['192x192','512x512']);
 assert.match(manifest.icons[1].purpose,/maskable/);
 for(const [name,size]of [['nabd-apple-touch-180.png',180],['nabd-app-icon-192.png',192],['nabd-app-icon-512.png',512]]){
  const buf=read(name);
  assert.deepEqual(buf.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]),name+' PNG signature');
  assert.equal(buf.readUInt32BE(16),size,name+' width');
  assert.equal(buf.readUInt32BE(20),size,name+' height');
  assert.equal(buf[24],8,'indexed 8-bit');
  assert.equal(buf[25],3,'PNG palette');
  const payload=[];
  for(let p=8;p<buf.length;){const len=buf.readUInt32BE(p),kind=buf.subarray(p+4,p+8).toString('ascii');
   if(kind==='IDAT')payload.push(buf.subarray(p+8,p+8+len));
   p+=12+len;
  }
  const rows=inflateSync(Buffer.concat(payload));
  assert.equal(rows.length,(size+1)*size,'PNG pixel rows decompress');
  assert.ok(new Set(rows).has(2),'Gold mark visible');
  assert.ok(new Set(rows).has(1),'Teal mark visible');
 }
});
test('offline mode shows an honest notice and never caches market APIs or broker trades',()=>{
 const sw=read('sw.js').toString(),offline=read('offline.html').toString(),register=read('pwa-register.js').toString();
 assert.match(sw,/req\.mode!=='navigate'/);
 assert.match(sw,/url\.pathname\.startsWith\('\/api\/'\)/);
 assert.match(sw,/event\.respondWith\(fetch\(req,\{cache:'no-store'\}\)\.catch/);
 assert.doesNotMatch(sw,/cache\.put\(|\/api\/market|OrderSend|\/api\/orders/);
 assert.match(offline,/لا تُعرض أي أسعار أو صفقات محفوظة على أنها حية/);
 assert.match(offline,/No live prices or trading signals|Live prices, signals and MT5 execution status are unavailable/);
 assert.match(register,/navigator\.serviceWorker\.register\('\/sw\.js'/);
 for(const filename of ['sw.js','pwa-register.js']){
  const p=new URL('../public/'+filename,import.meta.url).pathname;
  assert.equal(spawnSync(process.execPath,['--check',p],{encoding:'utf8'}).status,0,filename+' syntax');
 }
});
test('production landing smoke expectations follow the actual no-store service worker',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/landing-production-smoke.yml',import.meta.url),'utf8');
 const sw=read('sw.js').toString();
 assert.ok(sw.includes("fetch(req,{cache:'no-store'})"));
 assert.ok(workflow.includes("b\"fetch(req,{cache:'no-store'})\""),'Production smoke must match the current SW navigation policy');
 assert.ok(workflow.includes("b\"url.pathname.startsWith('/api/')\""),'Production smoke must verify API bypass');
 assert.ok(workflow.includes("b'nabd-offline-shell-v2'"),'Production smoke must check the active offline cache version');
});
test('service worker rejects stale HTML and returns only the explicit offline notice on network failure',async()=>{
 const source=read('sw.js').toString(),listeners={};
 const fallback={kind:'offline-notice'},requests=[];
 const self={location:{origin:'https://nabd.test'},addEventListener:(type,fn)=>{listeners[type]=fn}};
 const caches={match:async key=>key==='/offline.html'?fallback:null};
 const fetch=async(req,opts)=>{requests.push({req,opts});throw new Error('network offline');};
 runInNewContext(source,{self,caches,fetch,URL});
 let answer;
 listeners.fetch({request:{url:'https://nabd.test/dashboard',method:'GET',mode:'navigate'},respondWith:p=>{answer=p}});
 assert.equal(await answer,fallback);
 assert.equal(requests.length,1);
 assert.equal(requests[0].opts.cache,'no-store');
 let intercepted=false;
 for(const request of [
  {url:'https://nabd.test/api/market',method:'GET',mode:'cors'},
  {url:'https://nabd.test/api/orders',method:'POST',mode:'navigate'},
  {url:'https://external.test/dashboard',method:'GET',mode:'navigate'}
 ]){
  listeners.fetch({request,respondWith(){intercepted=true}});
 }
 assert.equal(intercepted,false,'MT5 and cross-origin requests remain untouched');
});
test('Arabic English dashboard account and marketing routes expose install meta',()=>{
 for(const file of ['index.html','accounts.html','landing.html','landing-en.html']){
  const html=read(file).toString();
  assert.match(html,/rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html,/apple-touch-icon" sizes="180x180"/);
  assert.match(html,/pwa-register\.js\?v=pwa-1/);
 }
});
test('public PWA assets work and protected account APIs stay protected',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'nabd-pwa-')),app=createApplication({dataDir:dir});
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;
 for(const name of ['sw.js','pwa-register.js','offline.html','nabd-app-icon-192.png','nabd-app-icon-512.png','nabd-apple-touch-180.png']){
  const r=await fetch(base+'/'+name);assert.equal(r.status,200,name);
  assert.match(r.headers.get('content-type'),name.endsWith('.png')?/image\/png/:name.endsWith('.js')?/text\/javascript/:/text\/html/);
 }
 assert.equal((await fetch(base+'/api/account')).status,401);
 assert.equal((await (await fetch(base+'/healthz')).json()).ok,true);
});
