/* NABD phase 8 PostgreSQL analysis archive.
   Sanitized observations only: no account, signal ID, entry price or order/deal data.
   In the event of an outage, SQLite remains the read-only fallback. */
import {createHash} from 'node:crypto';
import {HISTORY_SYMBOLS,HISTORY_STATUSES} from './analysis-history.mjs';
const validSymbols=new Set(HISTORY_SYMBOLS),validStatuses=new Set(HISTORY_STATUSES);
const RETENTION_DAYS=90,MAX_ROWS=12000;
export const analysisArchiveKey=row=>createHash('sha256').update(JSON.stringify([
 row.recorded_at,row.symbol,row.status,row.source_type,row.reason,row.frames,row.indicator_checks,
 row.readiness_checks,row.entry_checks,row.score,row.strategy])).digest('hex');
export async function createPgAnalysisArchive({connectionString,pool:externalPool}={}){
 if(!connectionString&&!externalPool)return null;
 let pool=externalPool,owned=false;
 if(!pool){
  const pg=(await import('pg')).default;
  pool=new pg.Pool({connectionString,max:2,connectionTimeoutMillis:6000,statement_timeout:12000,idleTimeoutMillis:30000});
  owned=true;pool.on('error',()=>{});
 }
 try{
  await pool.query("CREATE TABLE IF NOT EXISTS nabd_analysis_observations ("+
   "id BIGSERIAL PRIMARY KEY, recorded_at BIGINT NOT NULL,symbol TEXT NOT NULL,"+
   "status TEXT NOT NULL,unique_key TEXT NOT NULL UNIQUE,data JSONB NOT NULL);"+
   "CREATE INDEX IF NOT EXISTS nabd_analysis_observations_symbol_time ON nabd_analysis_observations(symbol,recorded_at DESC,id DESC);");
 }catch{
  if(owned)await pool.end().catch(()=>{});
  return null;
 }
 let state='READY',pending=Promise.resolve(),waiting=0,inserted=0;
 const insertSql='INSERT INTO nabd_analysis_observations(recorded_at,symbol,status,unique_key,data) VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT(unique_key) DO NOTHING';
 const validRow=row=>row&&validSymbols.has(row.symbol)&&validStatuses.has(row.status)&&
   Number.isSafeInteger(row.recorded_at)&&row.recorded_at>0&&row.kind==='ANALYSIS_OBSERVATION';
 function enqueue(row){
  if(!validRow(row)||waiting>=500){if(waiting>=500)state='DEGRADED';return;}
  waiting++;
  const args=[row.recorded_at,row.symbol,row.status,analysisArchiveKey(row),JSON.stringify(row)];
  pending=pending.then(()=>pool.query(insertSql,args).then(()=>{state='READY';inserted++;})
   .catch(()=>{state='ERROR';})).finally(()=>waiting--);
 }
 async function flush(){await pending;}
 async function prune(){
  await flush();
  await pool.query('DELETE FROM nabd_analysis_observations WHERE recorded_at<$1',[Math.floor(Date.now()/1000-RETENTION_DAYS*86400)]);
  await pool.query('DELETE FROM nabd_analysis_observations WHERE id IN (SELECT id FROM nabd_analysis_observations ORDER BY id DESC OFFSET $1)',[MAX_ROWS]);
 }
 async function bootstrapFromSqlite(sqlite){
  if(!sqlite)return;
  try{
  const rows=sqlite.prepare('SELECT data FROM analysis_history ORDER BY id ASC LIMIT ?').all(MAX_ROWS);
  for(let i=0;i<rows.length;i+=100){
   const batch=[];
   for(const {data} of rows.slice(i,i+100)){
    let row;
    try{row=JSON.parse(data);}catch{continue;}
    if(validRow(row))batch.push({recorded_at:row.recorded_at,symbol:row.symbol,status:row.status,
     unique_key:analysisArchiveKey(row),data:row});
   }
   if(!batch.length)continue;
   await pool.query("INSERT INTO nabd_analysis_observations(recorded_at,symbol,status,unique_key,data) "+
    "SELECT (x->>'recorded_at')::BIGINT,x->>'symbol',x->>'status',x->>'unique_key',x->'data' "+
    "FROM jsonb_array_elements($1::jsonb) x ON CONFLICT(unique_key) DO NOTHING",[JSON.stringify(batch)]);
  }
  await prune();state='READY';
  }catch(e){state='ERROR';throw e;}
 }
 async function list({symbol='ALL',status='ALL',since=null,before=null,limit=40,query=''}={}){
  if(symbol!=='ALL'&&!validSymbols.has(symbol))throw new RangeError('Invalid symbol');
  if(status!=='ALL'&&!validStatuses.has(status))throw new RangeError('Invalid status');
  if(since!=null&&(!Number.isSafeInteger(since)||since<0))throw new RangeError('Invalid since');
  if(before!=null&&(!Number.isSafeInteger(before)||before<=0))throw new RangeError('Invalid cursor');
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new RangeError('Invalid limit');
  if(typeof query!=='string'||query.length>80)throw new RangeError('Invalid search');
  await flush();
  if(state==='ERROR')throw new Error('Postgres archive unavailable');
  const where=[],args=[],add=(sql,val)=>{args.push(val);where.push(sql.replace('?', '$'+args.length));};
  if(symbol!=='ALL')add('symbol=?',symbol);
  if(status!=='ALL')add('status=?',status);
  if(since!=null)add('recorded_at>=?',since);
  if(before!=null)add('id<?',before);
  if(query.trim()){
   const keyword='%'+query.trim().replace(/[%_\\]/g,'\\$&')+'%';
   args.push(keyword);
   where.push("(COALESCE(data->>'reason','') ILIKE $"+args.length+" ESCAPE '\\' OR COALESCE(data->>'strategy','') ILIKE $"+args.length+" ESCAPE '\\')");
  }
  args.push(limit+1);
  const sql='SELECT id,recorded_at,data FROM nabd_analysis_observations'+(where.length?' WHERE '+where.join(' AND '):'')+
   ' ORDER BY id DESC LIMIT $'+args.length;
  const result=await pool.query(sql,args),hasMore=result.rows.length>limit;
  const items=result.rows.slice(0,limit).map(row=>({id:Number(row.id),...(typeof row.data==='string'?JSON.parse(row.data):row.data)}));
  const first=(await pool.query('SELECT MIN(recorded_at) AS first FROM nabd_analysis_observations')).rows[0]?.first;
  state='READY';
  return {items,next_cursor:hasMore?items.at(-1)?.id:null,
   first_recorded_at:first==null?null:Number(first),retention_days:RETENTION_DAYS,
   storage_persistent:true,kind:'ANALYSIS_OBSERVATIONS_NOT_TRADES',scope:'GLOBAL_MARKET',backfilled:false};
 }
 return {enqueue,flush,bootstrapFromSqlite,list,prune,status:()=>({state,pending:waiting}),
  async close(){await flush();if(owned)await pool.end();}};
}
