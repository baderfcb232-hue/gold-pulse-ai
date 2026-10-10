import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createApplication} from '../server.mjs';
import {positionSize} from '../engine.mjs';
import {fixture, eaFixture, NOW} from './fixtures.mjs';

const INGEST = 'migration-test-ingest-xxxxxxxxxxxxxxxxxxxx';
const OPERATOR = 'migration-test-operator-yyyyyyyyyyyyyyyyyy';
const post = (base, path, data, token) => fetch(base + path, {method: 'POST',
  headers: {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {})},
  body: JSON.stringify(data)});

async function setup(t, {storagePersistent = false, clock = () => NOW} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'nabd-migration-')), active = new Set();
  t.after(async () => {for (const app of active) await app.close(); rmSync(dir, {recursive: true, force: true});});
  async function open() {
    const app = createApplication({dataDir: dir, storagePersistent, clock,
      ingestToken: INGEST, dashboardToken: OPERATOR});
    active.add(app);
    await new Promise(r => app.server.listen(0, '127.0.0.1', r));
    return {app, base: 'http://127.0.0.1:' + app.server.address().port};
  }
  return {open, close: async app => {active.delete(app); await app.close();}};
}

test('the existing node server.js command boots the updated site and shuts down cleanly', {timeout: 20000}, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'nabd-start-'));
  const child = spawn(process.execPath, ['server.js'], {cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {...process.env, PORT: '0', BIND_ADDRESS: '127.0.0.1', DATA_DIR: dir, RENDER: '',
      PUBLIC_BASE_URL: '', MT5_INGEST_TOKEN: '', DASHBOARD_TOKEN: '',
      SIGNAL_SOURCE: 'EA', PERSISTENT_STORAGE_CONFIRMED: 'false'}, stdio: ['ignore', 'pipe', 'pipe']});
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({code, signal})));
  t.after(async () => {if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await exited; rmSync(dir, {recursive: true, force: true});});
  const port = await new Promise((resolve, reject) => {
    let output = '';
    child.once('error', reject);
    child.once('exit', code => reject(new Error('Server exited before listening: ' + code)));
    child.stdout.on('data', chunk => {output += chunk.toString(); const match = output.match(/NABD v3\.2 listening on (\d+)/); if (match) resolve(Number(match[1]));});
  });
  const base = 'http://127.0.0.1:' + port;
  assert.deepEqual(await (await fetch(base + '/healthz')).json(), {ok: true, version: '3.2.0', storage: 'ephemeral'});
  const state = await (await fetch(base + '/api/state')).json();
  assert.equal(state.connection, 'NO_DATA'); assert.equal(state.bid, null); assert.equal(state.controlsConfigured, false);
  assert.match(await (await fetch(base + '/')).text(), /GOLD PULSE \/ 3\.2/);
  assert.equal((await fetch(base + '/app.js')).status, 200);
  child.kill('SIGTERM'); assert.deepEqual(await exited, {code: 0, signal: null});
});

test('the original ingestion path enforces authentication and a broker-backed schema', async t => {
  const {open} = await setup(t), {base} = await open();
  const old = {bid: 4000, ask: 4000.1, timeframes: {M5: 'BULLISH'}, balance: 1000};
  assert.equal((await post(base, '/api/update', old)).status, 401);
  const response = await post(base, '/api/update', old, INGEST);
  assert.equal(response.status, 426); assert.equal((await response.json()).endpoint, '/api/mt5');
  assert.equal((await (await fetch(base + '/api/state')).json()).bid, null);
  assert.equal((await post(base, '/api/update', fixture(), INGEST)).status, 200);
  const state = await (await fetch(base + '/api/state')).json();
  assert.equal(state.connection, 'LIVE'); assert.ok(!('accountBalance' in state));
  assert.ok(!JSON.stringify(state).includes('TEST_ACCOUNT_ONLY'));
});

test('the original risk endpoint uses real contract values without changing MT5 settings', async t => {
  const {open} = await setup(t), {app, base} = await open();
  const inputs = {balance: 5000, riskPercent: 0.5, entry: 4000, sl: 3990, commissionPerLot: 7};
  assert.equal((await post(base, '/api/risk-settings', inputs)).status, 401);
  assert.equal((await post(base, '/api/risk-settings', inputs, OPERATOR)).status, 409);
  const raw = fixture(); await post(base, '/api/mt5', raw, INGEST);
  const response = await post(base, '/api/risk-settings', inputs, OPERATOR); assert.equal(response.status, 200);
  const result = await response.json(), expected = positionSize({equity: inputs.balance, ...inputs,
    spec: raw.spec, freeMargin: raw.account.free_margin});
  assert.equal(result.calculatedLot, expected.volume); assert.equal(result.loss, expected.loss);
  assert.equal(result.status, 'estimated');
  const saved = JSON.parse(app.db.prepare('SELECT data FROM snapshot WHERE id=1').get().data);
  assert.equal(saved.execution.risk_percent, raw.execution.risk_percent);
  assert.equal(saved.account.balance, raw.account.balance);
});

test('risk estimates refuse stale quotes and never invent a missing stop loss', async t => {
  let now = NOW; const {open} = await setup(t, {clock: () => now}), {base} = await open();
  await post(base, '/api/mt5', fixture(), INGEST);
  assert.equal((await post(base, '/api/risk-settings', {balance: 1000, riskPercent: 1}, OPERATOR)).status, 409);
  now += 21;
  assert.equal((await post(base, '/api/risk-settings', {balance: 1000, riskPercent: 1, entry: 4000, sl: 3990}, OPERATOR)).status, 409);
});

test('ephemeral hosting permits monitoring but blocks both queueing and delivering trade controls', async t => {
  const {open} = await setup(t), {app, base} = await open(); await post(base, '/api/mt5', eaFixture(), INGEST);
  const state = await (await fetch(base + '/api/state')).json();
  assert.equal(state.connection, 'LIVE'); assert.equal(state.execution.remote_control, false);
  assert.equal(state.storage.mode, 'ephemeral'); assert.equal(state.storage.remoteControlAvailable, false);
  assert.equal((await post(base, '/api/commands', {action: 'CLOSE_ALL'}, OPERATOR)).status, 409);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM commands').get().n, 0);
  app.db.prepare("INSERT INTO commands(time,expires,action,ticket,fraction,status) VALUES(?,?,?,?,?,'QUEUED')")
    .run(NOW, NOW + 20, 'CLOSE_ALL', '0', 0);
  assert.equal(await (await fetch(base + '/api/bridge/next', {headers: {Authorization: 'Bearer ' + INGEST}})).text(), '');
  assert.equal((await fetch(base + '/api/account', {headers: {Authorization: 'Bearer ' + OPERATOR}})).status, 200);
});

test('durable command history retains confirmations and increasing IDs across a restart', async t => {
  const {open, close} = await setup(t, {storagePersistent: true});
  const first = await open(); await post(first.base, '/api/mt5', eaFixture(), INGEST);
  const queued = await post(first.base, '/api/commands', {action: 'PAUSE'}, OPERATOR);
  assert.equal(queued.status, 202); const command = await queued.json();
  await post(first.base, '/api/bridge/result', {id: command.id, status: 'CONFIRMED', message: 'TEST ONLY'}, INGEST);
  await close(first.app);
  const second = await open(), next = await post(second.base, '/api/commands', {action: 'RESUME'}, OPERATOR);
  assert.equal(next.status, 202); assert.ok((await next.json()).id > command.id);
  const account = await (await fetch(second.base + '/api/account', {headers: {Authorization: 'Bearer ' + OPERATOR}})).json();
  assert.equal(account.commands.find(c => c.id === command.id).status, 'CONFIRMED');
});
