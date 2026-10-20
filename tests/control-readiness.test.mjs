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
