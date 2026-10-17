import {backup, DatabaseSync} from 'node:sqlite';
import {mkdir, readFile, writeFile, rename, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID, createHash} from 'node:crypto';

// Recovery checkpoints are separate from the durable command journal requirement.
export async function createRuntimeBackup({connectionString, dataDir, pool: suppliedPool} = {}) {
  const status = {state: connectionString || suppliedPool ? 'STARTING' : 'NOT_CONFIGURED', lastSavedAt: null,
    intervalSeconds: 30, recoverySource: null, maxCopies: 2, error: null};
  if (!connectionString && !suppliedPool) return {status: () => ({...status}), start() {}, async close() {}};
  const pg = suppliedPool ? null : (await import('pg')).default;
  const pool = suppliedPool || new pg.Pool({connectionString, max: 1, connectionTimeoutMillis: 7000,
    statement_timeout: 15000, idleTimeoutMillis: 30000});
  pool.on?.('error', () => {status.state = 'ERROR'; status.error = 'DATABASE_UNAVAILABLE';});
  const generation = randomUUID(), target = resolve(dataDir, 'nabd.sqlite');
  let timer, pending = Promise.resolve(), db, stopped = false, preservePrevious = false;
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
      ON CONFLICT(id) DO UPDATE SET generation=EXCLUDED.generation RETURNING payload,digest,saved_at,previous_payload,previous_digest,previous_saved_at`, [generation]);
    const row = result.rows[0];
    if (row?.payload || row?.previous_payload) {
      const candidates = [{payload: row.payload, digest: row.digest, saved_at: row.saved_at, source: 'CURRENT'},
        {payload: row.previous_payload, digest: row.previous_digest, saved_at: row.previous_saved_at, source: 'PREVIOUS'}];
      let restored = false;
      for (const candidate of candidates) {
        if (!candidate.payload) continue;
        const temporary = target + '.restore';
        try {
          if (createHash('sha256').update(candidate.payload).digest('hex') !== candidate.digest) throw Error('CHECKPOINT_INTEGRITY');
          await writeFile(temporary, candidate.payload, {mode: 0o600});
          const check = new DatabaseSync(temporary);
          try {if (check.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw Error('CHECKPOINT_INTEGRITY');}
          finally {check.close();}
        } catch {await rm(temporary, {force: true}); continue;}
        await rm(target + '-wal', {force: true}); await rm(target + '-shm', {force: true});
        await rename(temporary, target);
        status.lastSavedAt = new Date(candidate.saved_at).getTime() / 1000;
        status.recoverySource = candidate.source;
        preservePrevious = candidate.source === 'PREVIOUS';
        restored = true; break;
      }
      if (!restored) throw Error('CHECKPOINT_INTEGRITY');
    }
    status.state = row?.payload || row?.previous_payload ? 'RESTORED' : 'PENDING';
  } catch {
    // Never silently start an empty history when recovery was expected.
    await pool.end(); throw Error('Runtime history recovery failed; refusing to overwrite the saved checkpoint.');
  }
  const save = async () => {
    const temporary = resolve(dataDir, `checkpoint-${generation}.sqlite`);
    try {
      await backup(db, temporary);
      const check = new DatabaseSync(temporary);
      try {if (check.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw Error('CHECKPOINT_INTEGRITY');}
      finally {check.close();}
      const bytes = await readFile(temporary);
      const result = await pool.query(`UPDATE nabd_runtime_checkpoint SET
        previous_payload=CASE WHEN $4::boolean THEN previous_payload ELSE payload END,
        previous_digest=CASE WHEN $4::boolean THEN previous_digest ELSE digest END,
        previous_saved_at=CASE WHEN $4::boolean THEN previous_saved_at ELSE saved_at END,
        payload=$1,digest=$2,saved_at=now()
        WHERE id=1 AND generation=$3 RETURNING saved_at`, [bytes, createHash('sha256').update(bytes).digest('hex'), generation, preservePrevious]);
      if (!result.rows.length) {status.state = 'SUPERSEDED'; clearInterval(timer); return;}
      status.lastSavedAt = new Date(result.rows[0].saved_at).getTime() / 1000;
      preservePrevious = false;
      status.state = 'SAVED'; status.error = null;
    } catch {status.state = 'ERROR'; status.error = 'CHECKPOINT_FAILED';}
    finally {await rm(temporary, {force: true}).catch(() => {});}
  };
  return {status: () => ({...status}), start(database) {
    db = database;
    const queue = () => {pending = pending.then(save); return pending;};
    queue(); timer = setInterval(queue, 30000); timer.unref();
  }, async close() {
    if (stopped) return; stopped = true; clearInterval(timer); await pending;
    if (db && status.state !== 'SUPERSEDED') await save();
    await pool.end();
  }};
}
