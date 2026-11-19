import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from './server.mjs';
import {sqliteAuthStore} from './auth-store.mjs';
import {createNotificationCenter} from './notification-center.mjs';

test('phase 13 authenticated HTTP inbox rejects cross-member access, CSRF bypass, and fabricated events',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'nabd-phase13-')),mails=[],store=sqliteAuthStore();
 const app=createApplication({dataDir:dir,publicBase:'https://nabd.example',accountOptions:{
   store,env:{},adminEmail:'owner@example.test',encryptionKey:randomBytes(32),
   mailer:async x=>mails.push(x),backup:{key:randomBytes(32),storage:async()=>{}}
 }});
 await app.accounts.ready;
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;
 const request=async(path,payload,cookie='',csrf='',origin='https://nabd.example')=>{
  const res=await fetch(base+path,{method:payload===undefined?'GET':'POST',headers:{
    ...(cookie?{Cookie:cookie}:{}),
    ...(payload===undefined?{}:{'Content-Type':'application/json',Origin:origin}),
    ...(csrf?{'X-NABD-CSRF':csrf}:{})
  },...(payload===undefined?{}:{body:JSON.stringify(payload)})});
  const data=await res.json();
  return {status:res.status,data,cookie:res.headers.getSetCookie()
   .filter(x=>!x.includes('Max-Age=0')).map(x=>x.split(';')[0]).join('; ')};
 };
 const register=async(i)=>{
  const email='phase13-'+i+'@example.test',password='Long secure test password 2026!';
  assert.equal((await request('/api/auth/register',{email,name:'Nabd User',password,acceptPrivacy:true})).status,202);
  const token=mails.filter(m=>m.email===email&&m.kind==='verify').at(-1).token;
  assert.equal((await request('/api/auth/verify',{token,password})).status,200);
  const login=await request('/api/auth/login',{email,password});
  assert.equal(login.status,200);
  return {id:login.data.user.id,cookie:login.cookie,csrf:login.data.csrf};
 };
 const a=await register('a'),b=await register('b');
 const center=createNotificationCenter({store});
 const notice={eventKey:'MT5:OFFLINE:manual-test',eventType:'MT5_DISCONNECTED',market:'BTCUSD',
  titleAr:'انقطاع MT5',titleEn:'MT5 disconnected',bodyAr:'حدث تجريبي مسجّل للاختبار.',
  bodyEn:'Recorded test event.'};
 assert.deepEqual(await center.emitForMember(a.id,notice),{created:true});
 assert.equal((await request('/api/auth/notifications')).status,401);
 assert.equal((await request('/api/auth/notifications',undefined,b.cookie)).data.items.length,0);
 const own=await request('/api/auth/notifications?market=BTCUSD&state=unread',undefined,a.cookie);
 assert.equal(own.status,200);assert.equal(own.data.items.length,1);
 const id=own.data.items[0].id;
 assert.equal((await request('/api/auth/notifications/update',{id,action:'read'},a.cookie)).status,403);
 assert.equal((await request('/api/auth/notifications/update',{id,action:'read'},a.cookie,a.csrf,'https://attacker.invalid')).status,403);
 assert.equal((await request('/api/auth/notifications/update',{id,action:'delete'},b.cookie,b.csrf)).status,404);
 assert.equal((await request('/api/auth/notifications',{eventKey:'bad',eventType:'TRADE_EXECUTED'},a.cookie,a.csrf)).status,404);
 const read=await request('/api/auth/notifications/update',{id,action:'read'},a.cookie,a.csrf);
 assert.equal(read.status,200);assert.equal(read.data.ok,true);
 assert.equal((await request('/api/auth/notifications?state=unread',undefined,a.cookie)).data.unreadCount,0);
 assert.equal((await request('/api/auth/notifications?type=NONEXISTENT',undefined,a.cookie)).status,400);
 assert.equal((await request('/api/auth/notifications/update',{id,action:'archive'},a.cookie,a.csrf)).status,200);
 assert.equal((await request('/api/auth/notifications?state=archived',undefined,a.cookie)).data.items.length,1);
 const dashboard=await fetch(base+'/dashboard');assert.equal(dashboard.status,200);
 const html=await dashboard.text();
 assert.match(html,/nabd-inbox-bell/);
 assert.equal((await fetch(base+'/notification-center-ui.js')).status,200);
 assert.equal((await fetch(base+'/notification-center.css')).status,200);
 // This monitor is a separate read-only worker (NEVER an order executor).
 const accountId=randomUUID(),workerId=randomUUID(),monitorToken=randomBytes(32).toString('base64url');
 await store.query('INSERT INTO nabd_member_mt5_accounts(id,user_id,broker,server_name,login,environment,created_at) VALUES(?,?,?,?,?,?,?)',
 [accountId,a.id,'JustMarkets','JustMarkets-Demo2','44556677','demo',100]);
 await store.query("INSERT INTO nabd_mt5_hosting_requests(account_id,status,requested_at) VALUES(?,'APPROVED',?)",[accountId,100]);
 await store.query('INSERT INTO nabd_mt5_monitor_workers(account_id,token_hash,worker_id,issued_at) VALUES(?,?,?,?)',
 [accountId,createHash('sha256').update(monitorToken).digest('hex'),workerId,100]);
 const packet={account_id:accountId,worker_id:workerId,broker:'JustMarkets',
   server:'JustMarkets-Demo2',login:'44556677',environment:'demo',
   terminal_connected:true,demo_mode:true};
 const heartbeat=async(token,data)=>{
   const res=await fetch(base+'/api/worker/mt5-heartbeat',{
     method:'POST',headers:{'Content-Type':'application/json','X-NABD-Worker-Token':token},
     body:JSON.stringify(data)});
   return {status:res.status,data:await res.json()};
 };
 assert.equal((await heartbeat('not-a-valid-worker-token',packet)).status,401);
 assert.equal((await heartbeat(monitorToken,{...packet,login:'88888888'})).status,409);
 assert.equal((await heartbeat(monitorToken,packet)).status,200);
 assert.equal((await heartbeat(monitorToken,packet)).status,200);
 const afterOnline=await request('/api/auth/notifications?type=MT5_STATUS',undefined,a.cookie);
 assert.equal(afterOnline.data.items.length,1);
 assert.equal((await request('/api/auth/notifications',undefined,b.cookie)).data.items.length,0);
 assert.equal((await heartbeat(monitorToken,{...packet,terminal_connected:false})).status,200);
 assert.equal((await heartbeat(monitorToken,{...packet,terminal_connected:false})).status,200);
 const disconnected=await request('/api/auth/notifications?type=MT5_DISCONNECTED',undefined,a.cookie);
 assert.equal(disconnected.data.items.length,1);
 assert.match(disconnected.data.items[0].bodyEn,/monitoring report/i);
 assert.equal((await heartbeat(monitorToken,packet)).status,200);
 assert.equal((await request('/api/auth/notifications?type=MT5_RECONNECTED',undefined,a.cookie)).data.items.length,1);
 assert.equal((await request('/api/auth/notifications',undefined,b.cookie)).data.items.length,0);

});
