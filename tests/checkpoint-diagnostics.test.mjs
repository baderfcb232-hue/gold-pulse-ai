import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {diagnoseCheckpoint} from '../scripts/diagnose-runtime-checkpoint-readonly.mjs';
import {createRuntimeBackup} from '../runtime-backup.mjs';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'nabd-fixture-'));
  try {
    const db = new DatabaseSync(join(dir, 'source.sqlite'));
    db.exec("CREATE TABLE history(value TEXT); INSERT INTO history VALUES('PRIVATE_FIXTURE_VALUE');"); db.close();
    const payload = await readFile(join(dir, 'source.sqlite'));
    return {payload, digest: createHash('sha256').update(payload).digest('hex')};
  } finally {await rm(dir, {recursive: true, force: true});}
}
function readonlyPool(current, previous, {connectError, oversized = false} = {}) {
  const calls = []; let released = false, ended = false;
  return {calls, get released() {return released;}, get ended() {return ended;},
    async connect() {
      if (connectError) throw connectError;
      return {async query(sql) {
        calls.push(sql);
        assert.match(sql, /^(BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY|SELECT|ROLLBACK)/);
        if (sql.startsWith('SELECT octet_length')) return {rows: [{current_bytes: oversized ? 67108865 : current?.payload.length ?? null,
          previous_bytes: previous?.payload.length ?? null, saved_at: new Date(0), previous_saved_at: new Date(0)}]};
        if (sql.startsWith('SELECT')) return {rows: [sql.includes('previous_payload AS') ? previous : current]};
        return {};
      }, release() {released = true;}};
    }, async end() {ended = true;}
  };
}

test('read-only diagnostic validates both copies from a single snapshot without emitting data', async () => {
  const good = await fixture(), pool = readonlyPool(good, good);
  const result = await diagnoseCheckpoint(pool);
  assert.equal(result.current.status, 'VALID'); assert.equal(result.previous.status, 'VALID');
  assert.equal(result.recoverable, true); assert.equal(pool.released && pool.ended, true);
  assert.equal(pool.calls[0], 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(pool.calls.at(-1), 'ROLLBACK');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_FIXTURE_VALUE|payload|digest/);
});
test('absent current and corrupt previous must not report a recoverable backup', async () => {
  const bad = {payload: Buffer.from('broken'), digest: 'invalid'};
  const result = await diagnoseCheckpoint(readonlyPool(null, bad));
  assert.equal(result.current.status, 'ABSENT'); assert.equal(result.previous.status, 'DIGEST_MISMATCH');
  assert.equal(result.recoverable, false);
});
test('valid previous remains recoverable when current digest fails', async () => {
  const good = await fixture();
  const result = await diagnoseCheckpoint(readonlyPool({...good, digest: 'wrong'}, good));
  assert.equal(result.current.status, 'DIGEST_MISMATCH'); assert.equal(result.previous.status, 'VALID');
  assert.equal(result.recoverable, true);
});
test('matching digest is insufficient for a non-SQLite payload', async () => {
  const payload = Buffer.from('not a sqlite database');
  const result = await diagnoseCheckpoint(readonlyPool({payload, digest: createHash('sha256').update(payload).digest('hex')}, null));
  assert.equal(result.current.status, 'SQLITE_OPEN_OR_CHECK_FAILED'); assert.equal(result.recoverable, false);
});
test('connect failures close the pool and do not expose credentials', async () => {
  const pool = readonlyPool(null, null, {connectError: Object.assign(Error('postgres://SECRET'), {code: 'ECONNREFUSED'})});
  const result = await diagnoseCheckpoint(pool);
  assert.equal(result.errorCode, 'ECONNREFUSED'); assert.equal(result.recoverable, false);
  assert.equal(pool.ended, true); assert.doesNotMatch(JSON.stringify(result), /SECRET/);
});
test('oversized payloads are not fetched and absent copies are not considered valid', async () => {
  const pool = readonlyPool(null, null, {oversized: true});
  const result = await diagnoseCheckpoint(pool);
  assert.equal(result.current.status, 'TOO_LARGE_TO_INSPECT_SAFELY'); assert.equal(result.recoverable, false);
  assert.equal(pool.calls.filter(sql => sql.startsWith('SELECT')).length, 1);
});
test('restore uses a pinned transaction connection and rolls back before release on invalid SQLite', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nabd-fence-'));
  const calls = [], payload = Buffer.from('invalid sqlite'), digest = createHash('sha256').update(payload).digest('hex');
  const pool = {async query(sql) {assert.match(sql, /^(CREATE|ALTER)/); return {};},
    async connect() {return {async query(sql) {calls.push(sql.startsWith('INSERT') ? 'INSERT' : sql);
      return sql.startsWith('INSERT') ? {rows: [{payload, digest}]} : {};}, release() {calls.push('RELEASE');}};},
    async end() {calls.push('END');}};
  try {
    await assert.rejects(createRuntimeBackup({pool, dataDir: dir}), /recovery failed/);
    assert.deepEqual(calls, ['BEGIN', 'INSERT', 'ROLLBACK', 'RELEASE', 'END']);
  } finally {await rm(dir, {recursive: true, force: true});}
});
