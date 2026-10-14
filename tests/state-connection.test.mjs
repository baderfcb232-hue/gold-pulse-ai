import test from 'node:test';
import assert from 'node:assert/strict';
import {createStateConnection} from '../public/state-connection.js';

const sample = (serverTime, connection = 'LIVE') => ({serverTime, connection});
function harness(readState = async () => sample(20)) {
  let time = 1000;
  const states = [], errors = [];
  const client = createStateConnection({readState, applyState: raw => states.push(raw),
    onError: err => errors.push(err.message), clock: () => time});
  return {client, states, errors, advance: ms => {time += ms;}};
}
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};

test('a silent stream resumes HTTP polling without requiring an error event', async () => {
  const h = harness();
  assert.equal(h.client.needsPoll(), true);
  h.client.receive(sample(1));
  h.advance(14999); assert.equal(h.client.needsPoll(), false);
  h.advance(1); assert.equal(h.client.needsPoll(), true);
  await h.client.refresh(); assert.equal(h.states.at(-1).serverTime, 20);
  assert.equal(h.client.needsPoll(), true, 'HTTP must not disguise the silent stream as healthy');
  h.client.receive(sample(21)); assert.equal(h.client.needsPoll(), false);
});

test('an older HTTP response cannot replace state recovered by the stream', async () => {
  const request = deferred(), h = harness(() => request.promise);
  const pending = h.client.refresh();
  h.client.receive(sample(30)); request.resolve(sample(25, 'STALE'));
  assert.equal(await pending, false);
  assert.deepEqual(h.states, [sample(30)]); assert.deepEqual(h.errors, []);
});

test('a late HTTP error cannot erase recovery by a valid state event', async () => {
  const request = deferred(), h = harness(() => request.promise);
  const pending = h.client.refresh();
  h.client.receive(sample(30)); request.reject(new Error('request timed out'));
  await pending; assert.deepEqual(h.errors, []); assert.equal(h.client.needsPoll(), false);
});

test('simultaneous manual and fallback refreshes share one request', async () => {
  const request = deferred(); let reads = 0;
  const h = harness(() => {reads++; return request.promise;});
  const first = h.client.refresh(), second = h.client.refresh();
  assert.equal(first, second); await Promise.resolve(); assert.equal(reads, 1);
  request.resolve(sample(10)); await first; assert.equal(h.states.length, 1);
  await h.client.refresh(); assert.equal(reads, 2);
});

test('request failure leaves polling active and the next response restores state', async () => {
  let reads = 0;
  const h = harness(() => {if (++reads === 1) throw new Error('offline'); return sample(2);});
  await h.client.refresh(); assert.deepEqual(h.errors, ['offline']);
  assert.equal(h.client.needsPoll(), true);
  await h.client.refresh(); assert.deepEqual(h.states, [sample(2)]);
});

test('invalid or disconnected events trigger fallback and cannot update the page', () => {
  const h = harness(); h.client.receive(sample(2));
  assert.equal(h.client.receive({serverTime: NaN}), false);
  assert.equal(h.states.length, 1); assert.equal(h.client.needsPoll(), true);
  h.client.receive(sample(3)); assert.equal(h.client.needsPoll(), false);
  h.client.disconnected(); assert.equal(h.client.needsPoll(), true);
});

test('out-of-order events cannot refresh the silence deadline', () => {
  const h = harness(); h.client.receive(sample(10)); h.advance(15000);
  assert.equal(h.client.receive(sample(9)), false);
  assert.equal(h.client.needsPoll(), true); assert.equal(h.states.length, 1);
});
