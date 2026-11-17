import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createRuntimeBackup} from '../runtime-backup.mjs';

function databaseModel() {
  const row = {}, calls = [];
  let fault = null, hold = null;
  const factory = () => ({
    async query(sql, args = []) {
      calls.push({sql, args});
      if (sql.startsWith('CREATE') || sql.startsWith('ALTER')) return {rows: []};
      if (sql.startsWith('INSERT')) {
        row.generation = args[0];
        return {rows: [{has_payload: !!row.payload, has_previous_payload: !!row.previous_payload,
          digest: row.digest, saved_at: row.saved_at, previous_digest: row.previous_digest, previous_saved_at: row.previous_saved_at}]};
      }
      if (sql.startsWith('SELECT')) {
        if (args[0] !== row.generation) return {rows: []};
        return {rows: [{payload: sql.includes('SELECT previous_payload') ? row.previous_payload : row.payload}]};
      }
      if (hold) await hold;
      if (fault) throw fault;
      if (args.some(Buffer.isBuffer)) {
        if (args[2] !== row.generation) return {rows: []};
        if (!args[3]) Object.assign(row, {previous_payload: row.payload, previous_digest: row.digest, previous_saved_at: row.saved_at});
        Object.assign(row, {payload: args[0], digest: args[1], saved_at: new Date()});
      } else {
        if (args[0] !== row.generation || args[1] !== row.digest) return {rows: []};
        row.saved_at = new Date();
      }
      return {rows: [{saved_at: row.saved_at}]};
    }, async end() {}
  });
  return {row, calls, factory, setFault: e => {fault = e;}, setHold: p => {hold = p;},
    writes: () => calls.filter(c => c.args.some(Buffer.isBuffer)),
    updates: () => calls.filter(c => c.sql.startsWith('UPDATE'))};
}

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'nabd-pressure-'));
  const model = databaseModel();
  const worker = await createRuntimeBackup({pool: model.factory(), dataDir: dir});
  const db = new DatabaseSync(join(dir, 'nabd.sqlite'));
  db.exec('CREATE TABLE history(value TEXT); INSERT INTO history VALUES (\'retained\');');
  t.after(async () => {await worker.close(); db.close(); await rm(dir, {recursive: true, force: true});});
  return {dir, model, worker, db};
}

const settle = () => new Promise(resolve => setImmediate(resolve));
async function until(fn) {
  const deadline = Date.now() + 5000;
  while (!fn()) {if (Date.now() > deadline) throw Error('Test condition timed out'); await settle();}
}

test('unchanged snapshots refresh health without resending or rotating the payload', async t => {
  t.mock.timers.enable({apis: ['setInterval']});
  const {model, worker, db} = await fixture(t);
  await worker.start(db);
  assert.equal(model.writes().length, 1);
  const original = model.row.payload;
  t.mock.timers.tick(30000);
  await worker.flush();
  assert.equal(model.updates().length, 2);
  assert.equal(model.writes().length, 1);
  assert.equal(model.row.payload, original);
  assert.equal(model.row.previous_payload, undefined);
  assert.equal(worker.status().state, 'SAVED');
  db.exec("INSERT INTO history VALUES ('changed')");
  t.mock.timers.tick(30000);
  await worker.flush();
  assert.equal(model.writes().length, 2);
  assert.equal(model.row.previous_payload, original);
  await worker.close();
  assert.equal(model.writes().length, 2, 'final save of unchanged data must also avoid blob rotation');
});

test('slow writes coalesce timer ticks instead of creating a catch-up backlog', async t => {
  t.mock.timers.enable({apis: ['setInterval']});
  const {model, worker, db} = await fixture(t);
  let release;
  model.setHold(new Promise(r => {release = r;}));
  const initial = worker.start(db);
  await until(() => model.updates().length === 1);
  t.mock.timers.tick(30 * 60000);
  assert.equal(model.updates().length, 1);
  release(); model.setHold(null); await initial;
  for (let i = 0; i < 10; i++) await settle();
  assert.equal(model.updates().length, 1, 'there must be no queued timer backlog');
  db.exec("INSERT INTO history VALUES ('during-close')");
  await worker.close();
  assert.equal(model.writes().length, 2, 'shutdown still saves the latest state');
});

test('a failed save keeps recovery copies and retries the changed snapshot', async t => {
  t.mock.timers.enable({apis: ['setInterval']});
  const {model, worker, db} = await fixture(t);
  await worker.start(db);
  const original = model.row.payload;
  db.exec("INSERT INTO history VALUES ('after-outage')");
  model.setFault(Object.assign(Error('sensitive database details'), {code: 'ECONNRESET'}));
  t.mock.timers.tick(30000);
  await worker.flush();
  assert.equal(worker.status().state, 'ERROR');
  assert.equal(model.row.payload, original);
  assert.equal(worker.status().errorCode, 'ECONNRESET');
  assert.doesNotMatch(JSON.stringify(worker.status()), /sensitive/);
  assert.equal(model.updates().length, 2);
  model.setFault(null);
  await worker.close();
  assert.equal(worker.status().state, 'SAVED');
  assert.equal(worker.status().errorCode, null);
  assert.notDeepEqual(model.row.payload, original);
  assert.equal(model.row.previous_payload, original);
});

test('recovery loads the current candidate alone and falls back only after corruption', async t => {
  const {dir, model, worker, db} = await fixture(t);
  await worker.start(db);
  db.exec("INSERT INTO history VALUES ('newer')");
  await worker.close();
  const restoredDir = await mkdtemp(join(tmpdir(), 'nabd-restore-'));
  t.after(() => rm(restoredDir, {recursive: true, force: true}));
  const start = model.calls.length;
  const current = await createRuntimeBackup({pool: model.factory(), dataDir: restoredDir});
  assert.equal(current.status().recoverySource, 'CURRENT');
  const reads = model.calls.slice(start).filter(c => c.sql.startsWith('SELECT'));
  assert.equal(reads.length, 1);
  assert.match(reads[0].sql, /SELECT payload AS payload/);
  await current.close();
  model.row.digest = 'corrupted';
  const fallbackStart = model.calls.length;
  const previous = await createRuntimeBackup({pool: model.factory(), dataDir: restoredDir});
  assert.equal(previous.status().recoverySource, 'PREVIOUS');
  assert.equal(model.calls.slice(fallbackStart).filter(c => c.sql.startsWith('SELECT')).length, 2);
  await previous.close();
});

test('unchanged saves still respect a newer deployment ownership fence', async t => {
  const {model, worker, db} = await fixture(t);
  await worker.start(db);
  const original = model.row.payload;
  model.row.generation = 'new-deployment';
  await worker.close();
  assert.equal(worker.status().state, 'SUPERSEDED');
  assert.equal(model.row.payload, original);
  assert.equal(model.writes().length, 1);
});
