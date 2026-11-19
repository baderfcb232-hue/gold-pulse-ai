import test from 'node:test';
import assert from 'node:assert/strict';
import {SUBSCRIBER_DEMO_GRANT_SCHEMA,subscriberDemoGrantStore} from './subscriber-demo-grant-store.mjs';
const accountId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const now=1794160000000;
const issue=()=>({accountId,ownerId:'memberA',issuedAtMs:now,expiresAtMs:now+60000,consentVersion:'v1',verifiedByServer:true});
const setup=()=>{
 const queries=[];let active=false;let revoked=false;
 const pool={async query(sql,values=[]){queries.push({sql,values});
  if(sql.includes('INSERT INTO nabd_subscriber_demo_grants')) {
   if(active||revoked)return {rows:[]};active=true;return {rows:[{account_id:accountId}]};
  }
  if(sql.includes('UPDATE nabd_subscriber_demo_grants')) {
   if(!active||revoked)return {rows:[]};revoked=true;return {rows:[{account_id:accountId}]};
  }
  if(sql.includes('SELECT g.account_id'))return {rows: active&&!revoked ? [{account_id:accountId,owner_id:'memberA',scope:'demo-execute',expires_at_ms:String(now+60000)}] : []};
  return {rows:[]};
 }};
 return {store:subscriberDemoGrantStore(pool),queries};
};
test('schema is owner scoped, Demo-only grant and revocable with no broker secrets',()=>{
 assert.match(SUBSCRIBER_DEMO_GRANT_SCHEMA,/PRIMARY KEY REFERENCES nabd_member_mt5_accounts/);
 assert.match(SUBSCRIBER_DEMO_GRANT_SCHEMA,/REVOKED/);
 assert.doesNotMatch(SUBSCRIBER_DEMO_GRANT_SCHEMA,/password|token|order_send|real-execute/i);
 assert.equal(setup().store.executionEnabled,false);
});
test('no anonymous, implicit, stale or overlong consent',async()=>{
 const {store,queries}=setup();
 for(const [field,value] of [
  ['verifiedByServer',false],['accountId','other'],['ownerId',''],
  ['expiresAtMs',now],['expiresAtMs',now+86400001],['consentVersion','old']
 ])await assert.rejects(()=>store.issue({...issue(),[field]:value}),/Invalid subscriber/);
 assert.equal(queries.length,0);
});
test('consent only issues for confirmed owned, approved Demo and never reactivates revoked records',async()=>{
 const {store,queries}=setup();await store.initialize();
 assert.deepEqual(await store.issue(issue()),{created:true});
 assert.deepEqual(await store.issue(issue()),{created:false});
 assert.match(queries[1].sql,/a.user_id=\$2/);
 assert.match(queries[1].sql,/u.status='active'/);
 assert.match(queries[1].sql,/h.status='APPROVED'/);
 assert.match(queries[1].sql,/ON CONFLICT \(account_id\) DO NOTHING/);
 assert.deepEqual(await store.revoke({accountId,ownerId:'memberA',nowMs:now+1000}),{revoked:true});
 assert.deepEqual(await store.issue(issue()),{created:false});
 assert.deepEqual(await store.revoke({accountId,ownerId:'memberA',nowMs:now+2000}),{revoked:false});
});
test('revalidation queries use account+owner and expiry, never return secret',async()=>{
 const {store,queries}=setup();await store.issue(issue());
 assert.deepEqual(await store.getActive({accountId,ownerId:'memberA',nowMs:now+1000}),{
  accountId,ownerId:'memberA',scope:'demo-execute',expiresAtMs:now+60000,authorized:true,revoked:false
 });
 assert.match(queries.at(-1).sql,/g.expires_at_ms>\$3/);
 assert.match(queries.at(-1).sql,/g.owner_id=\$2/);
 await store.revoke({accountId,ownerId:'memberA',nowMs:now+2000});
 assert.equal(await store.getActive({accountId,ownerId:'memberA',nowMs:now+3000}),null);
});
