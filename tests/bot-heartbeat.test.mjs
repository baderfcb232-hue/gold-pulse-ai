import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {botHeartbeatFresh, BOT_CONTROL_TTL, cleanSnapshot, sourceAnalysis} from '../engine.mjs';
import {createApplication} from '../server.mjs';
import {eaFixture, NOW} from './fixtures.mjs';

test('bridge request latency does not suspend monitoring or change an EA plan', () => {
  for (const age of [0, 5, 5.001, 8, 12, 15]) {
    const raw = eaFixture(); raw.ea.heartbeat_at = NOW - age;
    const state = sourceAnalysis(cleanSnapshot(raw, NOW), NOW);
    assert.equal(state.source_ready, true, `heartbeat age ${age}`);
    assert.equal(state.plan.entry, raw.ea.signal.entry);
    assert.equal(state.plan.sl, raw.ea.signal.sl);
    assert.equal(state.plan.tp2, raw.ea.signal.target);
  }
  const raw = eaFixture(); raw.ea.heartbeat_at = NOW - 15.001;
  assert.equal(sourceAnalysis(cleanSnapshot(raw, NOW), NOW).source_ready, false);
});

test('new broker quotes cannot revive a missing, detached or stopped main bot', () => {
  for (const [at, connected] of [[0, true], [NOW, false], [NOW - 16, true]]) {
    const raw = eaFixture(); raw.ea.heartbeat_at = at; raw.execution.main_connected = connected;
    const state = sourceAnalysis(cleanSnapshot(raw, NOW), NOW);
    assert.equal(state.connection, 'LIVE'); assert.equal(state.source_ready, false);
    assert.equal(state.plan, null);
  }
  for (const at of [null, undefined, NaN, NOW + 5.001])
    assert.equal(botHeartbeatFresh(at, true, NOW), false);
});

test('remote command freshness keeps its original five-second limit', () => {
  assert.equal(botHeartbeatFresh(NOW - 5, true, NOW, BOT_CONTROL_TTL), true);
  assert.equal(botHeartbeatFresh(NOW - 5.001, true, NOW, BOT_CONTROL_TTL), false);
  assert.equal(botHeartbeatFresh(NOW - 8, true, NOW), true);
});

test('the API tolerates delayed telemetry for display while rejecting stale trade controls', async t => {
  let now = NOW + 7;
  const dir = mkdtempSync(join(tmpdir(), 'nabd-heartbeat-'));
  const ingest = 'heartbeat-test-ingest-xxxxxxxxxxxxxxxxxxxx';
  const operator = 'heartbeat-test-operator-yyyyyyyyyyyyyyyyyy';
  const app = createApplication({dataDir: dir, storagePersistent: true, clock: () => now,
    ingestToken: ingest, dashboardToken: operator});
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {await app.close(); rmSync(dir, {recursive: true, force: true});});
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const post = (path, body, token) => fetch(base + path, {method: 'POST',
    headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token},
    body: JSON.stringify(body)});
  const raw = eaFixture();
  assert.equal((await post('/api/mt5', raw, ingest)).status, 200);
  let state = await (await fetch(base + '/api/state')).json();
  assert.equal(state.connection, 'LIVE'); assert.equal(state.signalSourceReady, true);
  assert.equal(state.currentSignal, null);assert.equal(app.signalRows()[0].entry, raw.ea.signal.entry);
  assert.equal((await post('/api/commands', {action: 'PAUSE'}, operator)).status, 409);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM commands').get().n, 0);
  now = NOW + 16; raw.quote_at = now;
  assert.equal((await post('/api/mt5', raw, ingest)).status, 200);
  state = await (await fetch(base + '/api/state')).json();
  assert.equal(state.connection, 'LIVE'); assert.equal(state.signalSourceReady, false);
  assert.equal(state.currentSignal, null);
  now++; assert.equal((await post('/api/mt5', eaFixture(now), ingest)).status, 200);
  state = await (await fetch(base + '/api/state')).json();
  assert.equal(state.signalSourceReady, true);
  assert.equal((await post('/api/commands', {action: 'PAUSE'}, operator)).status, 202);
});
