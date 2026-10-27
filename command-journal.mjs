// PostgreSQL is authoritative for commands; periodic SQLite backups are not a journal.
import {websiteEntryJournal} from './website-entry.mjs';
export async function createCommandJournal(connectionString) {
  if (!connectionString) return null;
  const {default: pg} = await import('pg');
  const pool = new pg.Pool({connectionString, max: 3, connectionTimeoutMillis: 5000, statement_timeout: 5000});
  pool.on('error', () => {});
  try {
    await pool.query(`CREATE SEQUENCE IF NOT EXISTS nabd_command_id START WITH 2000000000000;
      CREATE TABLE IF NOT EXISTS nabd_command_journal (
        id bigint PRIMARY KEY DEFAULT nextval('nabd_command_id'), time double precision NOT NULL,
        expires double precision NOT NULL, action text NOT NULL, ticket text NOT NULL,
        fraction double precision NOT NULL, status text NOT NULL, result text);
      CREATE TABLE IF NOT EXISTS nabd_website_decisions (
        source_key text NOT NULL, plan_id text NOT NULL, time double precision NOT NULL,
        reason text NOT NULL, status text NOT NULL, updated_at double precision NOT NULL,
        PRIMARY KEY (source_key,plan_id));
      CREATE TABLE IF NOT EXISTS nabd_website_entries (
        id bigint PRIMARY KEY DEFAULT nextval('nabd_command_id'), source_key text NOT NULL,
        plan_id text NOT NULL, time double precision NOT NULL, expires double precision NOT NULL,
        status text NOT NULL, plan text NOT NULL, reported_at double precision,
        UNIQUE(source_key,plan_id));
      ALTER TABLE nabd_website_entries ADD COLUMN IF NOT EXISTS reason_code integer;
      ALTER TABLE nabd_website_entries ADD COLUMN IF NOT EXISTS mt5_retcode integer`);
  } catch {await pool.end(); throw Error('Could not initialize durable command journal');}
  const safe = async fn => {try {return await fn();} catch {throw Error('سجل الأوامر الدائم غير متاح؛ لم يتم تأكيد إرسال الأمر.');}};
  const expire = (client, now) => client.query("UPDATE nabd_command_journal SET status='EXPIRED' WHERE status='QUEUED' AND expires<=$1", [now]);
  const row = r => r ? {...r, id: Number(r.id)} : null;
  return {
    ...websiteEntryJournal(pool),
    list: now => safe(async () => {await expire(pool, now); return (await pool.query('SELECT * FROM nabd_command_journal ORDER BY id DESC LIMIT 100')).rows.map(row);}),
    enqueue: (now, action, ticket, fraction) => safe(async () => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        // Serialize across workers and overlapping deployments, not only this process.
        await c.query('SELECT pg_advisory_xact_lock(72623481)');
        await expire(c, now);
        if ((await c.query("SELECT id FROM nabd_command_journal WHERE status='QUEUED' LIMIT 1")).rows.length) {
          await c.query('COMMIT'); return null;
        }
        const result = await c.query("INSERT INTO nabd_command_journal(time,expires,action,ticket,fraction,status) VALUES($1,$2,$3,$4,$5,'QUEUED') RETURNING *", [now, now+20, action, ticket, fraction]);
        await c.query('COMMIT'); return row(result.rows[0]);
      } catch (e) {await c.query('ROLLBACK').catch(()=>{}); throw e;} finally {c.release();}
    }),
    next: now => safe(async () => {await expire(pool, now); return row((await pool.query("SELECT * FROM nabd_command_journal WHERE status='QUEUED' AND expires>$1 ORDER BY id LIMIT 1", [now])).rows[0]);}),
    get: id => safe(async () => row((await pool.query('SELECT * FROM nabd_command_journal WHERE id=$1', [id])).rows[0])),
    result: (id, status, message) => safe(async () => {await pool.query("UPDATE nabd_command_journal SET status=$2,result=$3 WHERE id=$1 AND status IN ('QUEUED','EXPIRED')", [id,status,message]);}),
    close: () => pool.end()
  };
}
