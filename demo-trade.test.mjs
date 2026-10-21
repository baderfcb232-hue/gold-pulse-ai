import test from 'node:test';
import assert from 'node:assert/strict';
import {demoTradeDecision} from './demo-trade.mjs';
const now=2000000000;
const snapshot=()=>({account:{equity:1000},broker:'JustMarkets-Demo',symbol:'XAUUSD.m',terminal_connected:true,
  quote_at:now,received_at:now,bid:2500,ask:2500.2,
  spec:{point:0.01},ea:{heartbeat_at:now,emergency_stop:false,settings:{max_spread_points:80}},
  execution:{demo:true,main_connected:true,enabled:true,remote_control:true,paused:false}});
const pub=()=>({ready:true,plan:{id:'a1',broker_symbol:'XAUUSD.m',side:'BUY',
  entry:2500.1,sl:2498.1,tp1:2504.1,issued_at:now-2,expires_at:now+100,bar_time:now-300}});
test('off by default',()=>assert.equal(demoTradeDecision({snapshot:snapshot(),publication:pub(),now}).reason,'DISABLED'));
test('reject real accounts',()=>{let s=snapshot();s.execution.demo=false;assert.equal(demoTradeDecision({enabled:true,snapshot:s,publication:pub(),now}).reason,'NOT_JUSTMARKETS_DEMO')});
test('reject other brokers',()=>{let s=snapshot();s.broker='Other-Demo';assert.equal(demoTradeDecision({enabled:true,snapshot:s,publication:pub(),now}).reason,'NOT_JUSTMARKETS_DEMO')});
test('reject stale quotes',()=>{let s=snapshot();s.quote_at=now-60;assert.equal(demoTradeDecision({enabled:true,snapshot:s,publication:pub(),now}).reason,'STALE_MT5')});
test('reject rejected recommendation',()=>assert.equal(demoTradeDecision({enabled:true,snapshot:snapshot(),publication:{ready:false},now}).reason,'PLAN_NOT_APPROVED'));
test('reject moved entry',()=>{let p=pub();p.plan.entry=2495;assert.equal(demoTradeDecision({enabled:true,snapshot:snapshot(),publication:p,now}).reason,'PRICE_OR_SPREAD_MOVED')});
test('reject flipped stop',()=>{let p=pub();p.plan.sl=2501;assert.equal(demoTradeDecision({enabled:true,snapshot:snapshot(),publication:p,now}).reason,'INVALID_PLAN')});
test('approve fresh demo with short TTL',()=>{let r=demoTradeDecision({enabled:true,snapshot:snapshot(),publication:pub(),now});assert.equal(r.ready,true);assert.equal(r.plan.expires_at,now+15);assert.equal(r.plan.tp,2504.1)});
