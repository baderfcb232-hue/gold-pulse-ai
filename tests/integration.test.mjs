import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cleanSnapshot,sourceAnalysis,trackPlan} from '../engine.mjs';
import {createApplication} from '../server.mjs';
import {NOW,eaFixture,entryFixture} from './fixtures.mjs';

test('EA plans preserve the exact bot levels and do not invent a first target or score',()=>{
  for(const side of ['BUY','SELL']){
    const raw=eaFixture(NOW,side),out=sourceAnalysis(cleanSnapshot(raw,NOW),NOW);
    assert.equal(out.source,'MT5_EA');assert.equal(out.decision,side);assert.equal(out.score,null);
    assert.equal(out.plan.entry,raw.ea.signal.entry);assert.equal(out.plan.sl,raw.ea.signal.sl);
    assert.equal(out.plan.tp2,raw.ea.signal.target);assert.equal(out.plan.tp1,null);
    const next=cleanSnapshot({...raw,quote_at:NOW+1},NOW+1);
    assert.equal(trackPlan(out.plan,next,NOW+1),null);
  }
});
test('a fresh bridge cannot hide a stopped main bot, pause or emergency stop',()=>{
  const raw=eaFixture();raw.ea.heartbeat_at=NOW-6;
  assert.equal(sourceAnalysis(cleanSnapshot(raw,NOW),NOW).source_ready,false);
  raw.ea.heartbeat_at=NOW;raw.execution.paused=true;
  assert.equal(sourceAnalysis(cleanSnapshot(raw,NOW),NOW).risk,'BLOCKED');
  raw.execution.paused=false;raw.ea.emergency_stop=true;
  assert.equal(sourceAnalysis(cleanSnapshot(raw,NOW),NOW).decision,'WAIT');
});
test('EA mode never falls back to a separate website signal when the bot is missing',()=>{
  const raw=entryFixture();assert.ok(sourceAnalysis(cleanSnapshot(raw,NOW),NOW,{signalSource:'DASHBOARD'}).plan);
  const out=sourceAnalysis(cleanSnapshot(raw,NOW),NOW);assert.equal(out.plan,null);assert.equal(out.source,'MT5_EA');
});
test('invalid bot levels and future signal times are rejected; old plans age out without breaking quotes',()=>{
  const raw=eaFixture();raw.ea.signal.sl=raw.ea.signal.entry+1;
  assert.throws(()=>cleanSnapshot(raw,NOW),/orientation/);
  raw.ea.signal.issued_at=NOW+60;assert.throws(()=>cleanSnapshot(raw,NOW),/signal time/);
  raw.ea.signal.issued_at=NOW-86400;assert.equal(cleanSnapshot(raw,NOW).ea.signal,null);
});
test('bridge → API → frozen EA history is deduplicated and source expiry blocks control',async t=>{
  let now=NOW;const dir=mkdtempSync(join(tmpdir(),'nabd-ea-link-'));
  const ingest='integration-test-ingest-xxxxxxxxxxxxxxxx',operator='integration-test-operator-yyyyyyyyyyyyy';
  const app=createApplication({dataDir:dir,storagePersistent:true,clock:()=>now,ingestToken:ingest,dashboardToken:operator});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+app.server.address().port;
  assert.equal((await fetch(base+'/api/mt5.zip')).status,401);
  const zipResponse=await fetch(base+'/api/mt5.zip',{headers:{Authorization:'Bearer '+operator}});
  assert.equal(zipResponse.status,200);assert.equal(zipResponse.headers.get('content-type'),'application/zip');
  const zip=Buffer.from(await zipResponse.arrayBuffer());assert.equal(zip.readUInt32LE(0),0x04034b50);
  assert.equal(zip.readUInt16LE(zip.length-22+10),4);assert.ok(zip.includes(Buffer.from('NABDPublishSignal')));
  const post=(path,data,token)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(data)});
  const raw=eaFixture();assert.equal((await post('/api/mt5',raw,ingest)).status,200);
  let state=await (await fetch(base+'/api/state')).json();
  assert.equal(state.signalSource,'MT5_EA');assert.equal(state.bot.settings.ema_fast,50);
  assert.equal(state.currentSignal.entry,raw.ea.signal.entry);assert.equal(state.currentSignal.tp1,null);
  now++;raw.quote_at=now;raw.bid+=.05;raw.ask+=.05;
  assert.equal((await post('/api/mt5',raw,ingest)).status,200);assert.equal(app.signalRows().length,1);
  assert.equal(app.signalRows()[0].entry,raw.ea.signal.entry);
  now+=6;raw.quote_at=now;await post('/api/mt5',raw,ingest);
  state=await (await fetch(base+'/api/state')).json();assert.equal(state.connection,'LIVE');
  assert.equal(state.signalSourceReady,false);assert.equal(state.currentSignal,null);
  assert.equal((await post('/api/commands',{action:'CLOSE_ALL'},operator)).status,409);
});
