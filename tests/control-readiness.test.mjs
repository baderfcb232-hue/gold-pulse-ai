import test from 'node:test';
import assert from 'node:assert/strict';
import {controlBlockers} from '../public/control-readiness.js';

const ready = {action: 'CLOSE_ALL', authenticated: true, persistent: true,
  live: true, fresh: true, remoteControl: true, enabled: true};

test('ready MT5 control has no blockers', () => {
  assert.deepEqual(controlBlockers(ready), []);
});
test('temporary storage, stale MT5 and disabled remote controls show reasons', () => {
  const blockers = controlBlockers({...ready, persistent: false, fresh: false, remoteControl: false});
  assert.equal(blockers.length, 3);
  assert.match(blockers.join(' '), /تخزينًا دائمًا/);
  assert.match(blockers.join(' '), /قديمة/);
  assert.match(blockers.join(' '), /التحكم عن بُعد/);
});
test('pause and resume do not require execution to be enabled', () => {
  for (const action of ['PAUSE', 'RESUME']) {
    assert.deepEqual(controlBlockers({...ready, action, enabled: false}), []);
  }
});
test('close, break-even, partial close require enabled execution', () => {
  for (const action of ['CLOSE_ALL','CLOSE_POSITION','BREAK_EVEN','PARTIAL_CLOSE']) {
    assert.match(controlBlockers({...ready, action, enabled: false}).join(' '), /التنفيذ غير مفعّل/);
  }
});
test('unauthenticated and offline control provides all applicable reasons', () => {
  const blockers = controlBlockers({action:'CLOSE_ALL'});
  assert.equal(blockers.length, 6);
});

import {marketControlStatus} from '../public/control-readiness.js';
const time=1000;
const connected={connection:'LIVE',terminalConnected:true,bridgeReceivedAt:time,lastUpdate:time,
  bot:{heartbeat_at:time},execution:{main_connected:true}};
test('stale gold price does not block live BTC controls and still permits gold pause',()=>{
  const controls={XAUUSD:{...connected,connection:'STALE',lastUpdate:time-120000},BTCUSD:connected};
  const gold=marketControlStatus(controls,'XAUUSD',time);
  const btc=marketControlStatus(controls,'BTCUSD',time);
  assert.equal(gold.live,false);assert.equal(gold.fresh,true);assert.equal(gold.bridgeLive,true);
  assert.match(gold.summary,/البوت متصل.*السعر قديم/);
  assert.equal(btc.live,true);assert.equal(btc.fresh,true);
  assert.match(btc.summary,/البيتكوين.*السعر حديث/);
  assert.deepEqual(controlBlockers({...ready,action:'PAUSE',live:gold.bridgeLive,fresh:gold.fresh}),[]);
  assert.deepEqual(controlBlockers({...ready,live:btc.live,fresh:btc.fresh}),[]);
});
test('each market fails closed for missing, disconnected, stale or future bridge updates',()=>{
  for(const c of [null,{...connected,terminalConnected:false},{...connected,bridgeReceivedAt:time-11},
    {...connected,bridgeReceivedAt:time+6},{...connected,bridgeReceivedAt:null}]){
    const s=marketControlStatus({BTCUSD:c},'BTCUSD',time);
    assert.equal(s.live,false);assert.equal(s.fresh,false);assert.equal(s.bridgeLive,false);
  }
  const stale=marketControlStatus({BTCUSD:{...connected,bot:{heartbeat_at:time-6}}},'BTCUSD',time);
  assert.equal(stale.fresh,false);assert.match(stale.summary,/ننتظر نبض البوت/);
});

import {marketControlWarnings} from '../public/control-readiness.js';

test('a stale gold price alone never generates a global MT5 outage alert', () => {
  const controls = {
    XAUUSD: {...connected, connection:'STALE', lastUpdate:time-3600},
    BTCUSD: connected
  };
  assert.deepEqual(marketControlWarnings(controls,time),[]);
});
test('warnings name only the market with a stale bridge or stale bot heartbeat', () => {
  const gold = {...connected,bridgeReceivedAt:time-61};
  const btc = connected;
  let warnings = marketControlWarnings({XAUUSD:gold,BTCUSD:btc},time);
  assert.equal(warnings.length,1);
  assert.equal(warnings[0].key,'bridge:XAUUSD');
  assert.match(warnings[0].message,/الذهب/);
  warnings=marketControlWarnings({XAUUSD:connected,BTCUSD:{...btc,bot:{heartbeat_at:time-6}}},time);
  assert.equal(warnings.length,1);
  assert.equal(warnings[0].key,'bot:BTCUSD');
  assert.match(warnings[0].message,/البيتكوين/);
});

import {closeButtonDisplay} from '../public/control-readiness.js';

test('close-all appearance stays stable when heartbeat changes but positions remain empty', () => {
  const lost = closeButtonDisplay({authenticated:true,positions:[],issues:['حالة بوت MT5 قديمة']});
  const restored = closeButtonDisplay({authenticated:true,positions:[],issues:[]});
  assert.deepEqual(lost, restored);
  assert.equal(restored.positionState,'empty');
  assert.match(restored.hint,/لا توجد صفقات/);
});
test('close-all appearance follows verified position count without bypassing actual blockers', () => {
  const blocked = closeButtonDisplay({authenticated:true,positions:[{ticket:'123'}],issues:['جسر MT5 متأخر']});
  const readyDisplay = closeButtonDisplay({authenticated:true,positions:[{ticket:'123'}],issues:[]});
  assert.deepEqual(blocked, readyDisplay);
  assert.equal(blocked.positionState,'open');
  assert.deepEqual(controlBlockers({...ready,fresh:false}),['حالة بوت MT5 قديمة أو غير متاحة.']);
  const unknown=closeButtonDisplay({authenticated:true,positions:null,issues:['الربط غير متاح']});
  assert.equal(unknown.positionState,'unknown');
});
