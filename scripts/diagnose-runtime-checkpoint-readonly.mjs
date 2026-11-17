// Reads one consistent PostgreSQL snapshot; SQLite checks touch only private temporary copies.
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

export async function diagnoseCheckpoint(pool) {
  const result = {readOnly: true, current: {status: 'NOT_CHECKED'}, previous: {status: 'NOT_CHECKED'}, recoverable: false};
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const meta = (await client.query(`SELECT octet_length(payload) AS current_bytes, saved_at,
      octet_length(previous_payload) AS previous_bytes, previous_saved_at
      FROM nabd_runtime_checkpoint WHERE id=1`)).rows[0];
    if (!meta) {
      result.current.status = result.previous.status = 'NO_ROW';
    } else {
      for (const [name, column, digest, timestamp] of [
        ['current', 'payload', 'digest', 'saved_at'],
        ['previous', 'previous_payload', 'previous_digest', 'previous_saved_at']
      ]) {
        if (meta[name + '_bytes'] == null) {result[name] = {status: 'ABSENT'}; continue;}
        const bytes = Number(meta[name + '_bytes']);
        result[name] = {status: 'NOT_CHECKED', bytes, savedAt: meta[timestamp]};
        if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 64 * 1024 * 1024) {
          result[name].status = 'TOO_LARGE_TO_INSPECT_SAFELY'; continue;
        }
        const item = (await client.query(`SELECT ${column} AS payload, ${digest} AS digest
          FROM nabd_runtime_checkpoint WHERE id=1 AND octet_length(${column}) <= 67108864`)).rows[0];
        if (!Buffer.isBuffer(item?.payload) || item.payload.length !== bytes) {
          result[name].status = 'INVALID_PAYLOAD'; continue;
        }
        if (createHash('sha256').update(item.payload).digest('hex') !== item.digest) {
          result[name].status = 'DIGEST_MISMATCH'; continue;
        }
        const dir = await mkdtemp(join(tmpdir(), 'nabd-checkpoint-check-'));
        let db;
        try {
          const path = join(dir, 'checkpoint.sqlite');
          await writeFile(path, item.payload, {mode: 0o600});
          db = new DatabaseSync(path, {readOnly: true});
          result[name].status = 'VALID';
          for (const pragma of ['quick_check', 'integrity_check']) {
            const checks = db.prepare('PRAGMA ' + pragma).all();
            if (checks.length !== 1 || checks[0][pragma] !== 'ok') result[name].status = 'SQLITE_INTEGRITY_ERROR';
          }
        } catch {result[name].status = 'SQLITE_OPEN_OR_CHECK_FAILED';}
        finally {db?.close(); await rm(dir, {recursive: true, force: true});}
      }
    }
    await client.query('ROLLBACK');
    result.recoverable = [result.current, result.previous].some(item => item.status === 'VALID');
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => {});
    result.error = 'SQL_QUERY_OR_CONNECT_FAILED';
    result.errorCode = typeof error?.code === 'string' && /^[A-Z0-9]{3,16}$/.test(error.code) ? error.code : null;
  } finally {client?.release(); await pool.end();}
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.AUTH_DATABASE_URL) {
    console.log('NABD checkpoint health: {"error":"AUTH_DATABASE_URL_NOT_CONFIGURED","recoverable":false}');
    process.exitCode = 1;
  } else {
    const {default: pg} = await import('pg');
    const result = await diagnoseCheckpoint(new pg.Pool({connectionString: process.env.AUTH_DATABASE_URL,
      max: 1, connectionTimeoutMillis: 7000, statement_timeout: 20000}));
    console.log('NABD checkpoint health (no stored data): ' + JSON.stringify(result));
    if (result.error || !result.recoverable) process.exitCode = 1;
  }
}
