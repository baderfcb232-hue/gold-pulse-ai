import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedDecisionAudit} from './phase5-decision-audit.mjs';
const audit=()=>createIsolatedDecisionAudit({clock:()=>1800000000,limit:2});
test('redacts untrusted reasons and never exposes analysis thesis or credentials',()=>{
 const log=audit();
 log.record('XAUUSD',{stage:'BLOCKED',reason:'api_key=very-secret',
   accountLogin:987654,thesis:'super private model reasoning',price:4200});
 log.record('BTCUSD',{stage:'ANALYZED',stance:'SELL_WATCH',confidence:0.81237,
   modelOutput:'raw expensive response',key:'abc'});
 const r=log.report();const raw=JSON.stringify(r);
 assert.equal(r.total,2);
 assert.equal(r.recent[0].confidence,0.81);
 assert.equal(r.reasonCounts.REDACTED_REASON,1);
 for(const secret of ['very-secret','987654','super private','4200','raw expensive','abc'])
  assert.equal(raw.includes(secret),false);
 assert.equal(r.executionAllowed,false);
});
test('bounded recent events still count every event',()=>{
 const log=audit();
 for(let i=0;i<8;i++)log.record('XAUUSD',{stage:'BLOCKED',reason:'STALE_BROKER_QUOTE'});
 const r=log.report();
 assert.equal(r.total,8);assert.equal(r.recent.length,2);
 assert.equal(r.reasonCounts.STALE_BROKER_QUOTE,8);
 assert.equal(r.stageCounts.BLOCKED,8);
 assert.equal(r.canTriggerTrade,false);
});
test('reject invalid event symbols/stages and redact unsafe text',()=>{
 const log=audit();
 assert.equal(log.record('EURUSD',{stage:'ANALYZED'}).accepted,false);
 assert.equal(log.record('BTCUSD',{stage:'SEND_LIVE_ORDER'}).accepted,false);
 assert.equal(log.record('BTCUSD',null).accepted,false);
 assert.equal(log.report().invalid,3);
 assert.equal(log.report().total,0);
});
test('returned reports cannot modify stored audit entries',()=>{
 const log=audit();log.record('BTCUSD',{stage:'BLOCKED',reason:'NO_AI_WATCH'});
 const first=log.report();first.recent[0].reason='TAMPERED';
 first.stageCounts.BLOCKED=999;
 const later=log.report();
 assert.equal(later.recent[0].reason,'NO_AI_WATCH');
 assert.equal(later.stageCounts.BLOCKED,1);
});
