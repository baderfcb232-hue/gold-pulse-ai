import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {createApplication} from '../server.mjs';

/**
 * Diagnostic only: 100 concurrent GETs against an isolated loopback server.
 * This is NOT 100 authenticated trading clients, a Render load test, or an
 * MT5/broker stress test. Never issue trading requests or use external hosts.
 */
test('NABD V2 handles 100 simultaneous local public reads without 5xx, data fabrication or auth bypass',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'nabd-v2-load-'));
  const app=createApplication({dataDir:dir});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+app.server.address().port;
  const paths=['/healthz','/dashboard','/en','/manifest.webmanifest','/market-motion.css','/api/account'];
  const planned=Array.from({length:100},(_,i)=>paths[i%paths.length]);
  const start=performance.now(),memBefore=process.memoryUsage().rss;
  const results=await Promise.all(planned.map(async path=>{
    const at=performance.now();
    const response=await fetch(base+path,{signal:AbortSignal.timeout(12000),headers:{'Cache-Control':'no-cache'}});
    const body=await response.arrayBuffer();
    const elapsed=performance.now()-at;
    return {path,status:response.status,bytes:body.byteLength,ms:elapsed,body:path==='/healthz'?Buffer.from(body).toString('utf8'):null};
  }));
  const latencies=results.map(r=>r.ms).sort((a,b)=>a-b);
  const p95=latencies[Math.ceil(.95*latencies.length)-1];
  const errors=results.filter(r=>{
    if(r.path==='/api/account')return r.status!==401;
    return r.status!==200||r.bytes===0;
  });
  assert.deepEqual(errors,[], 'All public reads must succeed; account API stays protected.');
  for(const item of results.filter(r=>r.path==='/healthz'))assert.equal(JSON.parse(item.body).ok,true);
  assert.ok(p95<10000,'High isolated read-only p95 latency: '+p95.toFixed(0)+'ms');
  const seconds=Math.max(.001,(performance.now()-start)/1000);
  const report={requests:results.length,concurrent:100,publicOnly:true,tradeRequests:0,
    unauthorizedAccountRequests:results.filter(r=>r.path==='/api/account').length,
    requestsPerSecond:Math.round(100/seconds),p50Ms:Math.round(latencies[49]),p95Ms:Math.round(p95),
    maxMs:Math.round(latencies.at(-1)),rssBeforeMB:Math.round(memBefore/1024/1024),
    rssAfterMB:Math.round(process.memoryUsage().rss/1024/1024)};
  console.log('NABD isolated read-only load QA:',JSON.stringify(report));
});
