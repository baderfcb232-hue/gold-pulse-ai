import test from 'node:test';
import assert from 'node:assert/strict';
import {sqliteAuthStore} from '../auth-store.mjs';
import {createSubscriberAlerts,DEFAULT_SUBSCRIBER_ALERTS} from '../subscriber-alerts.mjs';

const secret='really-long-subscriber-bot-webhook-secret',token='123456:TEST_SUBSCRIBER_BOT_TOKEN',username='NabdSubscriberAlertsBot';
async function setup(t){
 const store=sqliteAuthStore();await store.initialize();
 const owner=async id=>store.query('INSERT INTO nabd_users(id,email,name,password_hash,verified_at,created_at) VALUES(?,?,?,?,?,?)',[id,id+'@example.test','Nabd Member','not-real',100,100]);
 await owner('ownerA');await owner('ownerB');
 let now=1794160000, sent=[];
 const alerts=createSubscriberAlerts({store,clock:()=>now,botToken:token,botUsername:username,
  webhookSecret:secret,fetcher:async(url,options)=>{
   sent.push({url,body:JSON.parse(options.body)});
   return {ok:true,json:async()=>({ok:true,result:{message_id:123}})};
  }});
 t.after(async()=>store.close());
 return {store,alerts,sent,setTime:n=>now=n};
}
const webhook=(id,start)=>({update_id:12,message:{chat:{id,type:'private'},from:{id},text:'/start '+start}});
test('preferences are isolated per owner and only accept exact boolean switches',async t=>{
 const {alerts}=await setup(t);
 assert.deepEqual((await alerts.state('ownerA')).preferences,DEFAULT_SUBSCRIBER_ALERTS);
 assert.equal((await alerts.state('ownerA')).telegram.linked,false);
 await alerts.updatePreferences('ownerA',{gold:true,bitcoin:false,signals:true,execution:true,system:false});
 assert.deepEqual((await alerts.state('ownerA')).preferences,{gold:true,bitcoin:false,signals:true,execution:true,system:false});
 assert.deepEqual((await alerts.state('ownerB')).preferences,DEFAULT_SUBSCRIBER_ALERTS);
 await assert.rejects(()=>alerts.updatePreferences('ownerA',{gold:'yes',bitcoin:false,signals:true,execution:false,system:false}),/Invalid alert/);
 await assert.rejects(()=>alerts.updatePreferences('ownerA',{gold:true}),/Invalid alert/);
});
test('private one-time deep-link is hashed, expires, and cannot bind groups',async t=>{
 const {alerts,store,setTime}=await setup(t);
 const start=await alerts.startLink('ownerA');
 assert.match(start.url,/^https:\/\/t\.me\/NabdSubscriberAlertsBot\?start=nabd_[A-Za-z0-9_-]{43}$/);
 const param=new URL(start.url).searchParams.get('start');
 const row=(await store.query('SELECT * FROM nabd_member_telegram_pending WHERE user_id=?',['ownerA'])).rows[0];
 assert.equal(row.token_hash.length,64);
 assert.equal(JSON.stringify(row).includes(param.slice(5)),false);
 await assert.rejects(()=>alerts.acceptWebhook('wrong',webhook(123,param)),/Forbidden/);
 const group=webhook(123,param);group.message.chat.type='group';
 await alerts.acceptWebhook(secret,group);
 assert.equal((await alerts.state('ownerA')).telegram.linked,false);
 await alerts.acceptWebhook(secret,webhook(123,param));
 assert.equal((await alerts.state('ownerA')).telegram.linked,true);
 const pending=(await store.query('SELECT * FROM nabd_member_telegram_pending WHERE user_id=?',['ownerA'])).rows;
 assert.equal(pending.length,0);
 await alerts.acceptWebhook(secret,webhook(456,param));
 assert.equal((await store.query('SELECT chat_id FROM nabd_member_telegram WHERE user_id=?',['ownerA'])).rows[0].chat_id,'123');
 const next=await alerts.startLink('ownerB');
 setTime(next.expiresAt+1);
 await alerts.acceptWebhook(secret,webhook(789,new URL(next.url).searchParams.get('start')));
 assert.equal((await alerts.state('ownerB')).telegram.linked,false);
});
test('test message is sent only to linked private Telegram, throttled and revocable',async t=>{
 const {alerts,sent,setTime}=await setup(t);
 await assert.rejects(()=>alerts.sendTest('ownerA'),/Link Telegram first/);
 const link=await alerts.startLink('ownerA');
 await alerts.acceptWebhook(secret,webhook(909,new URL(link.url).searchParams.get('start')));
 assert.deepEqual(await alerts.sendTest('ownerA'),{sent:true});
 assert.equal(sent.length,1);
 assert.equal(sent[0].body.chat_id,'909');
 assert.match(sent[0].body.text,/ليست توصية تداول/);
 await assert.rejects(()=>alerts.sendTest('ownerA'),/retry after one minute/);
 setTime(1794160061);assert.deepEqual(await alerts.sendTest('ownerA'),{sent:true});
 await alerts.unlink('ownerA');
 assert.equal((await alerts.state('ownerA')).telegram.linked,false);
 await assert.rejects(()=>alerts.sendTest('ownerA'),/Link Telegram first/);
});
test('bot missing configuration fails closed while owner preferences remain functional',async t=>{
 const store=sqliteAuthStore();await store.initialize();t.after(()=>store.close());
 const alerts=createSubscriberAlerts({store,botToken:'',botUsername:'',webhookSecret:''});
 assert.equal(alerts.configured,false);
 await assert.rejects(()=>alerts.startLink('member'),/not configured/);
 await assert.rejects(()=>alerts.sendTest('member'),/not configured/);
 await assert.rejects(()=>alerts.acceptWebhook('secret',{}),/Forbidden/);
});
