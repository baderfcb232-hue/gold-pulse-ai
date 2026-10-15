import {DatabaseSync} from 'node:sqlite';

const schema = `
CREATE TABLE IF NOT EXISTS nabd_users (
 id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled','deletion_requested')),
 verified_at DOUBLE PRECISION, created_at DOUBLE PRECISION NOT NULL, last_login DOUBLE PRECISION,
 notifications INTEGER NOT NULL DEFAULT 1, recommendations INTEGER NOT NULL DEFAULT 1,
 totp_secret TEXT, totp_pending TEXT, pending_until DOUBLE PRECISION,
 totp_last_step BIGINT NOT NULL DEFAULT -1
);
CREATE TABLE IF NOT EXISTS nabd_sessions (
 hash TEXT PRIMARY KEY, id TEXT UNIQUE NOT NULL, user_id TEXT NOT NULL REFERENCES nabd_users(id) ON DELETE CASCADE,
 created_at DOUBLE PRECISION NOT NULL, expires_at DOUBLE PRECISION NOT NULL,
 seen_at DOUBLE PRECISION NOT NULL, agent TEXT NOT NULL, mfa INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS nabd_session_user ON nabd_sessions(user_id);
CREATE TABLE IF NOT EXISTS nabd_tokens (
 hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES nabd_users(id) ON DELETE CASCADE,
 purpose TEXT NOT NULL, expires_at DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS nabd_token_user ON nabd_tokens(user_id);
CREATE TABLE IF NOT EXISTS nabd_auth_audit (
 id TEXT PRIMARY KEY, time DOUBLE PRECISION NOT NULL, actor TEXT, event TEXT NOT NULL, subject TEXT
);
CREATE TABLE IF NOT EXISTS nabd_auth_limits (
 key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at DOUBLE PRECISION NOT NULL
);
CREATE TABLE IF NOT EXISTS nabd_auth_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

// The in-memory adapter is deliberately limited to injected tests/development.
// Production identities never fall back to the Render service's temporary disk.
export function sqliteAuthStore(database = new DatabaseSync(':memory:')) {
  database.exec('PRAGMA foreign_keys=ON;');
  const rawQuery = async (sql, values = []) => ({rows: database.prepare(sql).all(...values)});
  let queue = Promise.resolve();
  const query = (sql, values = []) => queue.then(() => rawQuery(sql, values));
  return {kind: 'test-memory', initialize: async () => database.exec(schema), query,
    async transaction(run) {
      const previous = queue; let release; queue = new Promise(done => {release = done;}); await previous;
      database.exec('BEGIN IMMEDIATE');
      try {const value = await run(rawQuery); database.exec('COMMIT'); return value;}
      catch (error) {database.exec('ROLLBACK'); throw error;}
      finally {release();}
    }, close: async () => database.close()};
}

export async function postgresAuthStore(connectionString) {
  const {Pool} = await import('pg');
  const pool = new Pool({connectionString, max: 4, connectionTimeoutMillis: 7000,
    idleTimeoutMillis: 30000, statement_timeout: 10000});
  // Pool background errors must not crash the trading monitor or expose credentials.
  pool.on('error', () => console.warn('NABD accounts database connection unavailable'));
  const sql = value => {let index = 0; return value.replace(/\?/g, () => '$' + ++index);};
  const query = (text, values = []) => pool.query(sql(text), values);
  return {kind: 'postgres', async initialize() {
    const client = await pool.connect();
    try {await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(728104201)'); await client.query(schema); await client.query('COMMIT');}
    catch (error) {await client.query('ROLLBACK'); throw error;} finally {client.release();}
  }, query,
    async transaction(run) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Serialize identity mutations across application instances (not market data).
        await client.query('SELECT pg_advisory_xact_lock(728104201)');
        const value = await run((text, values = []) => client.query(sql(text), values));
        await client.query('COMMIT'); return value;
      } catch (error) {await client.query('ROLLBACK'); throw error;}
      finally {client.release();}
    }, close: () => pool.end()};
}
