import test from 'node:test';
import assert from 'node:assert/strict';
import {recommendationCode,linkExecutionTrace} from './execution-trace.mjs';

test('one immutable signal ID maps to its own journal order, not the other BTC or gold recommendation',()=>{
  const p={id:'NABD-BTC-SCALP-M5M15-V1:BTCUSD:MT5:btc:123:BUY',symbol:'BTCUSD',source:'MT5 · JustMarkets-Demo'};
  const gold={id:'NABD-GOLD-SCALP-M5M15-V1:XAUUSD:MT5:gold:123:BUY',symbol:'XAUUSD',source:'MT5 · JustMarkets-Demo'};
  const entries=[{id:42,plan_id:p.id,time:20,plan:{...p},status:'SUBMITTED',mt5_retcode:10009},
    {id:43,plan_id:gold.id,time:21,plan:{...gold},status:'REJECTED',reason_code:112,mt5_retcode:10016}];
  const [btc,xau]=linkExecutionTrace([p,gold],entries);
  assert.equal(btc.execution_trace.approval_id,42);
  assert.equal(btc.execution_trace.status,'SUBMITTED');
  assert.equal(btc.execution_trace.broker_fill_confirmed,false);
  assert.equal(xau.execution_trace.status,'REJECTED');
  assert.equal(xau.execution_trace.reason_code,112);
  assert.notEqual(btc.execution_trace.signal_code,xau.execution_trace.signal_code);
  assert.equal(btc.execution_trace.signal_code,recommendationCode(p.id));
});
test('blocked and never-polled recommendations are visible instead of being mislabelled executed',()=>{
  const plan={id:'btc-setup-1',symbol:'BTCUSD',source:'MT5 · JustMarkets-Demo'};
  const earlier={id:'btc-setup-2',symbol:'BTCUSD',source:'MT5 · JustMarkets-Demo'};
  const generic={id:'reference-1',symbol:'BTCUSD',source:'Coinbase'};
  const [a,b,c]=linkExecutionTrace([plan,earlier,generic],[],
    [{symbol:'BTCUSD',plan_id:plan.id,status:'BLOCKED',reason:'PRICE_OR_SPREAD_MOVED',updated_at:12}]);
  assert.equal(a.execution_trace.status,'BLOCKED');
  assert.equal(a.execution_trace.reason,'PRICE_OR_SPREAD_MOVED');
  assert.equal(b.execution_trace.status,'NOT_DISPATCHED');
  assert.equal(c.execution_trace,undefined);
});
test('the same approval cannot be mistaken for a broker fill and a newer rejection wins',()=>{
  const s={id:'s1',symbol:'BTCUSD',source:'MT5 · JustMarkets-Demo'};
  const entries=[{id:4,time:1,status:'SUBMITTED',plan:{...s}},
    {id:4,time:2,status:'REJECTED',reason_code:115,plan:{...s}}];
  const [v]=linkExecutionTrace([s],entries);
  assert.equal(v.execution_trace.status,'REJECTED');
  assert.equal(v.execution_trace.approval_id,4);
  assert.equal(v.execution_trace.broker_fill_confirmed,false);
});
