import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../server.mjs';

test('public static assets revalidate unchanged bytes without retransmission',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'nabd-static-cache-'));
  const app=createApplication({dataDir:dir});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+app.server.address().port;
  for(const path of ['/accounts.js','/accounts.css','/nabd-logo.svg','/nabd-app-icon-192.png','/manifest.webmanifest']){
    const first=await fetch(base+path);
    assert.equal(first.status,200,path);
    const etag=first.headers.get('etag');
    assert.match(etag,/^"[a-f0-9]{64}"$/);
    assert.equal(first.headers.get('cache-control'),'public, no-cache, must-revalidate');
    const original=Buffer.from(await first.arrayBuffer());
    assert.ok(original.length>0);
    const again=await fetch(base+path,{headers:{'If-None-Match':etag}});
    assert.equal(again.status,304,path);
    assert.equal((await again.arrayBuffer()).byteLength,0,path);
    const changed=await fetch(base+path,{headers:{'If-None-Match':'"different"'}});
    assert.equal(changed.status,200,path);
    assert.deepEqual(Buffer.from(await changed.arrayBuffer()),original,path);
  }
});

test('HTML, service worker, APIs and live state remain no-store',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'nabd-sensitive-cache-'));
  const app=createApplication({dataDir:dir});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+app.server.address().port;
  for(const path of ['/','/auth','/sw.js','/api/state']){
    const first=await fetch(base+path);
    assert.equal(first.headers.get('cache-control'),'no-store',path);
    assert.equal(first.headers.get('etag'),null,path);
    const again=await fetch(base+path,{headers:{'If-None-Match':'"anything"'}});
    assert.notEqual(again.status,304,path);
  }
});
