// Read-only production checkpoint diagnostic. NEVER changes Postgres tables or live SQLite data.
// Run from a trusted host with AUTH_DATABASE_URL accessible, against a backed-up database.
import pg from 'pg';
const {Pool}=pg;
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const connectionString=process.env.AUTH_DATABASE_URL;
if(!connectionString)throw Error('AUTH_DATABASE_URL is not configured');
const pool=new Pool({connectionString,max:1,connectionTimeoutMillis:7000,statement_timeout:20000});
const result={readOnly:true,current:{status:'NOT_CHECKED'},previous:{status:'NOT_CHECKED'}};
const client=await pool.connect();
try{
  await client.query('BEGIN TRANSACTION READ ONLY');
  const meta=(await client.query(`SELECT octet_length(payload) AS current_bytes,
    digest IS NOT NULL AS current_digest, saved_at,
    octet_length(previous_payload) AS previous_bytes,
    previous_digest IS NOT NULL AS previous_digest, previous_saved_at
    FROM nabd_runtime_checkpoint WHERE id=1`)).rows[0];
  if(!meta){result.current.status='NO_ROW'; result.previous.status='NO_ROW';}
  else {
    for(const [name,column]of [['current','payload'],['previous','previous_payload']]){
      const bytes=Number(meta[name+'_bytes']);
      if(meta[name+'_bytes']==null){result[name]={status:'ABSENT'};continue;}
      if(!Number.isSafeInteger(bytes)||bytes>64*1024*1024){result[name]={status:'TOO_LARGE_TO_INSPECT_SAFELY',bytes};continue;}
      const {rows}=await client.query('SELECT '+(name==='current'?'payload,digest':'previous_payload AS payload,previous_digest AS digest')+' FROM nabd_runtime_checkpoint WHERE id=1');
      const item=rows[0];
      if(!Buffer.isBuffer(item?.payload)){result[name]={status:'INVALID_PAYLOAD',bytes};continue;}
      if(createHash('sha256').update(item.payload).digest('hex')!==item.digest){result[name]={status:'DIGEST_MISMATCH',bytes};continue;}
      const dir=await mkdtemp(join(tmpdir(),'nabd-checkpoint-check-'));
      try{
        const path=join(dir,'checkpoint.sqlite');
        await writeFile(path,item.payload,{mode:0o600});
        const db=new DatabaseSync(path,{readOnly:true});
        try{
          const quick=db.prepare('PRAGMA quick_check').get();
          result[name]={status:quick?.quick_check==='ok'?'VALID':'SQLITE_INTEGRITY_ERROR',bytes};
        }finally{db.close();}
      }catch{result[name]={status:'SQLITE_OPEN_OR_CHECK_FAILED',bytes};}
      finally{await rm(dir,{recursive:true,force:true});}
    }
  }
  await client.query('ROLLBACK');
}catch(error){
  try{await client.query('ROLLBACK');}catch{}
  result.error='SQL_QUERY_OR_CONNECT_FAILED';
  result.errorCode=typeof error?.code==='string'&&/^[A-Z0-9]{3,6}$/.test(error.code)?error.code:null;
}finally{client.release();await pool.end();}
console.log('NABD checkpoint health (no stored data): '+JSON.stringify(result));
if(result.error||(!['VALID','ABSENT'].includes(result.current.status)&&result.previous.status!=='VALID'))process.exitCode=1;
