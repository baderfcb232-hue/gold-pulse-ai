import test from 'node:test';
import assert from 'node:assert/strict';
import {SUBSCRIBER_DEMO_SCHEMA,subscriberDemoIntentJournal} from './subscriber-demo-intent-journal.mjs';

const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const input=()=>({accountId:id,signalId:'signal-1',ownerId:'owner_1',symbol:'XAUUSD',side:'BUY',
 createdAtMs:1794160000000,expiresAtMs:1794160015000,
 policy:{allowed:true,reason:'DEMO_POLICY_OK',dedupeKey:id+':signal-1'}});
const setup=()=>{
 const calls=[];const seen=new Set();
 const db={async query(sql,params=[]){
  calls.push({sql,params});
  if(sql.includes('INSERT INTO')){const key=params[0]+':'+params[1];
   if(seen.has(key))return {rows:[]}; seen.add(key);return {rows:[{account_id:params[0]}]};}
  if(sql.includes('UPDATE nabd_subscriber_demo_intents'))return {rows:[{account_id:params[0]}]};
  return {rows:[]};
 }};
 return {journal:subscriberDemoIntentJournal(db),calls};
};
test('schema atomically isolates accounts and signals without executable/filled states',()=>{
 assert.match(SUBSCRIBER_DEMO_SCHEMA,/PRIMARY KEY \(account_id, signal_id\)/);
 assert.match(SUBSCRIBER_DEMO_SCHEMA,/CHECK \(environment = 'demo'\)/);
 assert.doesNotMatch(SUBSCRIBER_DEMO_SCHEMA,/EXECUTED|FILLED|REAL|password|token/i);
 const {journal}=setup();assert.equal(journal.executionEnabled,false);
 assert.deepEqual(journal.permittedStatuses,['RESERVED','CANCELLED']);
});
test('duplicate idempotency key is refused; another account may reserve same signal',async()=>{
 const {journal,calls}=setup();await journal.initialize();
 assert.deepEqual(await journal.reserve(input()),{created:true,status:'RESERVED'});
 assert.deepEqual(await journal.reserve(input()),{created:false,status:'DUPLICATE'});
 const second=input();second.accountId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 second.policy={...second.policy,dedupeKey:second.accountId+':signal-1'};
 assert.deepEqual(await journal.reserve(second),{created:true,status:'RESERVED'});
 assert.match(calls[1].sql,/ON CONFLICT \(account_id,signal_id\) DO NOTHING/);
 assert.equal(calls[1].params[0],id);
});
test('rejects real-mode-style bypasses, invalid policy, unscoped or expired intents',async()=>{
 const {journal,calls}=setup();
 for(const [field,value] of [['ownerId',''],['accountId','bad'],['symbol','EURUSD'],
 ['side','CLOSE'],['expiresAtMs',1794160040000],['signalId','bad id']]){
  const bad={...input(),[field]:value};
  await assert.rejects(()=>journal.reserve(bad),/Invalid subscriber/);
 }
 const wrong=input();wrong.policy={allowed:true,reason:'DEMO_POLICY_OK',dedupeKey:'elsewhere'};
 await assert.rejects(()=>journal.reserve(wrong),/Invalid subscriber/);
 assert.equal(calls.length,0);
});
test('owner reads and cancellation always use owner filter; no dispatch/worker order call',async()=>{
 const {journal,calls}=setup();await journal.listByOwner('owner_1');
 assert.match(calls[0].sql,/WHERE owner_id=\$1/);
 await assert.rejects(()=>journal.listByOwner(''),/Invalid subscriber/);
 await journal.cancel({accountId:id,signalId:'signal-1',ownerId:'owner_1',nowMs:1794160010000});
 assert.match(calls[1].sql,/owner_id=\$3/);
 assert.doesNotMatch(calls.map(c=>c.sql).join(' '),/order_send|broker_ticket|DISPATCHED/i);
});
