import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sqliteAuthStore} from './auth-store.mjs';
import {createRiskStopIntents} from './risk-stop-intents.mjs';
test('durable stop intents are owner isolated, idempotent, and NEVER confirmed MT5',async t=>{
 const store=sqliteAuthStore();await store.initialize();t.after(()=>store.close());
 const owner=randomUUID(),other=randomUUID(),accountId=randomUUID();
 for(const id of [owner,other])await store.query(
 'INSERT INTO nabd_users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)',
 [id,id+'@example.test','Test User','non-secret',1000]);
 await store.query("INSERT INTO nabd_member_mt5_accounts(id,user_id,broker,server_name,login,environment,created_at) VALUES(?,?,?,?,?,?,?)",
 [accountId,owner,'JustMarkets','Demo','20001','demo',1000]);
 const service=createRiskStopIntents({store,clock:()=>2000});
 await assert.rejects(()=>service.request(other,{accountId,symbol:'BTCUSD'}),e=>e.status===404);
 assert.deepEqual(await service.list(other),[]);
 const first=await service.request(owner,{accountId,symbol:'BTCUSD'});
 assert.equal(first.created,true);assert.equal(first.status,'AWAITING_MT5_ACK');
 assert.equal(first.confirmedByMT5,false);assert.equal(first.executionStopped,false);
 assert.equal(first.closePositions,false);
 const again=await service.request(owner,{accountId,symbol:'BTCUSD'});
 assert.equal(again.created,false);assert.equal(again.requestId,first.requestId);
 assert.deepEqual((await service.list(owner))[0].requestId,first.requestId);
 assert.equal((await service.list(other)).length,0);
 const audit=(await store.query("SELECT COUNT(*) AS count FROM nabd_auth_audit WHERE actor=? AND event='RISK_STOP_INTENT_STAGED'",[owner])).rows[0];
 assert.equal(Number(audit.count),1);
 await assert.rejects(()=>service.request(owner,{accountId,symbol:'EURUSD'}),e=>e.status===400);
 await assert.rejects(()=>service.request(owner,{accountId:'bad',symbol:'BTCUSD'}),e=>e.status===400);
});
