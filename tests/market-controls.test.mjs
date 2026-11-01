import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../server.mjs';
import {eaFixture,NOW} from './fixtures.mjs';
import {createCommandTracker} from '../public/command-feedback.js';
const INGEST='controls-ingest-xxxxxxxxxxxxxxxxxxxxxxxx',ADMIN='controls-admin-yyyyyyyyyyyyyyyyyyyyyyyy';
async function setup(t){
 const dir=mkdtempSync(join(tmpdir(),'market-controls-'));let now=NOW;
 const app=createApplication({dataDir:dir,storagePersistent:true,clock:()=>now,ingestToken:INGEST,dashboardToken:ADMIN,config:{goldOnly:false}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;
 const post=(path,data,token=INGEST)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(data)});
 const get=async path=>(await fetch(base+path,{headers:{Authorization:'Bearer '+INGEST}})).text();
 const gold=eaFixture(),btc=eaFixture();
 for(const s of [gold,btc])s.execution.control_protocol=2;
 btc.symbol='BTCUSD.m';btc.execution.managed_magic='26092302';btc.positions[0].ticket='902';
 const identity=s=>({account_ref:s.account_ref,broker:s.broker,symbol:s.symbol,magic:s.execution.managed_magic});
 const poll=s=>post('/api/bridge/control-next',identity(s));
 const ingest=async s=>assert.equal((await post('/api/mt5',s)).status,200);
 const command=(symbol,action,ticket)=>post('/api/commands',{symbol,action,ticket},ADMIN);
 return {app,base,gold,btc,identity,poll,ingest,command,post,get,setNow:n=>{now=n;}};
}
test('BTC controls work while gold price is stale; polling and acknowledgments stay source locked',async t=>{
 const h=await setup(t);h.gold.quote_at=NOW-3600;
 await h.ingest(h.gold);await h.ingest(h.btc);
 let r=await h.command('BTCUSD','PAUSE');assert.equal(r.status,202);const cmd=await r.json();
 assert.equal(await h.get('/api/bridge/next'),'','legacy gold must never consume targeted BTC');
 assert.equal(await (await h.poll(h.gold)).text(),'');
 let wire=await (await h.poll(h.btc)).text();assert.match(wire,/PAUSE\|0/);
 assert.equal((await h.post('/api/bridge/result',{...h.identity(h.gold),id:cmd.id,status:'CONFIRMED',message:'PAUSE'})).status,409);
 assert.equal((await h.post('/api/bridge/result',{...h.identity(h.btc),id:cmd.id,status:'CONFIRMED',message:'PAUSE'})).status,200);
 assert.equal((await h.command('BTCUSD','CLOSE_POSITION','901')).status,400,'cannot close gold ticket from BTC');
 assert.equal((await h.command('BTCUSD','CLOSE_POSITION','902')).status,202);
 assert.equal((await h.command('XAUUSD','RESUME')).status,409,'stale gold cannot resume entry');
 assert.equal((await h.command('XAUUSD','PAUSE')).status,202,'fresh heartbeat can pause entry on closed market');
 const pub=await (await fetch(h.base+'/api/state')).json();
 assert.equal(pub.controls.BTCUSD.execution.control_protocol,2);
 assert.equal(pub.controls.XAUUSD.connection,'STALE');
 assert.ok(!JSON.stringify(pub.controls).includes(h.gold.account_ref));
});
test('source changes, stale heartbeats, old executors, duplicate commands and expiry cannot route a new command',async t=>{
 const h=await setup(t);await h.ingest(h.gold);h.btc.execution.control_protocol=1;await h.ingest(h.btc);
 assert.equal((await h.command('BTCUSD','RESUME')).status,409);
 h.btc.execution.control_protocol=2;h.btc.ea.heartbeat_at=NOW-6;await h.ingest(h.btc);
 assert.equal((await h.command('BTCUSD','RESUME')).status,409);
 h.btc.ea.heartbeat_at=NOW;await h.ingest(h.btc);
 assert.equal((await h.command('BTCUSD','RESUME')).status,202);
 assert.equal((await h.command('BTCUSD','PAUSE')).status,409);
 const wrong={...h.identity(h.btc),magic:'26092301'};
 assert.equal((await h.post('/api/bridge/control-next',wrong)).status,409);
 h.setNow(NOW+21);assert.equal(await (await h.poll(h.btc)).text(),'');
});
test('control reconciliation does not mistake a gold confirmation for an uncertain BTC request',()=>{
 const tracker=createCommandTracker();tracker.begin('PAUSE','0',NOW,'BTCUSD');tracker.failed(new Error('network'));
 tracker.observe([{id:1,symbol:'XAUUSD',action:'PAUSE',ticket:'0',time:NOW,status:'CONFIRMED'}],NOW+1);
 assert.equal(tracker.get().status,'VERIFYING');
 tracker.observe([{id:2,symbol:'BTCUSD',action:'PAUSE',ticket:'0',time:NOW,status:'REJECTED'}],NOW+2);
 assert.equal(tracker.get().status,'REJECTED');
});
test('both integrated executors carry the isolated control poll and identity in acknowledgment',()=>{
 for(const a of ['GOLD','BTC']){
  const s=readFileSync(new URL('../mt5/NABD_'+a+'_4_01.mq5',import.meta.url),'utf8');
  assert.ok(s.includes('/api/bridge/control-next'));
  assert.ok(s.includes('NBControlIdentity()+'));
  assert.ok(s.includes('\\"control_protocol\\":2'));
  assert.ok(s.includes('GlobalVariablesFlush();'));
 }
});
