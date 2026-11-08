import test from 'node:test';
import assert from 'node:assert/strict';
import {sqliteAuthStore} from '../auth-store.mjs';
import {createSubscriberSignalDispatch,validatePublicSignal} from '../subscriber-signal-dispatch.mjs';
const now=1794160000;
const sample=(id='pub-signal-1',symbol='BTCUSD')=>({id,symbol,status:'TRACKING',side:'BUY',entry:100,sl:99,tp1:103,issued_at:now-1,expires_at:now+40});
const setup=async t=>{
 const store=sqliteAuthStore();await store.initialize();t.after(()=>store.close());
 for(const id of ['a','b','c']){
  await store.query('INSERT INTO nabd_users(id,email,name,password_hash,verified_at,created_at) VALUES(?,?,?,?,?,?)',
   [id,id+'@example.test','Member','fake',1,1]);
  await store.query('INSERT INTO nabd_member_telegram(user_id,chat_id,linked_at) VALUES(?,?,?)',[id,String(id.charCodeAt(0)),now]);
 }
 const update=async(id,gold,bitcoin,signals)=>store.query(`INSERT INTO nabd_member_alert_preferences
   (user_id,gold_enabled,btc_enabled,signals_enabled,execution_enabled,system_enabled,updated_at)
   VALUES(?,?,?,?,0,1,?)`,[id,gold?1:0,bitcoin?1:0,signals?1:0,now]);
 await update('a',true,true,true);
 await update('b',true,false,true);
 await update('c',false,true,false);
 return store;
};
test('opt-in BTC fanout reaches only eligible member and cannot duplicate signal delivery',async t=>{
 const store=await setup(t),sent=[];
 const d=createSubscriberSignalDispatch({store,clock:()=>now,enabled:true,botToken:'TEST',fetcher:async(_url,request)=>{
  sent.push(JSON.parse(request.body));return {ok:true,json:async()=>({ok:true,result:{message_id:55}})};
 }});
 assert.deepEqual(await d.publish(sample()),{attempted:1,sent:1,enabled:true});
 assert.equal(sent.length,1);assert.equal(sent[0].chat_id,'97');
 assert.match(sent[0].text,/ليست صفقة منفذة/);
 assert.deepEqual(await d.publish(sample()),{attempted:0,sent:0,enabled:true});
 assert.equal((await store.query('SELECT status FROM nabd_member_telegram_deliveries WHERE user_id=?',['a'])).rows[0].status,'SENT');
});
test('no untrusted signal or disabled switch produces any outbound messages',async t=>{
 const store=await setup(t);let count=0;
 const d=createSubscriberSignalDispatch({store,clock:()=>now,enabled:false,botToken:'TEST',fetcher:async()=>{count++}});
 assert.equal((await d.publish(sample())).attempted,0);
 assert.equal(validatePublicSignal({...sample(),status:'EXECUTED'},now),false);
 assert.equal(validatePublicSignal({...sample(),symbol:'EURUSD'},now),false);
 assert.equal(validatePublicSignal({...sample(),sl:101},now),false);
 assert.equal(validatePublicSignal({...sample(),issued_at:now-999},now),false);
 assert.equal(count,0);
});
test('gold/BTC, signal type and global opt-out filter are independent',async t=>{
 const store=await setup(t),sent=[];
 await store.query('UPDATE nabd_users SET notifications=0 WHERE id=?',['a']);
 const d=createSubscriberSignalDispatch({store,clock:()=>now,enabled:true,botToken:'TEST',fetcher:async(_url,request)=>{
  sent.push(JSON.parse(request.body));return {ok:true,json:async()=>({ok:true,result:{message_id:10}})};
 }});
 // b subscribed to gold only; c has signals disabled; a global preference disabled.
 assert.equal((await d.publish(sample('gold-1','XAUUSD'))).sent,1);
 assert.equal(sent[0].chat_id,'98');
 assert.equal((await d.publish(sample('btc-1','BTCUSD'))).sent,0);
});
test('uncertain Telegram outcome is retained but never replayed',async t=>{
 const store=await setup(t),calls=[];
 const d=createSubscriberSignalDispatch({store,clock:()=>now,enabled:true,botToken:'TEST',
  fetcher:async()=>{calls.push('call');throw Error('uncertain');}});
 assert.equal((await d.publish(sample())).attempted,1);
 assert.equal((await store.query('SELECT status FROM nabd_member_telegram_deliveries WHERE user_id=?',['a'])).rows[0].status,'UNCERTAIN');
 assert.equal((await d.publish(sample())).attempted,0);
 assert.equal(calls.length,1);
});
