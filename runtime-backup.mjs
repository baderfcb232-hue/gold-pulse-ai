import {backup, DatabaseSync} from 'node:sqlite';
import {mkdir, readFile, writeFile, rename, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID, createHash} from 'node:crypto';

// Recovery checkpoints are separate from the durable command journal requirement.
export async function createRuntimeBackup({connectionString, dataDir, pool: suppliedPool} = {}) {
  const status = {state: connectionString || suppliedPool ? 'STARTING' : 'NOT_CONFIGURED', lastSavedAt: null,
    intervalSeconds: 30, recoverySource: null, maxCopies: 2, error: null, errorCode: null};
  if (!connectionString && !suppliedPool) return {status: () => ({...status}), start() {}, async close() {}};
  const pg = suppliedPool ? null : (await import('pg')).default;
  const pool = suppliedPool || new pg.Pool({connectionString, max: 1, connectionTimeoutMillis: 7000,
    statement_timeout: 15000, idleTimeoutMillis: 30000});
  pool.on?.('error', () => {status.state = 'ERROR'; status.error = 'DATABASE_UNAVAILABLE';});
  const generation = randomUUID(), target = resolve(dataDir, 'nabd.sqlite');
  let timer, pending = null, db, stopped = false, preservePrevious = false, lastDigest = null;
  const errorCode = e => /^[0-9A-Z_]{2,40}$/.test(e?.code || '') ? e.code : 'CHECKPOINT_OPERATION_FAILED';
  try {
    await mkdir(dataDir, {recursive: true, mode: 0o700});
    await pool.query(`CREATE TABLE IF NOT EXISTS nabd_runtime_checkpoint
      (id integer PRIMARY KEY CHECK(id=1), generation text NOT NULL, payload bytea, digest text, saved_at timestamptz)`);
    await pool.query(`ALTER TABLE nabd_runtime_checkpoint
      ADD COLUMN IF NOT EXISTS previous_payload bytea,
      ADD COLUMN IF NOT EXISTS previous_digest text,
      ADD COLUMN IF NOT EXISTS previous_saved_at timestamptz`);
    // A new deployment fences writes from the old process, even while both are alive.
    const result = await pool.query(`INSERT INTO nabd_runtime_checkpoint(id,generation) VALUES(1,$1)
      ON CONFLICT(id) DO UPDATE SET generation=EXCLUDED.generation
      RETURNING payload IS NOT NULL AS has_payload,digest,saved_at,
        previous_payload IS NOT NULL AS has_previous_payload,previous_digest,previous_saved_at`, [generation]);
    const row = result.rows[0];
    if (row?.has_payload || row?.has_previous_payload) {
      const candidates = [{exists: row.has_payload, column: 'payload', digest: row.digest, saved_at: row.saved_at, source: 'CURRENT'},
        {exists: row.has_previous_payload, column: 'previous_payload', digest: row.previous_digest, saved_at: row.previous_saved_at, source: 'PREVIOUS'}];
      let restored = false;
      for (const candidate of candidates) {
        if (!candidate.exists) continue;
        const temporary = target + '.restore';
        // Read only one candidate at a time. Do not materialize both SQLite
        // images (and their text-protocol representations) in one response.
        const fetched = await pool.query(`SELECT ${candidate.column} AS payload FROM nabd_runtime_checkpoint
          WHERE id=1 AND generation=$1`, [generation]);
        const payload = fetched.rows[0]?.payload;
        if (!payload) throw Object.assign(Error('Checkpoint changed during recovery'), {code: 'CHECKPOINT_SUPERSEDED'});
        try {
          if (createHash('sha256').update(payload).digest('hex') !== candidate.digest) throw Error('CHECKPOINT_INTEGRITY');
          await writeFile(temporary, payload, {mode: 0o600});
          const check = new DatabaseSync(temporary);
          try {if (check.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw Error('CHECKPOINT_INTEGRITY');}
          finally {check.close();}
        } catch {await rm(temporary, {force: true}); continue;}
        await rm(target + '-wal', {force: true}); await rm(target + '-shm', {force: true});
        await rename(temporary, target);
        status.lastSavedAt = new Date(candidate.saved_at).getTime() / 1000;
        status.recoverySource = candidate.source;
        preservePrevious = candidate.source === 'PREVIOUS';
        lastDigest = preservePrevious ? null : candidate.digest;
        restored = true; break;
      }
      if (!restored) throw Error('CHECKPOINT_INTEGRITY');
    }
    status.state = row?.has_payload || row?.has_previous_payload ? 'RESTORED' : 'PENDING';
  } catch (e) {
    // Never silently start an empty history when recovery was expected.
    await pool.end(); throw Object.assign(Error('Runtime history recovery failed; refusing to overwrite the saved checkpoint.'), {code: errorCode(e)});
  }
  const save = async () => {
    const temporary = resolve(dataDir, `checkpoint-${generation}.sqlite`);
    try {
      await backup(db, temporary);
      const check = new DatabaseSync(temporary);
      try {if (check.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw Error('CHECKPOINT_INTEGRITY');}
      finally {check.close();}
      const bytes = await readFile(temporary);
      const digest = createHash('sha256').update(bytes).digest('hex');
      // Confirm ownership and freshness without sending or rotating the blob
      // when its contents have not changed. The previous recovery copy survives.
      const result = digest === lastDigest && !preservePrevious
        ? await pool.query(`UPDATE nabd_runtime_checkpoint SET saved_at=now()
            WHERE id=1 AND generation=$1 AND digest=$2 RETURNING saved_at`, [generation, digest])
        : await pool.query(`UPDATE nabd_runtime_checkpoint SET
        previous_payload=CASE WHEN $4::boolean THEN previous_payload ELSE payload END,
        previous_digest=CASE WHEN $4::boolean THEN previous_digest ELSE digest END,
        previous_saved_at=CASE WHEN $4::boolean THEN previous_saved_at ELSE saved_at END,
        payload=$1,digest=$2,saved_at=now()
        WHERE id=1 AND generation=$3 RETURNING saved_at`, [bytes, digest, generation, preservePrevious]);
      if (!result.rows.length) {status.state = 'SUPERSEDED'; clearInterval(timer); return;}
      status.lastSavedAt = new Date(result.rows[0].saved_at).getTime() / 1000;
      preservePrevious = false;
      lastDigest = digest;
      status.state = 'SAVED'; status.error = null; status.errorCode = null;
    } catch (e) {status.state = 'ERROR'; status.error = 'CHECKPOINT_FAILED'; status.errorCode = errorCode(e);}
    finally {await rm(temporary, {force: true}).catch(() => {});}
  };
  const queue = () => {
    if (stopped || status.state === 'SUPERSEDED') return Promise.resolve();
    // A slow backup must not accumulate an unbounded chain of overdue work.
    if (!pending) pending = save().finally(() => {pending = null;});
    return pending;
  };
  return {status: () => ({...status}), async flush() {await pending;}, start(database) {
    if (db || stopped) throw Error('Runtime backup already started or closed');
    db = database;
    const initial = queue(); timer = setInterval(queue, 30000); timer.unref(); return initial;
  }, async close() {
    if (stopped) return; stopped = true; clearInterval(timer); await pending;
    if (db && status.state !== 'SUPERSEDED') await save();
    await pool.end();
  }};
}
