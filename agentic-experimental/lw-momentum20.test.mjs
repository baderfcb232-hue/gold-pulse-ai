import test from 'node:test';
import assert from 'node:assert/strict';
import {lwEvidence,validateDailySession,createLWStore} from './lw-momentum20.mjs';
const start=Date.parse('2026-11-25T00:00:00Z')/1000;
function snapshot(side=1){
 const closed=Array.from({length:21},(_,i)=>{const c=100+side*i;return {time:start-(21-i)*86400,open:c,high:c+2,low:c-2,close:c}});
 const open=closed.at(-1).close;
 const bars=[{time:start,open,high:open+1,low:open-1,close:open},{time:start+300,open,high:open+3,low:open-3,close:open+side*2.5}];
 const price=bars.at(-1).close;
 return {environment:'EXPERIMENTAL_NABD_AGENTIC',accountType:'DEMO',executionEnabled:false,symbol:'XAUUSD',brokerServer:'JustMarkets-Demo',brokerSymbol:'XAUUSD.m',accountLogin:12345,timestamp:start+600,bid:price,ask:price+.1,dailySession:{start,open,closed},candlesM5:bars};
}
test('positive and negative 20-session momentum permit respective fresh crossings',()=>{
 for(const side of [1,-1]){
  const q=snapshot(side),e=lwEvidence(q);assert.equal(e.status,'OBSERVED_CANDIDATE');
  assert.equal(e.candidate,side===1?'BUY':'SELL');assert.equal(e.momentum20,side*20);
  assert.equal(e.stopReference,q.dailySession.open);assert.equal(e.targetReference,q.dailySession.open+side*10);
  assert.equal(e.executionPermission,false);
 }
});
test('no wrong-way entries, duplicate continuation or future candle',()=>{
 const q=snapshot(1),bar=q.candlesM5.at(-1);
 assert.equal(lwEvidence({...q,candlesM5:[q.candlesM5[0],{...bar,close:q.dailySession.open-2.5}]}).candidate,null);
 assert.equal(lwEvidence({...q,timestamp:q.timestamp-1}).status,'WAITING_CLOSED_M5');
 const p={...bar,time:bar.time+300,open:bar.close};
 assert.equal(lwEvidence({...q,timestamp:q.timestamp+300,candlesM5:[bar,p]}).candidate,null);
});
test('D1 missing, stale, future or incomplete history fails closed; wide spread only records blocked candidate',()=>{
 const q=snapshot();assert.equal(lwEvidence({...q,dailySession:null}).status,'WAITING_VERIFIED_BROKER_D1');
 assert.equal(validateDailySession({...q.dailySession,closed:q.dailySession.closed.slice(-20)},q.timestamp),null);
 assert.equal(validateDailySession({...q.dailySession,start:q.timestamp+300},q.timestamp),null);
 assert.equal(lwEvidence({...q,ask:q.bid+3}).status,'CANDIDATE_QUOTE_BLOCKED');
 assert.equal(lwEvidence({...q,symbol:'BTCUSD'}).status,'GOLD_RESEARCH_ONLY');
});
test('candidate storage is deduplicated and refuses LIVE source',async()=>{
 const keys=new Set();const query=async(sql,args)=>{assert.match(sql,/ON CONFLICT DO NOTHING/);const key=args.slice(0,2).join(':');const rowCount=keys.has(key)?0:1;keys.add(key);return {rowCount}};
 const s=createLWStore({query}),q=snapshot();
 assert.equal((await s.observe(q)).inserted,true);assert.equal((await s.observe(q)).inserted,false);
 assert.equal((await s.observe({...q,accountType:'LIVE'})).inserted,false);
});
