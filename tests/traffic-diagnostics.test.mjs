import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrafficDiagnostics} from '../traffic-diagnostics.mjs';

test('diagnostics are opt-in and do not include raw paths or sensitive query values',()=>{
  let now=100, output=[];
  const t=createTrafficDiagnostics({enabled:true,clock:()=>now,intervalSeconds:60,
    log:(...parts)=>output.push(parts.join(' '))});
  t.record({method:'POST',url:'/api/mt5?token=SECRET'},400,'{\"error\":\"bad\"}');
  t.record({method:'POST',url:'/api/mt5?token=DIFFERENT'},400,'abc');
  t.record({method:'GET',url:'/api/auth/status?email=PRIVATE'},200,'OK');
  now=161;
  t.record({method:'GET',url:'/healthz?secret=NEVER_LOG'},200,'good');
  assert.equal(output.length,1);
  const report=output[0];
  for(const secret of ['SECRET','DIFFERENT','PRIVATE','NEVER_LOG','/api/mt5','/api/auth/status'])
    assert.ok(!report.includes(secret),'sensitive data must not be logged');
  const payload=JSON.parse(report.slice(report.indexOf('{')));
  assert.deepEqual(payload.groups.find(x=>x.key==='POST:mt5-ingest:400'),
    {key:'POST:mt5-ingest:400',count:2,bytes:18});
  assert.equal(payload.groups.find(x=>x.key==='GET:auth:200').count,1);
  assert.equal(payload.groups.find(x=>x.key==='GET:health:200').count,1);
});
test('disabled diagnostics are silent even for invalid routes',()=>{
 let calls=0;
 const t=createTrafficDiagnostics({enabled:false,log:()=>calls++});
 t.record({method:'GET',url:'/customer/123?password=abc'},503,'body');
 t.flush();
 assert.equal(calls,0);
});
