import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sqliteAuthStore} from './auth-store.mjs';
import {recordVerifiedDemoMonitorState} from './notification-monitor-events.mjs';
import {createMonitorTelegramAlerts} from './notification-monitor-telegram.mjs';
async function fixture(t){
 const store=sqliteAuthStore();await store.initialize();t.after(()=>store.close());
 const owner=randomUUID(),account=randomUUID();
 await store.query('INSERT INTO nabd_users(id,email,name,password_hash,verified_at,created_at) VALUES(?,?,?,?,?,?)',
 [owner,owner+'@example.test','Test','nonsecret',100,100]);
 await store.query('INSERT INTO nabd_member_mt5_accounts(id,user_id,broker,server_name,login,environment,created_at) VALUES(?,?,?,?,?,?,?)',
 [account,owner,'JustMarkets','JustMarkets-Demo2','55443322','demo',100]);
 await store.query('INSERT INTO nabd_member_telegram(user_id,chat_id,linked_at) VALUES(?,?,?)',[owner,'78910',100]);
 let now=1000;
 const state=async(name)=>store.transaction(q=>recordVerifiedDemoMonitorState(q,{userId:owner,accountId:account,state:name,at:now}));
 const key=revision=>'MT5MON:'+account+':'+revision;
 const advance=value=>{now=value};
 return {store,owner,account,state,key,advance,clock:()=>now};
}
test('Telegram monitoring requires explicit opt in and deduplicates authenticated reports',async t=>{
 const f=await fixture(t),sends=[];
 await f.state('OFFLINE');
 const off=createMonitorTelegramAlerts({store:f.store,clock:f.clock,botToken:'TESTTOKEN'});
 assert.equal((await off.publish(f.owner,f.key(1))).attempted,false);
 const enabled=createMonitorTelegramAlerts({store:f.store,clock:f.clock,
  enabled:true,botToken:'TESTTOKEN',fetcher:async(_url,req)=>{
   sends.push(JSON.parse(req.body));
   return {ok:true,json:async()=>({ok:true,result:{message_id:21}})};
  }});
 assert.deepEqual(await enabled.publish(f.owner,f.key(1)),{attempted:true,enabled:true,sent:true});
 assert.equal(sends.length,1);assert.equal(sends[0].chat_id,'78910');
 assert.match(sends[0].text,/لا تؤكد تنفيذ أو إيقاف صفقة/);
 assert.deepEqual(await enabled.publish(f.owner,f.key(1)),{attempted:false,enabled:true});
 assert.equal((await f.store.query("SELECT status FROM nabd_member_telegram_monitor_deliveries")).rows[0].status,'SENT');
 f.advance(1001);await f.state('ONLINE');
 assert.equal((await enabled.publish(f.owner,f.key(2))).attempted,false); // cooldown
 f.advance(1100);await f.state('OFFLINE');
 assert.equal((await enabled.publish(f.owner,f.key(3))).sent,true);
 assert.equal(sends.length,2);
});
test('uncertain Telegram outcome cannot be automatically retried',async t=>{
 const f=await fixture(t);await f.state('OFFLINE');let sent=0;
 const notify=createMonitorTelegramAlerts({store:f.store,clock:f.clock,enabled:true,
  botToken:'TESTTOKEN',fetcher:async()=>{sent++;throw Error('network unavailable')}});
 assert.deepEqual(await notify.publish(f.owner,f.key(1)),{attempted:true,enabled:true,sent:false});
 assert.equal((await f.store.query("SELECT status FROM nabd_member_telegram_monitor_deliveries")).rows[0].status,'UNCERTAIN');
 assert.equal((await notify.publish(f.owner,f.key(1))).attempted,false);
 assert.equal(sent,1);
});
test('unlink and system notification opt-out prevent private sends',async t=>{
 const f=await fixture(t);await f.state('OFFLINE');
 await f.store.query('DELETE FROM nabd_member_telegram WHERE user_id=?',[f.owner]);
 const notify=createMonitorTelegramAlerts({store:f.store,clock:f.clock,enabled:true,botToken:'TESTTOKEN',
  fetcher:async()=>{throw Error('should never send')}});
 assert.equal((await notify.publish(f.owner,f.key(1))).attempted,false);
 await f.store.query('INSERT INTO nabd_member_telegram(user_id,chat_id,linked_at) VALUES(?,?,?)',
 [f.owner,'78910',100]);
 await f.store.query('INSERT INTO nabd_member_alert_preferences(user_id,gold_enabled,btc_enabled,signals_enabled,execution_enabled,system_enabled,updated_at) VALUES(?,?,?,?,?,?,?)',
 [f.owner,1,1,1,0,0,100]);
 assert.equal((await notify.publish(f.owner,f.key(1))).attempted,false);
 assert.equal((await f.store.query('SELECT COUNT(*) AS n FROM nabd_member_telegram_monitor_deliveries')).rows[0].n,0);
});
