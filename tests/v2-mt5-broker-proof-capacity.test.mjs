import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../server.mjs';
import {eaFixture,NOW} from './fixtures.mjs';
import {verifiedBrokerDeal,linkExecutionTrace} from '../execution-trace.mjs';

const INGEST='NABD_E2E_DIAGNOSTICS_ONLY_XXXXXXXXXXXXXXXX';
const BASE_PLAN={id:'synthetic-plan-1',symbol:'XAUUSD',broker_symbol:'XAUUSD',side:'BUY',source:'MT5 · JustMarkets-Demo'};

test('no order is called FILLED unless an exact matching MT5 broker deal appears',()=>{
 const entry={id:17,plan_id:BASE_PLAN.id,symbol:'XAUUSD',status:'SUBMITTED',
   time:NOW-5,deal_ticket:'123456789012',plan:BASE_PLAN};
 const good={execution:{demo:true},broker:'JustMarkets-Demo',symbol:'XAUUSD',
   deals:[{ticket:entry.deal_ticket,entry_type:'IN',side:'BUY',volume:.01,time:NOW}]};
 const plan=[BASE_PLAN];
 const matched=verifiedBrokerDeal(entry,good);
 assert.equal(matched.ticket,entry.deal_ticket);
 const [ok]=linkExecutionTrace(plan,[entry],[],{XAUUSD:good});
 assert.equal(ok.execution_trace.status,'FILLED');
 assert.equal(ok.execution_trace.broker_fill_confirmed,true);
 assert.equal(ok.execution_trace.broker_deal_ticket,entry.deal_ticket);
 const bad=[
  {...good,execution:{demo:false}},
  {...good,broker:'OtherBroker-Demo'},
  {...good,symbol:'BTCUSD'},
  {...good,deals:[]},
  {...good,deals:[{...good.deals[0],ticket:'987654321'}]},
  {...good,deals:[{...good.deals[0],entry_type:'OUT'}]},
  {...good,deals:[{...good.deals[0],side:'SELL'}]},
  {...good,deals:[{...good.deals[0],volume:0}]},
  {...good,deals:[{...good.deals[0],time:NOW-100}]}
 ];
 for(const snap of bad){
  assert.equal(verifiedBrokerDeal(entry,snap),null,'Cross-source or mismatched broker deal must never confirm execution');
  const [noFill]=linkExecutionTrace(plan,[entry],[],{XAUUSD:snap});
  assert.equal(noFill.execution_trace.broker_fill_confirmed,false);
  assert.equal(noFill.execution_trace.status,'SUBMITTED');
 }
 for(const ticket of ['', '0', 'not-a-ticket', '123456789012345678901']){
  assert.equal(verifiedBrokerDeal({...entry,deal_ticket:ticket},good),null);
 }
 assert.equal(verifiedBrokerDeal({...entry,status:'REJECTED'},good),null);
});

test('100 concurrent synthetic MT5 sources expose current per-symbol account capacity without cross-account state leaks',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'nabd-100-bridges-'));
 const app=createApplication({dataDir:dir,clock:()=>NOW,ingestToken:INGEST,config:{goldOnly:false}});
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;
 const seed=eaFixture(NOW);
 seed.account_ref='NABD_TEST_TENANT_000';
 seed.bid=4010;seed.ask=4010.03;seed.quote_at=NOW;
 app.ingest(seed); // one current slot for XAUUSD, one source identity only
 const baseline=await(await fetch(base+'/api/market/broker-quotes')).json();
 const original=baseline.quotes.XAUUSD;
 assert.ok(original&&original.quote);
 const foreignAccounts=Array.from({length:99},(_,n)=>{
  const data=eaFixture(NOW);
  data.account_ref='NABD_TEST_TENANT_'+String(n+1).padStart(3,'0');
  data.bid=4200+n;data.ask=data.bid+.03;data.quote_at=NOW;
  return data;
 });
 const started=Date.now();
 const outcomes=await Promise.all(foreignAccounts.map(async snapshot=>{
  const res=await fetch(base+'/api/mt5',{method:'POST',
   headers:{'Content-Type':'application/json',Authorization:'Bearer '+INGEST},
   body:JSON.stringify(snapshot),signal:AbortSignal.timeout(20000)});
  await res.arrayBuffer();
  return res.status;
 }));
 const accepted=outcomes.filter(status=>status===200).length;
 assert.equal(accepted,0,'Do not silently accept an unrelated account into the active XAUUSD trading slot');
 assert.equal(outcomes.length,99);
 assert.ok(outcomes.every(code=>code>=400&&code<600),'Every foreign source must be rejected');
 const after=await(await fetch(base+'/api/market/broker-quotes')).json();
 assert.deepEqual(after.quotes.XAUUSD,original,'100 synthetic account attempts must not overwrite the current connected broker state');
 const same=await fetch(base+'/api/mt5',{method:'POST',
  headers:{'Content-Type':'application/json',Authorization:'Bearer '+INGEST},
  body:JSON.stringify(seed)});
 assert.equal(same.status,200,'The original MT5 source remains valid');
 const report={attemptedSyntheticAccounts:100,existingSourceAccepted:1,
  otherSourceAccepted:accepted,otherSourceRejected:outcomes.length-accepted,
  isolatedBrokerState:true,simulatedOnly:true,brokerOrdersSent:0,
  elapsedMs:Date.now()-started,concurrentUserCapacityVerified:false};
 console.log('NABD MT5 capacity diagnostic:',JSON.stringify(report));
});
