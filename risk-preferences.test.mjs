import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sqliteAuthStore} from './auth-store.mjs';
import {createRiskPreferences,validateRiskPreferences} from './risk-preferences.mjs';
const seed=()=>({accountId:randomUUID(),symbol:'BTCUSD',paused:true,riskPercent:0.4,maxDailyLoss:2,
 maxDailyTrades:6,maxOpenPositions:2,maxSpread:80,maxSlippage:10,quoteMaxAgeSeconds:5});
test('settings strictly reject unexpected fields, invalid stops, unlimited risk',()=>{
 for(const mutate of [p=>p.paused='false',p=>p.riskPercent=Infinity,p=>p.maxDailyTrades=0,
    p=>p.maxSpread=-1,p=>p.password='never',p=>p.accountId='wrong']){
  const p=seed();mutate(p);assert.throws(()=>validateRiskPreferences(p));
 }
});
test('saved Demo risk preferences persist, are owner-isolated and audited',async t=>{
 const store=sqliteAuthStore();await store.initialize();t.after(()=>store.close());
 const owner=randomUUID(),other=randomUUID(),p=seed();
 for(const id of [owner,other])await store.query(
  "INSERT INTO nabd_users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)",
  [id,id+'@test.invalid','Example','not-a-credential',1000]);
 await store.query("INSERT INTO nabd_member_mt5_accounts(id,user_id,broker,server_name,login,environment,created_at) VALUES(?,?,?,?,?,?,?)",
  [p.accountId,owner,'JustMarkets','Demo-1','987654','demo',1000]);
 const risk=createRiskPreferences({store,clock:()=>2000});
 assert.deepEqual(await risk.list(other),[]);
 await assert.rejects(()=>risk.save(other,p),e=>e.status===404);
 assert.deepEqual(await risk.save(owner,p),{saved:true,connectedToExecution:false,pausedPreference:true});
 assert.equal((await risk.list(owner))[0].riskPercent,0.4);
 assert.equal((await risk.list(other)).length,0);
 const changed={...p,paused:false,riskPercent:0.3};
 await risk.save(owner,changed);
 const values=await risk.list(owner);assert.equal(values.length,1);
 assert.equal(values[0].paused,false);assert.equal(values[0].riskPercent,0.3);
 assert.equal(values[0].connectedToExecution,false);
 assert.equal((await store.query("SELECT COUNT(*) AS n FROM nabd_auth_audit WHERE actor=?",[owner])).rows[0].n,2);
});
