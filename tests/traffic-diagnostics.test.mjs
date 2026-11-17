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

test('SSE accounting measures event frames but never exposes contents or request details',()=>{
  let current=100;
  const out=[];
  const meter=createTrafficDiagnostics({enabled:true,clock:()=>current,intervalSeconds:60,
    log:(...parts)=>out.push(parts.join(' '))});
  const secret='PRIVATE_USER_PRICE_TOKEN';
  const frame='event: market\\ndata: {"price":123,"secret":"'+secret+'"}\\n\\n';
  meter.recordStream('market',frame);
  meter.recordStream('market',frame);
  meter.recordStream('unexpected/'+secret,frame);
  current=161;
  meter.recordStream('news','event: news\\ndata: {}\\n\\n');
  assert.equal(out.length,1);
  assert.doesNotMatch(out[0],new RegExp(secret));
  const summary=JSON.parse(out[0].slice(out[0].indexOf('{')));
  assert.deepEqual(summary.groups.find(x=>x.key==='SSE:market:200'),{
    key:'SSE:market:200',count:2,bytes:2*Buffer.byteLength(frame)});
  assert.equal(summary.groups.find(x=>x.key==='SSE:other:200').count,1);
  assert.equal(summary.groups.find(x=>x.key==='SSE:news:200').count,1);
});

test('SSE accounting is silent while disabled',()=>{
  const events=[];
  const meter=createTrafficDiagnostics({enabled:false,log:(...args)=>events.push(args)});
  meter.recordStream('market','secret');
  meter.flush();
  assert.equal(events.length,0);
});

test('SSE byte-accounting does not mutate frames or cause logging when off',()=>{
  const source = 'event: state\\ndata: {"symbol":"XAUUSD","bid":4321.5}\\n\\n';
  const copy = source;
  const meter=createTrafficDiagnostics({enabled:false});
  assert.equal(meter.recordStream('state',source),undefined);
  assert.equal(source,copy,'meter must not modify the SSE frame sent to clients');
});
