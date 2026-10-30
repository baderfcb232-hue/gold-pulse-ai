import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createApplication} from './server.mjs';
import {entryFixture,eaFixture,NOW} from './tests/fixtures.mjs';
import {cleanSnapshot} from './engine.mjs';
import {brokerGoldMarket} from './broker-market.mjs';
import {websiteTradeDecision,websiteEntryJournal,entrySourceKey} from './website-entry.mjs';
const INGEST='website-test-ingest-xxxxxxxxxxxxxxxxxxxxxx',ADMIN='website-test-admin-yyyyyyyyyyyyyyyyyyyyyy';
function rawSnapshot() {
  const raw=entryFixture();raw.symbol='XAUUSD.m';raw.ea=eaFixture().ea;raw.ea.signal=null;
  raw.execution={...raw.execution,main_connected:true,demo_recommendations:true,website_recommendations:true,website_since:NOW-10};
  raw.account={currency:'USD',balance:10000,equity:10000,free_margin:10000,floating:0};raw.positions=[];raw.deals=[];
  return raw;
}
function decisionFixture(){
  const snapshot=cleanSnapshot(rawSnapshot(),NOW),market=brokerGoldMarket(snapshot,NOW);
  const p={...market.analysis.plan,id:'website-plan',status:'TRACKING'};
  return {enabled:true,snapshot,now:NOW,durable:true,costs:{ready:true},analysisPlan:market.analysis.plan,
    market:{...market,currentSignal:p}};
}
function sqliteJournal(file=':memory:'){
  const db=new DatabaseSync(file);
  db.exec(`CREATE TABLE IF NOT EXISTS nabd_website_entries(id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_key TEXT,plan_id TEXT,time REAL,expires REAL,status TEXT,plan TEXT,reported_at REAL,
    reason_code INTEGER,mt5_retcode INTEGER,UNIQUE(source_key,plan_id));
    CREATE TABLE IF NOT EXISTS nabd_website_decisions(
      source_key TEXT,plan_id TEXT,time REAL,reason TEXT,status TEXT,updated_at REAL,
      PRIMARY KEY(source_key,plan_id))`);
  const pool={async query(sql,params=[]){
    const values=[];const adapted=sql.replace(/\$(\d+)/g,(_,index)=>{values.push(params[Number(index)-1]);return '?';});
    return {rows:db.prepare(adapted).all(...values)};
  }};
  return {...websiteEntryJournal(pool),list:async()=>[],close:async()=>{},finish:()=>db.close()};
}
async function setup(t,{journal=sqliteJournal(),raw=rawSnapshot()}={}){
  let now=NOW;const dir=mkdtempSync(join(tmpdir(),'nabd-website-'));
  const app=createApplication({dataDir:dir,ingestToken:INGEST,dashboardToken:ADMIN,commandJournal:journal,clock:()=>now,
    config:{signalSource:'EA',publicationEnabled:true,demoRecommendationExecution:true,brokerCostProfiles:[{
      accountRef:raw.account_ref,broker:raw.broker,symbol:raw.symbol,magic:raw.execution.managed_magic,
      verifiedAt:NOW,evidence:'SYNTHETIC TEST',costs:{spreadBps:.2,slippageBps:.01,commissionBps:.01,carryBpsPerDay:.01,acknowledged:true}}]}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await app.close();journal.finish?.();rmSync(dir,{recursive:true,force:true});});app.ingest(raw);
  const base='http://127.0.0.1:'+app.server.address().port;
  const source={account_ref:raw.account_ref,broker:raw.broker,symbol:raw.symbol,magic:raw.execution.managed_magic};
  const post=(path='/api/bridge/website-recommendation',data=source,token=INGEST)=>fetch(base+path,
    {method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(data)});
  return {app,raw,base,source,post,journal,setNow:n=>now=n};
}

test('website approval needs no second EA strategy and preserves original stop and first target',()=>{
  const f=decisionFixture(),out=websiteTradeDecision(f);
  assert.equal(f.snapshot.ea.signal,null);assert.equal(out.ready,true);
  assert.equal(out.plan.entry,f.market.currentSignal.entry);assert.equal(out.plan.sl,f.market.currentSignal.sl);
  assert.equal(out.plan.tp,f.market.currentSignal.tp1);assert.equal(out.plan.expires_at,NOW+15);
});
test('website execution rejects unsafe account, stale source, old plans, foreign feed and invalid levels',()=>{
  for(const [reason,change] of [
    ['DISABLED',f=>f.enabled=false],['MT5_WEBSITE_UPDATE_REQUIRED',f=>f.snapshot.execution.website_recommendations=false],
    ['DURABLE_ENTRY_JOURNAL_REQUIRED',f=>f.durable=false],['NOT_JUSTMARKETS_DEMO',f=>f.snapshot.execution.demo=false],
    ['NOT_JUSTMARKETS_DEMO',f=>f.snapshot.broker='Other-Demo'],['NOT_JUSTMARKETS_DEMO',f=>f.snapshot.symbol='ETHUSD'],
    ['MT5_EXECUTION_NOT_READY',f=>f.snapshot.execution.paused=true],['MT5_EXECUTION_NOT_READY',f=>f.snapshot.ea.emergency_stop=true],
    ['STALE_MT5',f=>f.snapshot.received_at=NOW-11],['STALE_MT5',f=>f.snapshot.ea.heartbeat_at=NOW+6],
    ['WAITING_WEBSITE_PLAN',f=>f.market.currentSignal=null],
    ['WEBSITE_SOURCE_MISMATCH',f=>f.market.currentSignal.source_id='REFERENCE'],
    ['WEBSITE_SOURCE_MISMATCH',f=>f.market.currentSignal.broker_symbol='XAUUSD.other'],
    ['WEBSITE_PLAN_CHANGED',f=>f.analysisPlan.bar_time-=300],
    ['WAITING_NEW_WEBSITE_PLAN',f=>f.snapshot.execution.website_since=NOW+1],
    ['INVALID_PLAN',f=>{f.snapshot.execution.website_since=NOW-100;f.market.currentSignal.issued_at=NOW-80;}],['INVALID_PLAN',f=>f.market.currentSignal.sl=f.market.currentSignal.entry],
    ['INVALID_PLAN',f=>f.market.currentSignal.expires_at=NOW],['INVALID_PLAN',f=>f.market.currentSignal.tp1=NaN],
    ['WAITING_COSTS',f=>f.costs.ready=false],['PRICE_OR_SPREAD_MOVED',f=>f.snapshot.ask+=10],
    ['BELOW_MINIMUM_VOLUME',f=>f.snapshot.account.equity=1],['INSUFFICIENT_MARGIN',f=>f.snapshot.account.free_margin=0]
  ]){const f=decisionFixture();change(f);assert.equal(websiteTradeDecision(f).reason,reason,reason);}
});
test('a fresh distinct website recommendation remains eligible with an earlier position',()=>{
  const f=decisionFixture();
  f.snapshot.positions=[{ticket:'444',side:'BUY',volume:0.01,entry:f.market.currentSignal.entry-1,
    sl:f.market.currentSignal.sl,tp:f.market.currentSignal.tp1}];
  assert.equal(websiteTradeDecision(f).reason,'WEBSITE_READY');
});
test('authenticated website bridge dispatches a plan once under simultaneous polling and exposes only an unconfirmed submission',async t=>{
  const {app,base,post,source}=await setup(t);
  assert.equal(app.publicState().websiteBridge.connection,'NOT_OBSERVED');
  assert.equal(app.publicState().websiteExecution.ready,true);
  assert.equal(app.publicState().signalSource,'NABD_WEBSITE');
  assert.equal((await post(undefined,source,'wrong')).status,401);
  assert.equal((await post(undefined,{...source,symbol:'OTHER'})).status,409);
  assert.equal(app.publicState().websiteBridge.lastPollAt,null);
  const responses=await Promise.all(Array.from({length:6},async()=> (await post()).text()));
  assert.equal(responses.filter(Boolean).length,1);
  assert.equal(app.publicState().websiteBridge.connection,'LIVE');
  assert.equal(app.publicState().websiteBridge.lastResult,'DISPATCHED');
  const wire=responses.find(Boolean).split('|');assert.equal(wire.length,12);assert.equal(wire[0],'NBWEB1');
  const frozen=app.marketFeed.history('XAUUSD')[0];
  assert.equal(app.publicState().currentSignal.id,frozen.id);
  assert.deepEqual(wire.slice(4,8),[frozen.side,String(frozen.entry),String(frozen.sl),String(frozen.tp1)]);
  assert.equal(await (await post()).text(),'','a lost response never causes a repeated dispatch');
  assert.equal(await (await post('/api/bridge/demo-recommendation')).text(),'','old entry channel is fenced');
  let account=await (await fetch(base+'/api/account',{headers:{Authorization:'Bearer '+ADMIN}})).json();
  assert.equal(account.websiteEntries[0].status,'DISPATCHED');
  const id=Number(wire[11]);assert.ok(Number.isSafeInteger(id));
  assert.equal((await post('/api/bridge/website-result',{...source,id,status:'CONFIRMED'})).status,400);
  assert.equal((await post('/api/bridge/website-result',{...source,id,status:'SUBMITTED'})).status,200);
  account=await (await fetch(base+'/api/account',{headers:{Authorization:'Bearer '+ADMIN}})).json();
  assert.equal(account.websiteEntries[0].status,'SUBMITTED');
  assert.equal(account.websiteEntries[0].mt5_retcode,null,'legacy bridge has no broker retcode');
  assert.equal(app.publicState().websiteBridge.lastResult,'SUBMITTED');
  assert.equal(app.publicState().websiteBridge.lastReportAt,NOW);
  const market=await (await fetch(base+'/api/market',{headers:{Authorization:'Bearer '+ADMIN}})).json();
  assert.equal(market.markets.XAUUSD.currentSignal.id,frozen.id);assert.equal(market.markets.XAUUSD.execution_mode,'DEMO_WEBSITE');
  assert.equal((await fetch(base+'/api/account')).status,401);
  const publicText=await (await fetch(base+'/api/state')).text();assert.ok(!publicText.includes('websiteEntries'));
  assert.ok(!publicText.includes(source.account_ref));assert.equal(app.db.prepare('SELECT count(*) n FROM commands').get().n,0);
});
test('broker market exposes a current plan only within its execution eligibility window',async t=>{
  const {app,setNow}=await setup(t);
  const nowMarket=app.marketFeed.publicState().markets.XAUUSD;
  assert.ok(nowMarket.currentSignal);
  setNow(NOW+76);
  const expiredForEntry=app.marketFeed.publicState().markets.XAUUSD;
  assert.equal(expiredForEntry.currentSignal,null);
  assert.equal(expiredForEntry.analysis.status,'STALE'); // snapshot was intentionally not refreshed
  assert.equal(expiredForEntry.analysis.plan,undefined);
});
test('bridge diagnostics restore the durable result and expire polling freshness without claiming a fill',async t=>{
  const journal=sqliteJournal(), raw=rawSnapshot();
  const snapshot=cleanSnapshot(raw,NOW),source=entrySourceKey(snapshot);
  const record=await journal.claimWebsite(source,{...decisionFixture().market.currentSignal,expires_at:NOW-50},NOW-100);
  await journal.websiteResult(source,Number(record.id),'REJECTED',NOW-99);
  raw.execution.paused=true;
  const {app,post,setNow}=await setup(t,{journal,raw});
  await post();
  const restored=app.publicState().websiteBridge;
  assert.equal(restored.journalState,'READY');assert.equal(restored.connection,'LIVE');
  assert.equal(restored.lastResult,'REJECTED');assert.equal(restored.lastReportAt,NOW-99);
  setNow(NOW+16);assert.equal(app.publicState().websiteBridge.connection,'STALE');
});
test('website publication health follows the active website plan instead of the absent legacy EA plan',async t=>{
  const {app,base}=await setup(t);
  assert.equal(app.publicState().currentSignal.source,'MT5 · JustMarkets-Demo');
  const health=await (await fetch(base+'/healthz')).json();
  assert.equal(health.publication.telegram.source,'NABD_WEBSITE');
  assert.equal(health.publication.telegram.reason,'READY');
  assert.notEqual(health.publication.detail,'ننتظر خطة جديدة مكتملة من مصدر التداول.');
});
test('durable plan claims survive journal reopening and a result from a different account cannot modify them',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'nabd-entry-journal-')),file=join(dir,'journal.sqlite');
  t.after(()=>rmSync(dir,{recursive:true,force:true}));let j=sqliteJournal(file);
  const p=decisionFixture().market.currentSignal;
  const r=await j.claimWebsite('source-a',p,NOW);assert.ok(r);
  j.finish();j=sqliteJournal(file);
  assert.equal(await j.claimWebsite('source-a',p,NOW+1),null);
  await j.websiteResult('source-b',Number(r.id),'SUBMITTED',NOW+1);
  assert.equal((await j.websiteEntries('source-a'))[0].status,'DISPATCHED');
  await j.websiteResult('source-a',Number(r.id),'REJECTED',NOW+2);
  await j.websiteResult('source-a',Number(r.id),'SUBMITTED',NOW+3);
  assert.equal((await j.websiteEntries('source-a'))[0].status,'REJECTED');j.finish();
});
test('website opt-in never replays a pre-installation opportunity and pauses/news still block dispatch',async t=>{
  const {app,raw,post,setNow}=await setup(t);
  setNow(NOW+1);raw.quote_at=NOW+1;raw.ea.heartbeat_at=NOW+1;raw.execution.website_since=NOW+1;app.ingest(raw);
  assert.equal(app.publicState().websiteExecution.reason,'WAITING_NEW_WEBSITE_PLAN');assert.equal(await (await post()).text(),'');
  raw.execution.website_since=NOW-10;raw.execution.paused=true;app.ingest(raw);
  assert.equal(app.publicState().websiteExecution.reason,'MT5_EXECUTION_NOT_READY');
  raw.execution.paused=false;raw.calendar.events=[{id:'test',name:'Synthetic high impact',currency:'USD',importance:3,time:NOW}];app.ingest(raw);
  assert.equal(await (await post()).text(),'');
});

test('the actual MQL website guard passes both directions and rejects stale, moved, wrong-candle and stop-boundary cases',()=>{
  const dir=mkdtempSync(join(tmpdir(),'nabd-mql-guard-'));
  try{
    const text=readFileSync(new URL('./mt5/NABD_Link.mqh',import.meta.url),'utf8');
    const guard=text.split('// BEGIN WEBSITE_PLAN_GUARD')[1].split('// END WEBSITE_PLAN_GUARD')[0];
    writeFileSync(join(dir,'guard.cpp'),`#include <cmath>\n#include <cassert>\nbool MathIsValidNumber(double v){return std::isfinite(v);}\ndouble MathAbs(double v){return std::abs(v);}\n${guard}\nint main(){
      assert(NABDWebsitePlanValid(100,80,90,110,60,60,1,100,98,103,99.99,100.01,.01,80,.02));
      assert(NABDWebsitePlanValid(100,80,90,110,60,60,-1,100,102,97,99.99,100.01,.01,80,.02));
      assert(!NABDWebsitePlanValid(100,95,90,110,60,60,1,100,98,103,99.99,100.01,.01,80,.02));
      assert(!NABDWebsitePlanValid(100,80,90,100,60,60,1,100,98,103,99.99,100.01,.01,80,.02));
      assert(!NABDWebsitePlanValid(100,80,90,110,60,61,1,100,98,103,99.99,100.01,.01,80,.02));
      assert(!NABDWebsitePlanValid(100,80,90,110,60,60,1,100,98,103,100.9,101,.01,80,.02));
      assert(!NABDWebsitePlanValid(100,80,90,110,60,60,-1,100,102,97,99.99,100.01,.01,80,3));
      assert(!NABDWebsitePlanValid(100,80,90,110,60,60,1,NAN,98,103,99.99,100.01,.01,80,.02));
    }`);
    execFileSync('g++',['-std=c++17','-Wall','-Werror',join(dir,'guard.cpp'),'-o',join(dir,'guard')]);execFileSync(join(dir,'guard'));
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('MT5 EA rejection code and broker retcode are source-bound, durable, and never mean a fill',async t=>{
  const {app,post,base,source}=await setup(t);
  const response=await post(),wire=(await response.text()).split('|'),id=Number(wire[11]);
  assert.ok(Number.isSafeInteger(id));
  const result=await post('/api/bridge/website-result',
    {...source,id,status:'REJECTED',reason_code:112,mt5_retcode:10016});
  assert.equal(result.status,200);
  let responseAccount=await fetch(base+'/api/account',{headers:{Authorization:'Bearer '+ADMIN}});
  const account=await responseAccount.json();
  assert.equal(account.websiteEntries[0].status,'REJECTED');
  assert.equal(account.websiteEntries[0].reason_code,112);
  assert.equal(account.websiteEntries[0].mt5_retcode,10016);
  assert.equal(app.publicState().websiteBridge.lastResult,'REJECTED');
  // Duplicate/stale terminal responses must never turn REJECTED into SUBMITTED.
  await post('/api/bridge/website-result',{...source,id,status:'SUBMITTED',reason_code:0,mt5_retcode:10009});
  responseAccount=await fetch(base+'/api/account',{headers:{Authorization:'Bearer '+ADMIN}});
  const unchanged=await responseAccount.json();
  assert.equal(unchanged.websiteEntries[0].status,'REJECTED');
  assert.equal(unchanged.websiteEntries[0].mt5_retcode,10016);
  assert.equal((await post('/api/bridge/website-result',
    {...source,id,status:'REJECTED',reason_code:'112'})).status,400);
  assert.equal((await fetch(base+'/api/account')).status,401);
});
test('MT5 diagnostic wire is sent by bridge and written by main EA prior to result id',()=>{
  const bridge=readFileSync(new URL('./mt5/NABD_Bridge.mqh',import.meta.url),'utf8');
  const main=readFileSync(new URL('./mt5/NABD_Link.mqh',import.meta.url),'utf8');
  assert.match(bridge,/reason_code\\/);
  assert.match(bridge,/mt5_retcode\\/);
  const section=main.split('void NABDWebsiteBlocked')[1].split('void NABDProcessWebsiteApproval')[0];
  assert.ok(section.indexOf('NABDKey("WRC")') < section.indexOf('NABDKey("WI")'));
  assert.ok(section.indexOf('NABDKey("WRT")') < section.indexOf('NABDKey("WI")'));
});
