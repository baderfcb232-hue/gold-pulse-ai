import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from './server.mjs';
import {eaFixture,NOW} from './tests/fixtures.mjs';

function rawSnapshot(now=NOW) {
  const s=eaFixture(now);s.positions=[];s.deals=[];s.execution.demo_recommendations=true;
  const end=Math.floor(now/86400)*86400;
  s.daily_candles=Array.from({length:1000},(_,i)=>{
    const c=4000+i*.1;return {time:end-(1000-i)*86400,open:c,high:c+1,low:c-1,close:c};
  });return s;
}
async function setup(t,enabled=true) {
  let now=NOW;
  const raw=rawSnapshot(),dir=mkdtempSync(join(tmpdir(),'nabd-demo-execution-'));
  const token='TEST_INGEST_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
  const app=createApplication({dataDir:dir,ingestToken:token,clock:()=>now,
    config:{publicationEnabled:true,demoRecommendationExecution:enabled,brokerCostProfiles:[{
      accountRef:raw.account_ref,broker:raw.broker,symbol:raw.symbol,magic:raw.execution.managed_magic,
      verifiedAt:NOW,evidence:'SYNTHETIC TEST ONLY',costs:{spreadBps:.2,slippageBps:.01,commissionBps:.01,carryBpsPerDay:.01,acknowledged:true}}]}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  app.ingest(raw);
  const base='http://127.0.0.1:'+app.server.address().port;
  const source={account_ref:raw.account_ref,broker:raw.broker,symbol:raw.symbol,magic:raw.execution.managed_magic};
  const post=(body=source,auth=token)=>fetch(base+'/api/bridge/demo-recommendation',{method:'POST',
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth},body:JSON.stringify(body)});
  return {app,raw,post,source,setNow:n=>now=n};
}
test('only a fresh approved matching Demo plan crosses the authenticated bridge; requests create no orders',async t=>{
  const {app,raw,post,source,setNow}=await setup(t);
  assert.equal((await post(source,'wrong')).status,401);
  assert.equal((await post({...source,magic:'another'})).status,409);
  assert.equal((await post({...source,account_ref:'another'})).status,409);
  assert.equal(app.publicState().demoExecution.ready,true);
  for(let i=0;i<2;i++) {
    const response=await post();assert.equal(response.status,200);
    const wire=(await response.text()).split('|');
    assert.deepEqual(wire.slice(0,5),['NBDEMO1',source.account_ref,source.symbol,source.magic,'BUY']);
    assert.equal(Number(wire[5]),raw.ea.signal.entry);assert.equal(Number(wire[6]),raw.ea.signal.sl);
    assert.equal(Number(wire[7]),raw.ea.signal.target);assert.equal(Number(wire[9]),NOW+15);
    assert.equal(Number(wire[10]),raw.ea.signal.bar_time);
  }
  assert.equal(app.db.prepare('SELECT count(*) n FROM commands').get().n,0);
  setNow(NOW+11);assert.equal(await (await post()).text(),'');
});
test('default switch, old MT5, existing positions and a real account cannot receive approval',async t=>{
  const disabled=await setup(t,false);assert.equal(await (await disabled.post()).text(),'');
  const {app,raw,post}=await setup(t);
  raw.execution.demo_recommendations=false;app.ingest(raw);assert.equal(await (await post()).text(),'');
  raw.execution.demo_recommendations=true;raw.execution.demo=false;app.ingest(raw);
  assert.equal(await (await post()).text(),'');
  raw.execution.demo=true;raw.positions=[{ticket:'1',side:'BUY',volume:.01,entry:4008,sl:4006,tp:4012,profit:0,swap:0,opened_at:NOW}];
  app.ingest(raw);assert.equal(await (await post()).text(),'');
});
test('publication safeguards remain required for Demo execution',async t=>{
  const {app,raw,post}=await setup(t);
  raw.calendar.events=[{id:'news',name:'Synthetic USD News',currency:'USD',time:NOW,importance:3}];
  app.ingest(raw);assert.equal(await (await post()).text(),'');
  assert.equal(app.publicState().demoExecution.reason,'PLAN_NOT_APPROVED');
});
test('a published plan over the account risk budget cannot receive bridge approval or disclose its account budget',async t=>{
  const {app,raw,post}=await setup(t);
  raw.account={...raw.account,balance:200,equity:200,free_margin:200};app.ingest(raw);
  const state=app.publicState();
  assert.equal(state.demoExecution.reason,'BELOW_MINIMUM_VOLUME');
  assert.equal(await (await post()).text(),'');
  assert.deepEqual(Object.keys(state.demoExecution).sort(),['ready','reason']);
  assert.equal(app.db.prepare('SELECT count(*) n FROM commands').get().n,0);
});
