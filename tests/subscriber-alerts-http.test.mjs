import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../server.mjs';
import {sqliteAuthStore} from '../auth-store.mjs';

test('phase 11 owner alerts are authenticated/CSRF protected; Telegram webhook binds only private chat',async t=>{
 const dataDir=mkdtempSync(join(tmpdir(),'nabd-alert-http-')),mail=[],sends=[];
 const botSecret='telegram-test-secret-0123456789';
 const app=createApplication({
  dataDir,publicBase:'https://nabd.example',
  accountOptions:{
   store:sqliteAuthStore(),env:{
    NABD_SUBSCRIBER_TELEGRAM_BOT_TOKEN:'123456:FAKE_BOT_TEST',
    NABD_SUBSCRIBER_TELEGRAM_BOT_USERNAME:'NabdSubscriberAlertsBot',
    NABD_SUBSCRIBER_TELEGRAM_WEBHOOK_SECRET:botSecret
   },
   adminEmail:'owner@example.test',encryptionKey:randomBytes(32),
   mailer:async msg=>mail.push(msg),backup:{key:randomBytes(32),storage:async()=>{}},
   telegramFetch:async(_url,req)=>{sends.push(JSON.parse(req.body));return {ok:true,json:async()=>({ok:true,result:{message_id:42}})};}
  }
 });
 await app.accounts.ready;
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 t.after(async()=>{await app.close();rmSync(dataDir,{recursive:true,force:true});});
 const root='http://127.0.0.1:'+app.server.address().port;
 const request=async(path,body,cookie='',csrf='',extra={})=>{
  const response=await fetch(root+path,{method:body===undefined?'GET':'POST',headers:{
   ...(body!==undefined?{'Content-Type':'application/json','Origin':'https://nabd.example'}:{}),
   ...(cookie?{'Cookie':cookie}:{}),...(csrf?{'X-NABD-CSRF':csrf}:{}),...extra},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,data:await response.json(),cookie:response.headers.getSetCookie().filter(x=>!x.includes('Max-Age=0')).map(x=>x.split(';')[0]).join('; ')};
 };
 assert.equal((await request('/api/auth/alerts')).status,401);
 const email='subscriber-alerts@example.test',password='Strong test password 2026!';
 assert.equal((await request('/api/auth/register',{email,name:'Subscriber Alert',password,acceptPrivacy:true})).status,202);
 const verify=mail.find(x=>x.kind==='verify'&&x.email===email);assert.ok(verify);
 assert.equal((await request('/api/auth/verify',{token:verify.token,password})).status,200);
 const login=await request('/api/auth/login',{email,password});
 assert.equal(login.status,200);const {cookie}=login,csrf=login.data.csrf;
 assert.ok(cookie);assert.ok(csrf);
 const initial=await request('/api/auth/alerts',undefined,cookie);
 assert.equal(initial.status,200);assert.equal(initial.data.telegram.linked,false);
 const prefs={gold:true,bitcoin:false,signals:true,execution:false,system:true};
 assert.equal((await request('/api/auth/alerts',prefs,cookie)).status,403);
 assert.equal((await request('/api/auth/alerts',prefs,cookie,csrf)).status,200);
 assert.equal((await request('/api/auth/alerts',undefined,cookie)).data.preferences.bitcoin,false);
 assert.equal((await request('/api/auth/telegram/test',{},cookie,csrf)).status,429);
 const link=await request('/api/auth/telegram/link',{},cookie,csrf);
 assert.equal(link.status,200);assert.match(link.data.url,/start=nabd_/);
 const start=new URL(link.data.url).searchParams.get('start');
 assert.equal((await request('/api/telegram/subscriber-webhook',{message:{chat:{id:67890,type:'private'},from:{id:67890},text:'/start '+start}},'','',{'X-Telegram-Bot-Api-Secret-Token':'bad'})).status,403);
 const packet={message:{chat:{id:67890,type:'private'},from:{id:67890},text:'/start '+start}};
 // Telegram calls the webhook without an Origin header.
 const web=await fetch(root+'/api/telegram/subscriber-webhook',{method:'POST',headers:{
  'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':botSecret
 },body:JSON.stringify(packet)});
 assert.equal(web.status,200);
 assert.equal((await request('/api/auth/alerts',undefined,cookie)).data.telegram.linked,true);
 const sent=await request('/api/auth/telegram/test',{},cookie,csrf);
 assert.equal(sent.status,200);assert.equal(sends.length,1);assert.equal(sends[0].chat_id,'67890');
 assert.equal((await request('/api/auth/telegram/test',{},cookie,csrf)).status,429);
 assert.equal((await request('/api/auth/telegram/unlink',{},cookie,csrf)).status,200);
 assert.equal((await request('/api/auth/alerts',undefined,cookie)).data.telegram.linked,false);
});
