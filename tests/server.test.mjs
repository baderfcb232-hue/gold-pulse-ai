import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../server.mjs';
import {fixture,NOW,samplePlan,entryFixture} from './fixtures.mjs';
const INGEST='test-ingest-token-xxxxxxxxxxxxxxxxxxxxxxxx',ADMIN='test-admin-token-yyyyyyyyyyyyyyyyyyyyyyyy';
async function setup(t,{dir,clock,config={signalSource:'DASHBOARD'}}={}){const dataDir=dir||mkdtempSync(join(tmpdir(),'nabd-test-'));const app=createApplication({dataDir,storagePersistent:true,ingestToken:INGEST,dashboardToken:ADMIN,clock:clock||(()=>NOW),config});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;t.after(async()=>{await app.close();if(!dir)rmSync(dataDir,{recursive:true,force:true});});return {app,base,dataDir};}
const post=(base,path,data,token)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});

test('MT5 telemetry credentials cannot double as the operator credential',()=>{
  assert.throws(()=>createApplication({ingestToken:INGEST,dashboardToken:INGEST}),/must be different/);
});

test('no-data state is explicit and sensitive account routes require authentication',async t=>{
  const {base}=await setup(t);const state=await (await fetch(base+'/api/state')).json();assert.equal(state.bid,null);assert.equal(state.connection,'NO_DATA');assert.equal(state.riskLevel,'UNKNOWN');
  assert.equal((await fetch(base+'/api/account')).status,401);assert.equal((await post(base,'/api/mt5',fixture())).status,401);
});
test('authenticated snapshots isolate account data from public state, SSE and signals',async t=>{
  const {base}=await setup(t);assert.equal((await post(base,'/api/mt5',fixture(),INGEST)).status,200);
  const pub=await (await fetch(base+'/api/state')).json();assert.equal(pub.connection,'LIVE');assert.ok(!('account' in pub));assert.ok(!('positions' in pub));assert.ok(!('account_ref' in pub));assert.ok(!JSON.stringify(pub).includes('TEST_ACCOUNT_ONLY'));
  const actual=await (await fetch(base+'/api/account',{headers:{Authorization:'Bearer '+ADMIN}})).json();assert.equal(actual.account.balance,1234.56);assert.equal(actual.positions[0].ticket,'901');
  const res=await fetch(base+'/api/events'),reader=res.body.getReader();const {value}=await reader.read();const event=new TextDecoder().decode(value);assert.ok(event.includes('event: state'));assert.ok(!event.includes('TEST_ACCOUNT_ONLY'));assert.ok(!event.includes('1234.56'));await reader.cancel();
});
test('source mismatch and replayed quotes are rejected',async t=>{
  const {base}=await setup(t);await post(base,'/api/mt5',fixture(),INGEST);let raw=fixture();raw.account_ref='DIFFERENT_ACCOUNT';assert.equal((await post(base,'/api/mt5',raw,INGEST)).status,400);
  raw=fixture();raw.quote_at=NOW-1;assert.equal((await post(base,'/api/mt5',raw,INGEST)).status,400);
});
test('signals keep frozen levels and persist through a server restart',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'nabd-persist-'));let now=NOW;
  const first=createApplication({dataDir:dir,clock:()=>now});first.ingest(fixture());const p=samplePlan();first.db.prepare('INSERT INTO signals VALUES(?,?,?)').run(p.id,p.issued_at,JSON.stringify(p));
  now++;const raw=fixture(now);raw.bid=4009;raw.ask=4009.03;first.ingest(raw);assert.equal(first.signalRows()[0].entry,p.entry);assert.equal(first.signalRows()[0].sl,p.sl);assert.equal(first.signalRows()[0].tp2,p.tp2);await first.close();
  const second=createApplication({dataDir:dir,clock:()=>now});assert.equal(second.signalRows().length,1);assert.equal(second.signalRows()[0].entry,p.entry);await second.close();rmSync(dir,{recursive:true,force:true});
});
test('remote commands are authenticated, limited and expire without pretending execution',async t=>{
  let now=NOW;const {base}=await setup(t,{clock:()=>now});await post(base,'/api/mt5',fixture(now),INGEST);
  assert.equal((await post(base,'/api/commands',{action:'CLOSE_ALL'})).status,401);
  assert.equal((await post(base,'/api/commands',{action:'BUY'},ADMIN)).status,400);
  assert.equal((await post(base,'/api/commands',{action:'CLOSE_POSITION',ticket:'999'},ADMIN)).status,400);
  const response=await post(base,'/api/commands',{action:'CLOSE_POSITION',ticket:'901'},ADMIN);assert.equal(response.status,202);const c=await response.json();assert.equal(c.status,'QUEUED');
  const command=await (await fetch(base+'/api/bridge/next',{headers:{Authorization:'Bearer '+INGEST}})).text();assert.match(command,/CLOSE_POSITION\|901/);
  assert.equal((await post(base,'/api/commands',{action:'PAUSE'},ADMIN)).status,409);
  now+=21;assert.equal(await (await fetch(base+'/api/bridge/next',{headers:{Authorization:'Bearer '+INGEST}})).text(),'');
  const actual=await (await fetch(base+'/api/account',{headers:{Authorization:'Bearer '+ADMIN}})).json();assert.equal(actual.commands[0].status,'EXPIRED');
  await post(base,'/api/bridge/result',{id:c.id,status:'CONFIRMED',message:'TEST BROKER CONFIRMATION'},INGEST);
  const confirmed=await (await fetch(base+'/api/account',{headers:{Authorization:'Bearer '+ADMIN}})).json();assert.equal(confirmed.commands[0].status,'CONFIRMED');
});
test('login issues an HttpOnly cookie; logout revokes it; cross-origin mutations fail',async t=>{
  const {base}=await setup(t);let response=await post(base,'/api/login',{token:ADMIN});assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0];assert.match(response.headers.get('set-cookie'),/HttpOnly/);assert.match(response.headers.get('set-cookie'),/SameSite=Strict/);
  assert.equal((await fetch(base+'/api/account',{headers:{Cookie:cookie}})).status,200);
  await fetch(base+'/api/logout',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{}'});
  assert.equal((await fetch(base+'/api/account',{headers:{Cookie:cookie}})).status,401);
  response=await fetch(base+'/api/login',{method:'POST',headers:{Origin:'https://unrelated.example','Content-Type':'application/json'},body:JSON.stringify({token:ADMIN})});assert.equal(response.status,403);
});
test('web assets load and path traversal cannot expose the database or source secrets',async t=>{
  const {base}=await setup(t);for(const path of ['/','/app.js','/styles.css','/engine.mjs','/icon.svg','/manifest.webmanifest'])assert.equal((await fetch(base+path)).status,200);
  assert.equal((await fetch(base+'/.data/nabd.sqlite')).status,404);assert.equal((await fetch(base+'/server.mjs')).status,404);
  const res=await fetch(base+'/');assert.match(res.headers.get('content-security-policy'),/script-src 'self'/);assert.match(await res.text(),/viewport/);
});
test('real signal issuance is deduplicated and quotes cannot move its original levels',async t=>{
  let now=NOW;const {base,app}=await setup(t,{clock:()=>now});const raw=entryFixture();
  assert.equal((await post(base,'/api/mt5',raw,INGEST)).status,200);const before=app.signalRows()[0];assert.ok(before);
  now++;raw.quote_at=now;raw.bid+=.05;raw.ask+=.05;await post(base,'/api/mt5',raw,INGEST);
  const rows=app.signalRows();assert.equal(rows.length,1);assert.equal(rows[0].entry,before.entry);assert.equal(rows[0].tp1,before.tp1);assert.equal(rows[0].sl,before.sl);
});
