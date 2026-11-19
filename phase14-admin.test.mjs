import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {sqliteAuthStore} from './auth-store.mjs';
import {createPhase14Admin,validatePlanDraft} from './admin-dashboard-phase14.mjs';
import {exportAuthBackup,readAuthBackup} from './auth-backup.mjs';

async function setup(t){
 const store=sqliteAuthStore();await store.initialize();t.after(()=>store.close());
 const admin=randomUUID(),other=randomUUID();
 for(const [i,user] of [admin,other].entries())
  await store.query('INSERT INTO nabd_users(id,email,name,password_hash,status,verified_at,created_at) VALUES(?,?,?,?,?,?,?)',
    [user,i+'@example.test','Member','not-a-credential',i===0?'active':'disabled',100,100]);
 const center=createPhase14Admin({store,clock:()=>1000,
  operationalStatus:()=>({mt5:'STALE',telegram:'NO_DATA',publication:'WAITING'})});
 return {store,admin,other,center};
}
const draft=()=>({action:'create',code:'GOLD_TEST',nameAr:'باقة الذهب',
 nameEn:'Gold Plan',currency:'USD',priceMinor:2500,durationDays:30,
 features:['GOLD_SIGNALS']});
test('Phase14 operations aggregates never expose credentials or imply trading',async t=>{
 const {store,admin,other,center}=await setup(t);
 const account=randomUUID();
 await store.query('INSERT INTO nabd_member_mt5_accounts(id,user_id,broker,server_name,login,environment,created_at) VALUES(?,?,?,?,?,?,?)',
  [account,other,'JustMarkets','JustMarkets-Demo2','543210','demo',100]);
 await store.query("INSERT INTO nabd_mt5_hosting_requests(account_id,status,requested_at) VALUES(?,'REQUESTED',?)",[account,100]);
 const snapshot=await center.dashboard();
 assert.equal(snapshot.users.total,2);assert.equal(snapshot.users.active,1);
 assert.equal(snapshot.users.disabled,1);assert.equal(snapshot.hosting.requested,1);
 assert.equal(snapshot.mt5Monitor.provisioned,0);
 assert.equal(snapshot.mt5Monitor.brokerConnectionVerified,false);
 assert.equal(snapshot.services.database,'CONNECTED');
 assert.equal(snapshot.services.render,'NOT_CHECKED');
 assert.equal(snapshot.marketReports.XAUUSD.state,'NO_REPORT');
 assert.equal(snapshot.marketReports.BTCUSD.analysisVerified,false);
 assert.equal(snapshot.marketReports.BTCUSD.tradeExecutionVerified,false);
 assert.equal(snapshot.subscriptions.billingEnabled,false);
 assert.equal(snapshot.subscriptions.subscriberEntitlementsEnabled,false);
 assert.equal(snapshot.restrictions.liveTradingEnabledByAdmin,false);
 const serialized=JSON.stringify(snapshot);
 assert.doesNotMatch(serialized,/543210|password_hash|totp_secret|token_hash|example\.test/);
});
test('MFA caller can stage/edit/archive metadata without generating subscriptions or trades',async t=>{
 const {store,admin,center}=await setup(t);
 for(const mutate of [p=>p.priceMinor=-1,p=>p.durationDays=0,p=>p.code='not valid',
   p=>p.features=['AUTO_TRADE'],p=>p.features=['GOLD_SIGNALS','GOLD_SIGNALS'],
   p=>p.billingEnabled=true,p=>p.priceMinor=Infinity]){
   const p=draft();mutate(p);
   assert.throws(()=>validatePlanDraft(Object.fromEntries(Object.entries(p).filter(([k])=>k!=='action'))));
 }
 assert.deepEqual(await center.listPlans(),{plans:[],billingEnabled:false,subscriptionsEnabled:false});
 const created=await center.mutatePlan(admin,draft());
 assert.equal(created.ok,true);assert.equal(created.billingEnabled,false);
 assert.equal(created.liveTradingEnabled,false);assert.equal(created.state,'DRAFT');
 assert.equal((await center.listPlans()).plans.length,1);
 await assert.rejects(()=>center.mutatePlan(admin,draft()),e=>e.status===409);
 const update={...draft(),action:'update',id:created.id,priceMinor:3000,features:['BTC_SIGNALS','GOLD_SIGNALS']};
 assert.equal((await center.mutatePlan(admin,update)).state,'DRAFT');
 const item=(await center.listPlans()).plans[0];
 assert.equal(item.priceMinor,3000);
 assert.deepEqual(item.features,['BTC_SIGNALS','GOLD_SIGNALS']);
 assert.equal(item.billingEnabled,false);assert.equal(item.subscriptionsEnabled,false);
 const archived=await center.mutatePlan(admin,{action:'archive',id:created.id});
 assert.equal(archived.state,'ARCHIVED');
 await assert.rejects(()=>center.mutatePlan(admin,update),e=>e.status===409);
 await assert.rejects(()=>center.mutatePlan(admin,{action:'archive',id:created.id}),e=>e.status===409);
 assert.equal((await store.query("SELECT COUNT(*) AS n FROM nabd_auth_audit WHERE actor=? AND event LIKE 'ADMIN_PLAN_DRAFT_%'",[admin])).rows[0].n,3);
 const secret=JSON.stringify(await center.listPlans());
 assert.doesNotMatch(secret,/password|token|entitled:true|active_subscription/i);
});
test('encrypted backup retains draft catalog but never persists authentication sessions',async t=>{
 const {store,admin,center}=await setup(t);
 await center.mutatePlan(admin,draft());
 const key=randomBytes(32),cipher=await exportAuthBackup(store,key,()=>1000);
 const decoded=readAuthBackup(cipher,key);
 assert.equal(decoded.version,5);
 assert.equal(decoded.tables.nabd_admin_plan_drafts.length,1);
 assert.equal(decoded.tables.nabd_admin_plan_drafts[0].state,'DRAFT');
 assert.equal('nabd_sessions' in decoded.tables,false);
 assert.equal('nabd_tokens' in decoded.tables,false);
});
