import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sqliteAuthStore} from './auth-store.mjs';
import {recordVerifiedDemoMonitorState,createMonitorStaleSweep} from './notification-monitor-events.mjs';
const uuid=()=>randomUUID();
test('verified read-only Demo transitions create exactly one owner-scoped notice per change',async t=>{
 const store=sqliteAuthStore();await store.initialize();t.after(()=>store.close());
 const owner=uuid(),other=uuid(),account=uuid();
 for(const id of [owner,other])await store.query(
  'INSERT INTO nabd_users(id,email,name,password_hash,verified_at,created_at) VALUES(?,?,?,?,?,?)',
  [id,id+'@example.test','Member','none',100,100]);
 await store.query('INSERT INTO nabd_member_mt5_accounts(id,user_id,broker,server_name,login,environment,created_at) VALUES(?,?,?,?,?,?,?)',
  [account,owner,'JustMarkets','JustMarkets-Demo2','345678','demo',100]);
 await store.query("INSERT INTO nabd_mt5_hosting_requests(account_id,status,requested_at) VALUES(?,'APPROVED',?)",[account,100]);
 await store.query('INSERT INTO nabd_mt5_monitor_workers(account_id,token_hash,worker_id,issued_at,last_seen_at,mt5_online) VALUES(?,?,?,?,?,?)',
  [account,'hash123',uuid(),100,1000,1]);
 const apply=(state,at)=>store.transaction(q=>recordVerifiedDemoMonitorState(q,{userId:owner,accountId:account,state,at}));
 assert.deepEqual(await apply('ONLINE',1000),{changed:true,state:'ONLINE',revision:1});
 assert.deepEqual(await apply('ONLINE',1001),{changed:false});
 assert.deepEqual(await apply('OFFLINE',1002),{changed:true,state:'OFFLINE',revision:2});
 assert.deepEqual(await apply('OFFLINE',1003),{changed:false});
 assert.deepEqual(await apply('ONLINE',1004),{changed:true,state:'ONLINE',revision:3});
 const events=(await store.query('SELECT event_type,title_en,body_en FROM nabd_member_notifications WHERE user_id=? ORDER BY created_at',[owner])).rows;
 assert.deepEqual(events.map(x=>x.event_type),['MT5_STATUS','MT5_DISCONNECTED','MT5_RECONNECTED']);
 assert.match(events[1].body_en,/not independent broker proof/i);
 assert.equal((await store.query('SELECT count(*) AS n FROM nabd_member_notifications WHERE user_id=?',[other])).rows[0].n,0);
 assert.equal((await store.query('SELECT revision FROM nabd_member_mt5_monitor_state WHERE account_id=?',[account])).rows[0].revision,3);
});
test('stale monitor report generates one uncertainty notice, not fake broker disconnection',async t=>{
 const store=sqliteAuthStore();await store.initialize();t.after(()=>store.close());
 const owner=uuid(),account=uuid(),worker=uuid();
 await store.query('INSERT INTO nabd_users(id,email,name,password_hash,verified_at,created_at) VALUES(?,?,?,?,?,?)',
 [owner,'stale@example.test','Member','none',100,100]);
 await store.query('INSERT INTO nabd_member_mt5_accounts(id,user_id,broker,server_name,login,environment,created_at) VALUES(?,?,?,?,?,?,?)',
 [account,owner,'JustMarkets','JustMarkets-Demo2','345678','demo',100]);
 await store.query("INSERT INTO nabd_mt5_hosting_requests(account_id,status,requested_at) VALUES(?,'APPROVED',?)",[account,100]);
 await store.query('INSERT INTO nabd_mt5_monitor_workers(account_id,token_hash,worker_id,issued_at,last_seen_at,mt5_online) VALUES(?,?,?,?,?,?)',
 [account,'hash456',worker,100,950,1]);
 await store.transaction(q=>recordVerifiedDemoMonitorState(q,{userId:owner,accountId:account,state:'ONLINE',at:950}));
 let now=1000;
 const sweep=createMonitorStaleSweep({store,clock:()=>now});
 assert.equal((await sweep()).changed,0);
 now=1011;assert.equal((await sweep()).changed,1);
 assert.deepEqual(await sweep(),{changed:0});
 const states=(await store.query('SELECT event_type,body_en FROM nabd_member_notifications WHERE user_id=? ORDER BY created_at',[owner])).rows;
 assert.deepEqual(states.map(x=>x.event_type),['MT5_STATUS','MT5_STATUS']);
 assert.match(states[1].body_en,/Broker connectivity is unverified/);
 await store.transaction(q=>recordVerifiedDemoMonitorState(q,{userId:owner,accountId:account,state:'ONLINE',at:1012}));
 const recovery=(await store.query('SELECT event_type FROM nabd_member_notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 1',[owner])).rows[0];
 assert.equal(recovery.event_type,'MT5_RECONNECTED');
});
test('system opt-out suppresses monitor notices but retains monitoring transition state',async t=>{
 const store=sqliteAuthStore();await store.initialize();t.after(()=>store.close());
 const owner=uuid(),account=uuid();
 await store.query('INSERT INTO nabd_users(id,email,name,password_hash,verified_at,created_at) VALUES(?,?,?,?,?,?)',
 [owner,'alerts-off@example.test','Member','none',100,100]);
 await store.query('INSERT INTO nabd_member_mt5_accounts(id,user_id,broker,server_name,login,environment,created_at) VALUES(?,?,?,?,?,?,?)',
 [account,owner,'JustMarkets','JustMarkets-Demo2','12345','demo',100]);
 await store.query('INSERT INTO nabd_member_alert_preferences(user_id,gold_enabled,btc_enabled,signals_enabled,execution_enabled,system_enabled,updated_at) VALUES(?,?,?,?,?,?,?)',
 [owner,1,1,1,0,0,100]);
 await store.transaction(q=>recordVerifiedDemoMonitorState(q,{userId:owner,accountId:account,state:'OFFLINE',at:100}));
 assert.equal((await store.query('SELECT count(*) AS n FROM nabd_member_notifications')).rows[0].n,0);
 assert.equal((await store.query('SELECT status FROM nabd_member_mt5_monitor_state')).rows[0].status,'OFFLINE');
});
