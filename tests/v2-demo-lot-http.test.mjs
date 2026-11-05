import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../server.mjs';
import {eaFixture,NOW} from './fixtures.mjs';
import {entrySourceKey} from '../website-entry.mjs';

// Synthetic JustMarkets Demo contract: no MT5 login, live accounts or broker orders.
const INGEST='sizing-contract-ingest-xxxxxxxxxxxxxxxxxxxx';
const OPERATOR='sizing-contract-operator-yyyyyyyyyyyyyyyy';
test('Demo lot saver enforces account authorization, fresh MT5 specs, lot step and broker limits at API boundary',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'nabd-sizing-'));
 let now=NOW, saved=[];
 const journal={
  async close(){},
  async setTradeSizing(source,mode,lot,when){
   saved.push({source,mode,lot,when});
   return {mode,lot,updated_at:when};
  },
  async getTradeSizing(source){const record=saved.findLast(x=>x.source===source);return record||{mode:'AUTO',lot:null}}
 };
 const app=createApplication({dataDir:dir,ingestToken:INGEST,dashboardToken:OPERATOR,
  clock:()=>now,commandJournal:journal});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;
 const raw=eaFixture(NOW);
 const post=(payload,token=OPERATOR)=>fetch(base+'/api/trade-sizing',{method:'POST',
  headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(payload)});
 const spec=raw.spec;
 // No ingestion -> never accept a claimed fixed lot.
 assert.equal((await post({symbol:'XAUUSD',mode:'FIXED',lot:.01})).status,409);
 assert.equal(saved.length,0);
 assert.equal((await fetch(base+'/api/mt5',{method:'POST',
  headers:{'Content-Type':'application/json',Authorization:'Bearer '+INGEST},body:JSON.stringify(raw)})).status,200);
 for(const lot of [0,.009,.015,50.01,Number.NaN]){
  const res=await post({symbol:'XAUUSD',mode:'FIXED',lot});
  assert.equal(res.status,400,'invalid volume '+lot);
 }
 assert.equal(saved.length,0,'no invalid volume may persist');
 const unauthed=await post({symbol:'XAUUSD',mode:'FIXED',lot:.07},'invalid-operator');
 assert.equal(unauthed.status,401);
 assert.equal(saved.length,0);
 const valid=await post({symbol:'XAUUSD',mode:'FIXED',lot:.07});
 assert.equal(valid.status,200);
 const body=await valid.json();
 assert.equal(body.symbol,'XAUUSD');assert.equal(body.lot,.07);
 assert.equal(saved.length,1);assert.equal(saved[0].lot,.07);
 assert.ok(saved[0].source,'saved volume must be source locked');
 const automatic=await post({symbol:'XAUUSD',mode:'AUTO'});
 assert.equal(automatic.status,200);
 assert.equal((await automatic.json()).mode,'AUTO');
 assert.equal(saved.at(-1).lot,null);
 const missingBtc=await post({symbol:'BTCUSD',mode:'FIXED',lot:.07});
 assert.equal(missingBtc.status,409,'Gold account must never authorize Bitcoin volume');
 now=NOW+11;
 assert.equal((await post({symbol:'XAUUSD',mode:'FIXED',lot:.07})).status,409,'Stale quote');
 assert.equal(saved.length,2);
 assert.equal(spec.volume_step,.01,'test requires broker step from fixture');
});
test('real-account flag is never accepted for Demo volume save',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'nabd-sizing-real-'));
 const saved=[];const app=createApplication({dataDir:dir,ingestToken:INGEST,dashboardToken:OPERATOR,clock:()=>NOW,
  commandJournal:{close:async()=>{},setTradeSizing:async(...args)=>{saved.push(args);return {mode:'FIXED',lot:args[2]}}}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const raw=eaFixture(NOW);raw.execution.demo=false;
 app.ingest(raw);
 const res=await fetch('http://127.0.0.1:'+app.server.address().port+'/api/trade-sizing',{method:'POST',
  headers:{'Content-Type':'application/json',Authorization:'Bearer '+OPERATOR},body:JSON.stringify({symbol:'XAUUSD',mode:'FIXED',lot:.1})});
 assert.equal(res.status,409);assert.equal(saved.length,0);
});
