import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../server.mjs';
import {sqliteAuthStore} from '../auth-store.mjs';
import {SUPPORTED_BROKERS,validateDemoRegistration,deriveOnboardingStatus,
 statusLabel,MONITORING_STATUSES} from '../public/onboarding-flow.js';

const verifiedUser={id:'test-member',role:'member',verified:true};
const account={
 id:'f4a210bc-7dee-441b-8c9a-8ac5e4957bbb',broker:'JustMarkets',server_name:'JustMarkets-Demo2',
 login:'12345678',environment:'demo',status:'PENDING_SETUP',
 hosting_status:'NOT_REQUESTED',monitoring_status:'NOT_APPROVED'
};
const state=(hosting,monitor='NOT_ISSUED')=>({
 accounts:[{...account,hosting_status:hosting,monitoring_status:monitor}],
 connectionEnabled:false,tradingEnabled:false
});

test('phase 11 supports only JustMarkets Demo metadata, no credential secrets',()=>{
 assert.deepEqual(SUPPORTED_BROKERS,[{id:'JustMarkets',label:'JustMarkets',environment:'demo',available:true}]);
 const clean=validateDemoRegistration({broker:'JustMarkets',server:'JustMarkets-Demo2',
  login:'12345678',environment:'demo',acknowledge:true,
  password:'user-mt5-secret',investorPassword:'another-secret',workerToken:'dummy'});
 assert.deepEqual(clean,{broker:'JustMarkets',server:'JustMarkets-Demo2',login:'12345678',
  environment:'demo',acknowledge:true});
 assert.equal(JSON.stringify(clean).includes('secret'),false);
 for(const change of [
  {broker:'OtherBroker'},{environment:'live'},{server:'JustMarkets-Live'},
  {login:'00000000'},{login:12345678},{acknowledge:false}
 ])assert.throws(()=>validateDemoRegistration({...clean,...change}),RangeError);
});

test('onboarding progress always distinguishes request, approval, monitoring and trading',()=>{
 const anon=deriveOnboardingStatus(null,state('APPROVED','OBSERVED_DEMO'));
 assert.equal(anon.phase,'SIGN_IN');
 assert.equal(anon.account,null);
 assert.equal(anon.tradingEnabled,false);
 assert.equal(deriveOnboardingStatus(verifiedUser,{accounts:[]}).phase,'REGISTER_DEMO');
 const fresh=deriveOnboardingStatus(verifiedUser,state('NOT_REQUESTED'));
 assert.equal(fresh.phase,'REQUEST_HOSTING');
 assert.equal(fresh.mayRequestHosting,true);
 assert.equal(fresh.canObserveDemo,false);
 assert.equal(deriveOnboardingStatus(verifiedUser,state('REJECTED')).mayRequestHosting,true);
 const pending=deriveOnboardingStatus(verifiedUser,state('REQUESTED'));
 assert.equal(pending.phase,'ADMIN_REVIEW');
 assert.equal(pending.mayRequestHosting,false);
 for(const [monitor,phase] of [
  ['NOT_ISSUED','WORKER_SETUP'],['AWAITING_WORKER','AWAITING_HEARTBEAT'],
  ['STALE','STALE'],['MT5_OFFLINE','MT5_OFFLINE'],['OBSERVED_DEMO','MONITORING_ONLY']
 ]) {
  const approved=deriveOnboardingStatus(verifiedUser,state('APPROVED',monitor));
  assert.equal(approved.phase,phase);
  assert.equal(approved.steps.approved,true);
  assert.equal(approved.canObserveDemo,monitor==='OBSERVED_DEMO');
  assert.equal(approved.tradingEnabled,false);
  assert.equal(approved.connectionVerifiedForTrading,false);
  assert.equal(approved.requiresOwnVps,false);
  assert.equal(approved.steps.monitoring,monitor==='OBSERVED_DEMO');
 }
 assert.ok(MONITORING_STATUSES.includes('OBSERVED_DEMO'));
 assert.match(statusLabel('MONITORING_ONLY','ar'),/المراقبة فقط/);
 assert.match(statusLabel('MONITORING_ONLY','en'),/trading disabled/);
});

test('phase 11 page, assets and links have separate routes and no password form',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'nabd-onboarding-'));
 const app=createApplication({dataDir:dir,accountOptions:{env:{}}});
 await app.accounts.ready;
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const root='http://127.0.0.1:'+app.server.address().port;
 for(const [path,mime] of [
  ['/onboarding','text/html'],['/onboarding.js','javascript'],
  ['/onboarding-flow.js','javascript'],['/onboarding.css','text/css']
 ]){
  const r=await fetch(root+path);assert.equal(r.status,200,path);
  assert.match(r.headers.get('content-type'),new RegExp(mime),path);
 }
 const html=await(await fetch(root+'/onboarding')).text();
 assert.match(html,/id="onboarding-steps"/);
 assert.match(html,/name="server"/);
 assert.match(html,/name="login"/);
 assert.doesNotMatch(html,/name="password"|name="investorPassword"|name="workerToken"/);
 for(const page of ['/account','/dashboard']){
  const response=await fetch(root+page);
  assert.equal(response.status,200);
  assert.match(await response.text(),/href="\/onboarding"/);
 }
 const unauthorized=await fetch(root+'/api/auth/mt5-accounts');
 assert.equal(unauthorized.status,401);
});

test('existing user-owned registration/hosting endpoints remain CSRF-scoped and read-only',async t=>{
 const dataDir=mkdtempSync(join(tmpdir(),'nabd-onboard-auth-'));
 const mail=[],backup={key:randomBytes(32),storage:async()=>{}};
 const app=createApplication({dataDir,publicBase:'https://nabd.example',
  accountOptions:{store:sqliteAuthStore(),env:{},encryptionKey:randomBytes(32),
   mailer:async x=>mail.push(x),backup}});
 await app.accounts.ready;
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 t.after(async()=>{await app.close();rmSync(dataDir,{recursive:true,force:true});});
 const root='http://127.0.0.1:'+app.server.address().port;
 const req=async(path,body,cookie='',csrf='')=>{
  const res=await fetch(root+path,{method:body?'POST':'GET',
   headers:{Origin:'https://nabd.example',...(body?{'Content-Type':'application/json'}:{}),
    ...(cookie?{Cookie:cookie,'X-NABD-CSRF':csrf}:{})},
   ...(body?{body:JSON.stringify(body)}:{})});
  return {status:res.status,data:await res.json(),cookie:res.headers.getSetCookie()
   .filter(s=>!s.includes('Max-Age=0')).map(s=>s.split(';')[0]).join('; ')};
 };
 const email='onboard-member@example.test',pass='Long secure test password 2026!';
 assert.equal((await req('/api/auth/register',{email,name:'Demo Member',password:pass,acceptPrivacy:true})).status,202);
 const verify=mail.find(x=>x.kind==='verify'&&x.email===email);
 assert.ok(verify);
 assert.equal((await req('/api/auth/verify',{token:verify.token,password:pass})).status,200);
 const login=await req('/api/auth/login',{email,password:pass});assert.equal(login.status,200);
 const session=login.cookie,csrf=login.data.csrf;
 assert.ok(session);assert.ok(csrf);
 const fields=validateDemoRegistration({
  broker:'JustMarkets',server:'JustMarkets-Demo2',login:'34567890',environment:'demo',acknowledge:true
 });
 assert.equal((await req('/api/auth/mt5-accounts',fields,session,'invalid')).status,403);
 const saved=await req('/api/auth/mt5-accounts',fields,session,csrf);
 assert.equal(saved.status,201);
 const memberRows=await req('/api/auth/mt5-accounts',null,session);
 assert.equal(memberRows.data.accounts.length,1);
 assert.equal(memberRows.data.accounts[0].hosting_status,'NOT_REQUESTED');
 assert.equal(memberRows.data.tradingEnabled,false);
 assert.equal(memberRows.data.connectionEnabled,false);
 const hosted=await req('/api/auth/mt5-hosting/request',{id:saved.data.id,consent:true},session,csrf);
 assert.equal(hosted.status,202);
 const waiting=await req('/api/auth/mt5-accounts',null,session);
 assert.equal(deriveOnboardingStatus(verifiedUser,waiting.data).phase,'ADMIN_REVIEW');
 assert.equal(waiting.data.tradingEnabled,false);
 assert.equal(waiting.data.connectionEnabled,false);
});

test('onboarding UI does not request credentials or call trading endpoints',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 const js=read('public/onboarding.js'),html=read('public/onboarding.html'),server=read('server.mjs');
 assert.match(js,/validateDemoRegistration/);
 assert.match(js,/\/api\/auth\/me/);
 assert.match(js,/\/api\/auth\/mt5-accounts/);
 assert.match(js,/\/api\/auth\/mt5-hosting\/request/);
 assert.match(js,/X-NABD-CSRF/);
 assert.match(js,/credentials/); // via requestJson shared same-origin
 assert.match(html,/data-t="realDisabled"/);
 assert.match(html,/data-t="others"/);
 assert.match(server,/'\/onboarding':'onboarding\.html'/);
 for(const file of ['public/onboarding.js','public/onboarding-flow.js','public/onboarding.html']){
  const s=read(file);
  assert.doesNotMatch(s,/\/api\/commands|OrderSend|\/api\/bridge\/next|\/api\/risk-settings|localStorage\.setItem\([^)]*password/);
 }
});
