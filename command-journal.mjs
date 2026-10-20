// Durable command journal. Account profiles and signals remain in their existing stores.
// This journal is intentionally separate from asynchronous 30-second runtime checkpoints.
const schema = `
CREATE TABLE IF NOT EXISTS nabd_command_journal (
  id bigserial PRIMARY KEY,
  scope text NOT NULL,
  time double precision NOT NULL,
  expires double precision NOT NULL,
  action text NOT NULL,
  ticket text NOT NULL,
  fraction double precision NOT NULL,
  status text NOT NULL,
  result text
);
CREATE INDEX IF NOT EXISTS nabd_command_journal_scope_id
  ON nabd_command_journal(scope,id DESC);
`;
const safeError = () => Object.assign(new Error('سجل أوامر التداول الدائم غير متاح مؤقتًا؛ لن يُرسل أي أمر.'), {status:503});

export async function createDurableCommandJournal({connectionString, suppliedPool} = {}) {
  if (!connectionString && !suppliedPool) return null;
  const pg = suppliedPool ? null : (await import('pg')).default;
  const pool = suppliedPool || new pg.Pool({connectionString, max:2, connectionTimeoutMillis:7000,
    statement_timeout:10000, idleTimeoutMillis:30000});
  let ready = false;
  const query = async (sql, args=[]) => {
    try {const result=await pool.query(sql,args);ready=true;return result;}
    catch {ready=false;throw safeError();}
  };
  try {
    await query(schema);
    // Verify we can write, not merely read. Never enable command controls on read-only storage.
    await query('SELECT id FROM nabd_command_journal LIMIT 1');
  } catch (error) {
    if (!suppliedPool) await pool.end().catch(()=>{});
    throw error;
  }
  pool.on?.('error',()=>{ready=false;});
  const transaction = async run => {
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      // Cross-worker coordination: two concurrent requests must never queue two controls.
      await client.query('SELECT pg_advisory_xact_lock(7812026, 1)');
      const result = await run(client);
      await client.query('COMMIT');
      ready=true;
      return result;
    } catch {
      ready=false;
      if (client) await client.query('ROLLBACK').catch(()=>{});
      throw safeError();
    } finally {client?.release();}
  };
  const expire = (c,scope,at) => c.query(
    "UPDATE nabd_command_journal SET status='EXPIRED' WHERE scope=$1 AND status='QUEUED' AND expires<$2",[scope,at]);

  return {
    status:()=>({ready,mode:'postgres'}),
    async listRecent(scope) {
      if (!scope) return [];
      return (await query('SELECT id,time,expires,action,ticket,fraction,status,result FROM nabd_command_journal WHERE scope=$1 ORDER BY id DESC LIMIT 100',[scope])).rows.map(r=>({...r,id:Number(r.id)}));
    },
    async enqueue(scope,{action,ticket,fraction},at) {
      if (!scope) throw safeError();
      return transaction(async c=>{
        await expire(c,scope,at);
        const pending=await c.query("SELECT id FROM nabd_command_journal WHERE scope=$1 AND status='QUEUED' AND expires>=$2 LIMIT 1",[scope,at]);
        if (pending.rows.length) return null;
        const added=await c.query(`INSERT INTO nabd_command_journal(scope,time,expires,action,ticket,fraction,status)
          VALUES($1,$2,$3,$4,$5,$6,'QUEUED') RETURNING id`,[scope,at,at+20,action,ticket,fraction]);
        return Number(added.rows[0].id);
      });
    },
    async next(scope,at) {
      if (!scope) return null;
      return transaction(async c=>{
        await expire(c,scope,at);
        const found=await c.query("SELECT id,time,expires,action,ticket,fraction FROM nabd_command_journal WHERE scope=$1 AND status='QUEUED' ORDER BY id ASC LIMIT 1",[scope]);
        return found.rows[0]||null;
      });
    },
    async finish(scope,id,status,result) {
      if (!scope || !Number.isSafeInteger(Number(id)) || Number(id)<=0) return null;
      return transaction(async c=>{
        const found=await c.query('SELECT status FROM nabd_command_journal WHERE id=$1 AND scope=$2 FOR UPDATE',[id,scope]);
        if (!found.rows.length) return null;
        const previous=found.rows[0].status;
        if (!['QUEUED','EXPIRED'].includes(previous)) return {status:previous,changed:false};
        if (!['CONFIRMED','REJECTED','UNCERTAIN'].includes(status)) return {invalid:true};
        await c.query('UPDATE nabd_command_journal SET status=$1,result=$2 WHERE id=$3 AND scope=$4',[status,result,id,scope]);
        return {status,changed:true};
      });
    },
    async close(){if(!suppliedPool)await pool.end();}
  };
}
