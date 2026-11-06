import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {captureAnalysisSnapshot,createAnalysisHistory} from '../analysis-history.mjs';
import {verifiedAnalysisLink} from '../analysis-history-link.mjs';
import {recommendationCode} from '../execution-trace.mjs';
import {createApplication} from '../server.mjs';
import {DatabaseSync} from 'node:sqlite';

const NOW=1793980800, ID='mt5-published-plan-123';
const snapshot=()=>({
 symbol:'XAUUSD',source_id:'MT5:private-account-marker',connection:'LIVE',
 quote:{time:NOW-1,price:4550},received_at:NOW-1,quoteTtl:20,
 analysis:{status:'READY',score:86,reason:'EMA M15 and H1 aligned',frames:{M15:{direction:'BUY'}},checks:[{name:'EMA',pass:true}]},
 currentSignal:{id:ID,symbol:'XAUUSD',issued_at:NOW-20,expires_at:NOW+60,
  source:'MT5',account_ref:'987654321'}
});
test('archive only stores hashed exact, current and published MT5 recommendation ID',()=>{
 const row=captureAnalysisSnapshot(snapshot(),NOW);
 assert.equal(row.recommendation_code,recommendationCode(ID));
 for(const secret of [ID,'private-account-marker','987654321','account_ref'])
  assert.equal(JSON.stringify(row).includes(secret),false);
 assert.equal(captureAnalysisSnapshot({...snapshot(),currentSignal:null},NOW).recommendation_code,null);
 const stale=snapshot();stale.quote.time=NOW-100;
 assert.equal(captureAnalysisSnapshot(stale,NOW).recommendation_code,null);
 const expired=snapshot();expired.currentSignal.expires_at=NOW-1;
 assert.equal(captureAnalysisSnapshot(expired,NOW).recommendation_code,null);
 const wrong=snapshot();wrong.currentSignal.symbol='BTCUSD';
 assert.equal(captureAnalysisSnapshot(wrong,NOW).recommendation_code,null);
 const noReady=snapshot();noReady.analysis.status='SCANNING';
 assert.equal(captureAnalysisSnapshot(noReady,NOW).recommendation_code,null);
});
test('no fake fills: exact signal ID and broker ticket evidence required',()=>{
 const row=captureAnalysisSnapshot(snapshot(),NOW);
 const signal={id:ID,source:'MT5 · JustMarkets',symbol:'XAUUSD',issued_at:NOW-20,
  expires_at:NOW+60,status:'TRACKING'};
 const missing=verifiedAnalysisLink(row,[]);
 assert.deepEqual(missing,{linked:false,reason:'EXACT_SIGNAL_NOT_AVAILABLE'});
 const another=verifiedAnalysisLink(row,[{...signal,id:'different'}]);
 assert.equal(another.linked,false);
 const noTrace=verifiedAnalysisLink(row,[signal]);
 assert.equal(noTrace.linked,true);
 assert.equal(noTrace.broker_fill_confirmed,false);
 assert.equal(noTrace.broker_deal_ticket,null);
 const submitted=verifiedAnalysisLink(row,[{...signal,execution_trace:{status:'SUBMITTED',broker_fill_confirmed:false,broker_deal_ticket:'998'}}]);
 assert.equal(submitted.execution_state,'SUBMITTED_NOT_BROKER_CONFIRMED');
 assert.equal(submitted.broker_fill_confirmed,false);
 const forged=verifiedAnalysisLink(row,[{...signal,execution_trace:{status:'FILLED',broker_fill_confirmed:false,broker_deal_ticket:'998'}}]);
 assert.equal(forged.broker_fill_confirmed,false);
 const confirmed=verifiedAnalysisLink(row,[{...signal,execution_trace:{status:'FILLED',broker_fill_confirmed:true,broker_deal_ticket:'998'}}]);
 assert.equal(confirmed.execution_state,'BROKER_FILL_CONFIRMED');
 assert.equal(confirmed.broker_deal_ticket,'998');
 const dup=verifiedAnalysisLink(row,[signal,signal]);assert.equal(dup.linked,false);
});
test('SQLite history yields exact ID for operator verification, but cannot invent old recommendations',()=>{
 const db=new DatabaseSync(':memory:');
 const h=createAnalysisHistory({db,clock:()=>NOW});
 assert.equal(h.capture({markets:{XAUUSD:snapshot()}}),1);
 const row=h.list().items[0],byId=h.get(row.id);
 assert.equal(byId.recommendation_code,recommendationCode(ID));
 assert.equal(h.get(row.id+999),null);
 assert.throws(()=>h.get(-2),RangeError);
 db.close();
});
test('verified endpoint is operator-only even when public history view is allowed',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'nabd-analysis-link-'));
 const key='z'.repeat(40),app=createApplication({dataDir:dir,dashboardToken:key,config:{membersOnlySignals:false}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;
 assert.equal((await fetch(base+'/api/analysis-history/link?id=1')).status,403);
 assert.equal((await fetch(base+'/api/analysis-history/link?id=invalid',{headers:{Authorization:'Bearer '+key}})).status,400);
 const ok=await fetch(base+'/api/analysis-history/link?id=777777',{headers:{Authorization:'Bearer '+key}});
 assert.equal(ok.status,404);
});
test('operator read-only view is isolated from orders, account data and member-only permissions',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 const server=read('server.mjs'),frontend=read('public/analysis-history.js'),pg=read('analysis-history-pg.mjs');
 assert.match(server,/if\(!operator\(req\)\)return send\(req,res,403/);
 assert.match(server,/verifiedAnalysisLink\(observation,await tracedSignalRows\(\)\)/);
 assert.match(frontend,/data\.broker_fill_confirmed===true/);
 assert.match(frontend,/\/api\/analysis-history\/link\?id=/);
 assert.match(pg,/async function get\(id\)/);
 assert.match(pg,/recommendation_code/);
 for(const source of [frontend,read('analysis-history-link.mjs')])
  assert.doesNotMatch(source,/\/api\/commands|OrderSend|\/api\/bridge\/next|\/api\/risk-settings/);
});
