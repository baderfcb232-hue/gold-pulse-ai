import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sqliteAuthStore} from './auth-store.mjs';
import {createNotificationCenter,NOTIFICATION_TYPES} from './notification-center.mjs';

async function setup(t){
 const store=sqliteAuthStore();await store.initialize();t.after(()=>store.close());
 const users=[randomUUID(),randomUUID(),randomUUID()];
 for(let i=0;i<users.length;i++)
  await store.query('INSERT INTO nabd_users(id,email,name,password_hash,verified_at,created_at,notifications,recommendations) VALUES(?,?,?,?,?,?,?,?)',
   [users[i],i+'@example.test','Member','test-hash',100,100,i===2?0:1,1]);
 let now=1794600000;
 const center=createNotificationCenter({store,clock:()=>now});
 return {store,users,center,now:()=>now,advance:n=>now+=n};
}
const signal=now=>({id:'GOLD-REF-13',symbol:'XAUUSD',status:'TRACKING',side:'BUY',
 entry:4000,sl:3990,tp1:4020,issued_at:now-3,expires_at:now+90});

test('real reference signals become per-member inbox entries without false broker fills or duplicate events',async t=>{
 const {store,users,center,now}=await setup(t);
 assert.deepEqual(await center.publishSignal(signal(now())),{accepted:true,inserted:2});
 assert.deepEqual(await center.publishSignal(signal(now())),{accepted:true,inserted:0});
 const one=await center.list(users[0]),two=await center.list(users[1]),disabled=await center.list(users[2]);
 assert.equal(one.items.length,1);
 assert.equal(two.items.length,1);
 assert.equal(disabled.items.length,0);
 assert.equal(one.unreadCount,1);
 assert.equal(one.items[0].eventType,'GOLD_SIGNAL');
 assert.match(one.items[0].bodyEn,/not a confirmed trade/);
 assert.match(one.items[0].bodyAr,/ليست صفقة منفّذة/);
 assert.equal((await store.query('SELECT COUNT(*) AS n FROM nabd_member_notifications')).rows[0].n,2);
 const invalid={...signal(now()),status:'EXECUTED'};
 assert.deepEqual(await center.publishSignal(invalid),{accepted:false,inserted:0});
});
test('read/archive/delete and market/type filters are strictly owner scoped',async t=>{
 const {store,users,center,now,advance}=await setup(t);
 await center.publishSignal(signal(now()));
 const id=(await center.list(users[0])).items[0].id;
 await assert.rejects(()=>center.update(users[1],{id,action:'delete'}),e=>e.status===404);
 await assert.rejects(()=>center.update(users[0],{id,action:'EXECUTE'}),e=>e.status===400);
 await center.update(users[0],{id,action:'read'});
 assert.equal((await center.list(users[0],{state:'unread'})).items.length,0);
 assert.equal((await center.list(users[0],{state:'read'})).items.length,1);
 assert.equal((await center.list(users[0])).unreadCount,0);
 await center.update(users[0],{id,action:'unread'});
 assert.equal((await center.list(users[0])).unreadCount,1);
 assert.equal((await center.list(users[0],{type:'BTC_SIGNAL'})).items.length,0);
 assert.equal((await center.list(users[0],{market:'BTCUSD'})).items.length,0);
 await center.update(users[0],{id,action:'archive'});
 assert.equal((await center.list(users[0])).items.length,0);
 assert.equal((await center.list(users[0],{state:'archived'})).items.length,1);
 await center.update(users[0],{id,action:'restore'});
 assert.equal((await center.list(users[0])).items.length,1);
 await center.update(users[0],{id,action:'delete'});
 assert.equal((await center.list(users[0],{state:'archived'})).items.length,0);
 assert.equal((await center.list(users[0])).items.length,0);
 assert.equal((await center.list(users[1])).items.length,1);
 advance(31*86400);
 assert.equal((await center.purgeDeleted()).purged,1);
 assert.equal((await store.query('SELECT COUNT(*) AS n FROM nabd_member_notifications')).rows[0].n,1);
});
test('the inbox respects member preferences and rejects untrusted input',async t=>{
 const {store,users,center,now}=await setup(t);
 await store.query('INSERT INTO nabd_member_alert_preferences(user_id,gold_enabled,btc_enabled,signals_enabled,execution_enabled,system_enabled,updated_at) VALUES(?,?,?,?,?,?,?)',
 [users[0],0,1,1,0,1,100]);
 assert.equal((await center.publishSignal(signal(now()))).inserted,1);
 assert.equal((await center.list(users[0])).items.length,0);
 assert.equal((await center.list(users[1])).items.length,1);
 await assert.rejects(()=>center.list(users[0],{type:'INVALID'}),e=>e.status===400);
 await assert.rejects(()=>center.list(users[0],{state:'deleted'}),e=>e.status===400);
 await assert.rejects(()=>center.list(users[0],{offset:-1}),e=>e.status===400);
 await assert.rejects(()=>center.emitForMember(users[0],{eventType:'TRADE_EXECUTED',eventKey:'fake'}),e=>e.status===400);
 assert.ok(NOTIFICATION_TYPES.includes('TRADE_REJECTED'));
 assert.ok(NOTIFICATION_TYPES.includes('SUBSCRIPTION_EXPIRED'));
});
