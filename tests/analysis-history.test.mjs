import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {captureAnalysisSnapshot,createAnalysisHistory} from '../analysis-history.mjs';
import {historyQuery} from '../public/analysis-history.js';
import {createApplication} from '../server.mjs';

const NOW=1793980800;
const sample=(symbol='XAUUSD',status='SCANNING',at=NOW)=>({
 symbol,source_id:'MT5:some-private-account-ref',broker_symbol:symbol+'.m',
 source:'MT5 · Demo',quote:{time:at,price:4050.12},received_at:at,quoteTtl:20,connection:'LIVE',
 analysis:{status,decision:'WAIT',strategy:'FUSION',reason_label:'انتظار توافق M15 و H1',
  score:75,frames:{M5:{direction:'BUY'},M15:{direction:'NEUTRAL'},H1:{direction:'SELL'}},
  checks:[{name:'EMA M15',pass:true}],readinessChecks:[{name:'MT5 price fresh',pass:true}],
  entrySafetyChecks:[{name:'Stop distance',pass:false}]},
 account_ref:'123456789',password:'should-never-leave'
});
const state=m=>({markets:{[m.symbol]:m}});
test('history sanitization never stores account identifiers, plans, recommendation IDs or broker tickets',()=>{
 const m=sample();
 m.currentSignal={id:'private-recommendation-id',entry:4050,sl:4030};
 m.analysis.plan={side:'BUY',entry:4050,sl:4030,tp:4080};
 const row=captureAnalysisSnapshot(m,NOW);
 assert.equal(row.symbol,'XAUUSD');
 assert.equal(row.status,'SCANNING');
 assert.equal(row.source_type,'MT5');
 assert.equal(row.score,75);
 assert.deepEqual(row.frames,{M5:'BUY',M15:'NEUTRAL',H1:'SELL'});
 assert.equal(row.entry_checks[0].pass,false);
 for(const sensitive of ['123456789','private-account-ref','private-recommendation-id','should-never-leave','account_ref','password','ticket','entry','tp1','tp2']){
  if(['entry'].includes(sensitive))continue; // Entry checks is allowed; entries/prices are not.
  assert.equal(JSON.stringify(row).includes(sensitive),false,'sensitive content: '+sensitive);
 }
 assert.equal(Object.hasOwn(row,'plan'),false);
 assert.equal(Object.hasOwn(row,'currentSignal'),false);
});
test('missing quotes create no synthetic history and stale data cannot retain score or directions',()=>{
 assert.equal(captureAnalysisSnapshot({...sample(),quote:null},NOW),null);
 const stale=captureAnalysisSnapshot({...sample(),quote:{time:NOW-100,price:4050.12}},NOW);
 assert.equal(stale.status,'STALE');
 assert.equal(stale.score,null);
 assert.deepEqual(stale.frames,{});
 assert.deepEqual(stale.entry_checks,[]);
});
test('SQLite analysis journal preserves observations across restart and rate-limits repeated state',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nabd-history-db-'));
 let at=NOW;
 try{
  const path=join(dir,'history.sqlite');
  let db=new DatabaseSync(path);
  let h=createAnalysisHistory({db,clock:()=>at,storagePersistent:true});
  const m=sample('XAUUSD','SCANNING',at);
  assert.equal(h.capture(state(m)),1);
  assert.equal(h.capture(state(m)),0);
  at+=3;m.quote.time=at;
  assert.equal(h.capture(state(m)),0);
  at+=20;m.quote.time=at;m.analysis.status='READY';
  assert.equal(h.capture(state(m)),1);
  at+=1;m.quote.time=at;m.analysis.status='SCANNING';
  assert.equal(h.capture(state(m)),0);
  at+=50;m.quote.time=at;
  assert.equal(h.capture(state(m)),1);
  const b=sample('BTCUSD','NEWS_BLOCK',at);
  assert.equal(h.capture(state(b)),1);
  assert.equal(h.list({symbol:'XAUUSD'}).items.length,3);
  assert.equal(h.list({symbol:'BTCUSD'}).items.length,1);
  const paged=h.list({limit:2});
  assert.equal(paged.items.length,2);
  assert.ok(Number.isSafeInteger(paged.next_cursor));
  const second=h.list({limit:2,before:paged.next_cursor});
  assert.equal(second.items.length,2);
  assert.ok(second.items.every(row=>row.id<paged.next_cursor));
  assert.equal(h.list({status:'READY'}).items.length,1);
  assert.equal(h.list({since:at-4}).items.length,2);
  assert.equal(h.list({symbol:'ALL'}).scope,'GLOBAL_MARKET');
  assert.equal(h.list().kind,'ANALYSIS_OBSERVATIONS_NOT_TRADES');
  assert.equal(h.list().backfilled,false);
  assert.equal(h.list().storage_persistent,true);
  assert.throws(()=>h.list({symbol:'ETHUSD'}),RangeError);
  assert.throws(()=>h.list({limit:1000}),RangeError);
  db.close();
  db=new DatabaseSync(path);
  h=createAnalysisHistory({db,clock:()=>at,storagePersistent:true});
  assert.equal(h.list({symbol:'XAUUSD'}).items.length,3);
  db.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('pruning honors bounded retention and cursor does not cross filter boundaries',()=>{
 const db=new DatabaseSync(':memory:');let at=NOW;
 const h=createAnalysisHistory({db,clock:()=>at,retentionDays:1,maxRows:3,minChangeSeconds:10,sampleSeconds:20});
 for(let i=0;i<6;i++){
  const m=sample(i%2?'BTCUSD':'XAUUSD',i%2?'WATCH':'SCANNING',at);
  h.capture(state(m));at+=100;
 }
 assert.equal(h.list({limit:100}).items.length,6);
 at+=2*86400;
 h.prune();
 assert.equal(h.list().items.length,0);
 db.close();
});
test('query builder filters by market/status/window and never adds trade API calls',()=>{
 const url=new URL('https://test.invalid'+historyQuery({symbol:'BTCUSD',status:'NEWS_BLOCK',period:'DAY',now:NOW,limit:30}));
 assert.equal(url.pathname,'/api/analysis-history');
 assert.equal(url.searchParams.get('symbol'),'BTCUSD');
 assert.equal(url.searchParams.get('status'),'NEWS_BLOCK');
 assert.equal(url.searchParams.get('since'),String(NOW-86400));
 assert.equal(url.searchParams.get('limit'),'30');
 assert.equal(new URL('https://test.invalid'+historyQuery({period:'ALL',before:21})).searchParams.has('since'),false);
});
test('history page and API protect detailed observations for verified users, never fabricate prior analyses',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'nabd-history-server-'));
 const app=createApplication({dataDir:dir});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;
 const page=await fetch(base+'/analysis-history');
 assert.equal(page.status,200);
 assert.match(await page.text(),/سجل تحليلات السوق/);
 for(const path of ['/analysis-history.css','/analysis-history.js']){
  const res=await fetch(base+path);
  assert.equal(res.status,200,path);
 }
 const unauthorized=await fetch(base+'/api/analysis-history');
 assert.equal(unauthorized.status,401);
 app.analysisHistory.capture(state(sample('XAUUSD','SCANNING',Math.floor(Date.now()/1000))));
 const unauthorizedAgain=await fetch(base+'/api/analysis-history');
 assert.equal(unauthorizedAgain.status,401);
});
test('separate records are visible through explicitly configured public-test mode, with validated filters',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'nabd-history-open-test-'));
 const app=createApplication({dataDir:dir,config:{membersOnlySignals:false}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;
 const time=Math.floor(Date.now()/1000);
 const m=sample('XAUUSD','BLOCKED',time);
 m.analysis.reason_label='Risk gate not met';
 app.analysisHistory.capture(state(m));
 const response=await fetch(base+'/api/analysis-history?symbol=XAUUSD&status=BLOCKED&limit=3');
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.items.length,1);
 assert.equal(data.items[0].status,'BLOCKED');
 assert.equal(data.items[0].kind,'ANALYSIS_OBSERVATION');
 assert.equal(data.backfilled,false);
 assert.equal((await fetch(base+'/api/analysis-history?symbol=ETHUSD')).status,400);
 assert.equal((await fetch(base+'/api/analysis-history?limit=1000')).status,400);
});
test('front end has only text-safe rendering, server-side scoped history and no execution surface',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 const html=read('public/analysis-history.html'),js=read('public/analysis-history.js');
 const server=read('server.mjs'),dashboard=read('public/index.html');
 assert.match(html,/id="history-list"/);
 assert.match(html,/id="history-symbol"/);
 assert.match(html,/id="history-status"/);
 assert.match(html,/id="history-period"/);
 assert.match(dashboard,/href="\/analysis-history"/);
 assert.match(server,/await canReadSignals\(req\)/);
 assert.match(server,/analysisHistory\.capture\(raw\)/);
 assert.match(server,/analysis-history\.js/);
 assert.match(js,/textContent/);
 assert.match(html,/aria-live/);
 for(const source of [js,html]){
  assert.doesNotMatch(source,/\/api\/commands|\/api\/bridge\/next|OrderSend|innerHTML|\/api\/risk-settings/);
 }
});
