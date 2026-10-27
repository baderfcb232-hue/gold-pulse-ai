import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../server.mjs';
import {fixture,NOW} from './fixtures.mjs';

test('delayed valid gold snapshot is ignored without rolling back quote, flags or freshness', async ()=>{
 const dir=mkdtempSync(join(tmpdir(),'nabd-order-'));
 const app=createApplication({dataDir:dir,clock:()=>NOW,config:{signalSource:'DASHBOARD'}});
 try {
  const fresh=fixture();app.ingest(fresh);
  const older=fixture();older.quote_at=NOW-2;older.bid=100;older.ask=101;
  older.execution={...older.execution,enabled:false};
  assert.deepEqual(app.ingest(older),{ignored:true,reason:'STALE_QUOTE',accepted_quote_at:NOW});
  const state=app.publicState();
  assert.equal(state.bid,fresh.bid);assert.equal(state.ask,fresh.ask);
  assert.equal(state.lastUpdate,NOW);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
test('invalid future quote is still rejected',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nabd-invalid-'));
 const app=createApplication({dataDir:dir,clock:()=>NOW});
 try{assert.throws(()=>app.ingest({...fixture(),quote_at:NOW+60}),/quote_at/);}
 finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
