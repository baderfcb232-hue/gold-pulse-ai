import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sqliteAuthStore} from './auth-store.mjs';
import {adminReportFilters,createAdminOperations} from './admin-operations.mjs';

test('phase14 overview uses grounded account counts and no fabricated broker/trading states',async t=>{
 const store=sqliteAuthStore();await store.initialize();t.after(()=>store.close());
 const owner=randomUUID(),user=randomUUID(),account=randomUUID();
 await store.query('INSERT INTO nabd_users(id,email,name,password_hash,created_at,verified_at) VALUES(?,?,?,?,?,?)',
  [owner,'owner@example.test','Owner','not-a-secret',1000,1000]);
 await store.query('INSERT INTO nabd_users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)',
  [user,'user@example.test','User','not-a-secret',1000]);
 await store.query('INSERT INTO nabd_member_mt5_accounts(id,user_id,broker,server_name,login,environment,created_at) VALUES(?,?,?,?,?,?,?)',
  [account,user,'JustMarkets','JustMarkets-Demo','987654','demo',1000]);
 await store.query("INSERT INTO nabd_mt5_hosting_requests(account_id,status,requested_at) VALUES(?,'REQUESTED',?)",[account,1010]);
 await store.query('INSERT INTO nabd_auth_audit(id,time,actor,event,subject) VALUES(?,?,?,?,?)',
  [randomUUID(),1020,owner,'USER_UPDATED',user]);
 const report=createAdminOperations({store,clock:()=>1100});
 const state=await report.overview();
 assert.equal(state.users.active,2);
 assert.equal(state.hosting.REQUESTED,1);
 assert.equal(state.monitor.registered,1);
 assert.equal(state.monitor.freshWorkers,0);
 assert.equal(state.monitor.reportedOnline,0);
 assert.equal(state.monitor.verifiedBrokerConnections,null);
 assert.equal(state.monitor.tradeExecutionEnabled,false);
 assert.equal(state.lastAudit.event,'USER_UPDATED');
 assert.equal((await report.audit(new URLSearchParams({event:'USER_UPDATED'}))).events.length,1);
 assert.equal((await report.audit(new URLSearchParams({event:'MFA_ENABLED'}))).events.length,0);
 assert.equal((await report.hosting(new URLSearchParams({status:'REQUESTED'}))).requests.length,1);
 assert.equal((await report.hosting(new URLSearchParams({status:'APPROVED'}))).requests.length,0);
});
test('phase14 reporting rejects malformed and unbounded filters',()=>{
 for(const query of [
  {event:'USER_UPDATED; DROP TABLE nabd_users'}, {status:'ROOT'}, {limit:1001},
  {offset:-3}, {from:'2026-13-40'}, {from:'2026-12-10',to:'2026-11-10'},
  {from:'2020-01-01',to:'2026-01-01'}
 ])assert.throws(()=>adminReportFilters(query));
 assert.equal(adminReportFilters({event:'USER_UPDATED',limit:100}).limit,100);
});
