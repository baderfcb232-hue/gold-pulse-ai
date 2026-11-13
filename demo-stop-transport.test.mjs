import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {sqliteAuthStore} from './auth-store.mjs';
import {createDemoStopTransport} from './demo-stop-transport.mjs';
import {createRiskStopIntents} from './risk-stop-intents.mjs';
const uid=()=>randomUUID();
test('separate Demo PAUSE transport rejects disabled mode, wrong identity and other tokens',async t=>{
 const store=sqliteAuthStore();await store.initialize();t.after(()=>store.close());
 const user=uid(),other=uid(),account=uid(),alien=uid();
 for(const id of [user,other])await store.query('INSERT INTO nabd_users(id,email,name,password_hash,verified_at,created_at) VALUES(?,?,?,?,?,?)',
   [id,id+'@test.invalid','Tester','fake',500,500]);
 for(const [id,owner,login] of [[account,user,'12345'],[alien,other,'98765']])
  await store.query("INSERT INTO nabd_member_mt5_accounts(id,user_id,broker,server_name,login,environment,created_at) VALUES(?,?,?,?,?,?,?)",
   [id,owner,'JustMarkets','JustMarkets-Demo',login,'demo',500]);
 await store.query("INSERT INTO nabd_mt5_hosting_requests(account_id,status,requested_at) VALUES(?,'APPROVED',?)",[account,500]);
 const token=randomBytes(32).toString('base64url'),otherToken=randomBytes(32).toString('base64url');
 const disabled=createDemoStopTransport({store,clock:()=>1000});
 await assert.rejects(()=>disabled.provision(store.query,account,token),e=>e.status===503);
 const bridge=createDemoStopTransport({store,clock:()=>1000,enabled:true});
 await store.transaction(q=>bridge.provision(q,account,token));
 const packet={accountId:account,broker:'JustMarkets',server:'JustMarkets-Demo',
   login:'12345',environment:'demo',demo_mode:true};
 await assert.rejects(()=>bridge.poll(otherToken,packet),e=>e.status===401);
 await assert.rejects(()=>bridge.poll(token,{...packet,accountId:alien}),e=>e.status===401);
 await assert.rejects(()=>bridge.poll(token,{...packet,login:'98765'}),e=>e.status===409);
 await assert.rejects(()=>bridge.poll(token,{...packet,environment:'real'}),e=>e.status===409);
 const noCommands=await bridge.poll(token,packet);assert.deepEqual(noCommands.commands,[]);
 const intent=await createRiskStopIntents({store,clock:()=>900}).request(user,{accountId:account,symbol:'BTCUSD'});
 const result=await bridge.poll(token,packet);
 assert.deepEqual(result.commands,[{requestId:intent.requestId,symbol:'BTCUSD',action:'PAUSE_NEW_ENTRIES_ONLY'}]);
 assert.equal(result.allowOrders,false);assert.equal(result.allowResume,false);
 await assert.rejects(()=>bridge.acknowledge(token,{...packet,requestId:uid(),symbol:'BTCUSD',persistedPaused:true}),e=>e.status===409);
 await assert.rejects(()=>bridge.acknowledge(token,{...packet,requestId:intent.requestId,symbol:'XAUUSD',persistedPaused:true}),e=>e.status===409);
 await assert.rejects(()=>bridge.acknowledge(token,{...packet,requestId:intent.requestId,symbol:'BTCUSD',persistedPaused:false}),e=>e.status===400);
 const ack=await bridge.acknowledge(token,{...packet,requestId:intent.requestId,symbol:'BTCUSD',persistedPaused:true});
 assert.equal(ack.reported,true);assert.equal(ack.brokerConfirmed,false);
 assert.equal(ack.stopConfirmed,false);assert.equal(ack.resumeAllowed,false);
 await bridge.acknowledge(token,{...packet,requestId:intent.requestId,symbol:'BTCUSD',persistedPaused:true});
 assert.equal((await store.query('SELECT count(*) AS n FROM nabd_mt5_stop_reports')).rows[0].n,1);
 const memberView=(await createRiskStopIntents({store,clock:()=>1001}).list(user))[0];
 assert.equal(memberView.status,'EA_PAUSE_REPORTED_UNVERIFIED');
 assert.equal(memberView.confirmedByMT5,false);
 assert.equal(memberView.brokerConfirmed,false);
 assert.equal(memberView.executionStopped,false);
 await store.transaction(q=>bridge.revoke(q,account));
 await assert.rejects(()=>bridge.poll(token,packet),e=>e.status===401);
});
