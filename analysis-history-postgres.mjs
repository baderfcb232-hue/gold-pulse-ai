/* Independent, read-only PostgreSQL market analysis archive. Never blocks MT5.
   SQLite remains a recovery input; PostgreSQL is the history read source when connected. */
import {createHash} from 'node:crypto';
import {captureAnalysisSnapshot,analysisHistoryCsv} from './analysis-history.mjs';
const symbols=new Set(['XAUUSD','BTCUSD']);
const statuses=new Set(['NO_DATA','WARMING','SCANNING','WATCH','READY','NEWS_BLOCK','BLOCKED','STALE','GAP','ERROR','UNKNOWN']);
const digest=row=>createHash('sha256').update(JSON.stringify(row)).digest('hex');
const valid=row=>row&&row.kind==='ANALYSIS_OBSERVATION'&&row.scope==='GLOBAL_MARKET'&&
 symbols.has(row.symbol)&&statuses.has(row.status)&&Number.isSafeInteger(row.recorded_at);
const decode=r=>({id:Number(r.id),...(typeof r.data==='string'?JSON.parse(r.data):r.data)});
export function validateHistoryFilters({symbol='ALL',status='ALL',since=null,before=null,limit=40,query=''}={}){
 if(symbol!=='ALL'&&!symbols.has(symbol))throw new RangeError('Invalid symbol');
 if(status!=='ALL'&&!statuses.has(status))throw new RangeError('Invalid status');
 if(since!==null&&(!Number.isSafeInteger(since)||since<0))throw new RangeError('Invalid since');
 if(before!==null&&(!Number.isSafeInteger(before)||before<1))throw new RangeError('Invalid cursor');
 if(!Number.isInteger(limit)||limit<1||limit>100)throw new RangeError('Invalid page size');
 if(typeof query!=='string'||query.length>100||/[\u0000-\u001f\u007f]/.test(query))throw new RangeError('Invalid search');
 return {symbol,status,since,before,limit,query:query.trim()};
}
export async function createPostgresAnalysisArchive({connectionString,pool:givenPool,clock=()=>Date.now()/1000}={}){
 if(!connectionString&&!givenPool)return null;
 const owns=!givenPool;
 const pool=givenPool||new (await import('pg')).default.Pool({
  connectionString,max:2,connectionTimeoutMillis:5000,statement_timeout:10000,idleTimeoutMillis:30000});
 pool.on?.('error',()=>{});
 let healthy=false,closed=false,syncing=false,sqlite=null,offset=0,timer=null,lastSync=null,lastError=null;
 const queue=[],queued=new Set(),latest=new Map();
 const query=async(sql,args=[])=>{
  const res=await pool.query(sql,args);
  healthy=true;lastError=null;
  return res;
 };
 try{
  await query([
   'CREATE TABLE IF NOT EXISTS nabd_analysis_observations (',
   ' id BIGSERIAL PRIMARY KEY, observation_key TEXT NOT NULL UNIQUE,',
   ' recorded_at BIGINT NOT NULL, symbol TEXT NOT NULL, status TEXT NOT NULL, data JSONB NOT NULL);',
   'CREATE INDEX IF NOT EXISTS idx_nabd_analysis_observations_time ON nabd_analysis_observations(recorded_at DESC,id DESC);',
   'CREATE INDEX IF NOT EXISTS idx_nabd_analysis_observations_symbol ON nabd_analysis_observations(symbol,recorded_at DESC,id DESC);'
  ].join(' '));
  const prev=await query('SELECT DISTINCT ON (symbol) symbol,recorded_at,data FROM nabd_analysis_observations ORDER BY symbol,recorded_at DESC,id DESC');
  for(const x of prev.rows){
   const row=typeof x.data==='string'?JSON.parse(x.data):x.data;
   latest.set(x.symbol,{at:Number(x.recorded_at),mark:JSON.stringify([row.status,row.reason,row.score,row.frames,row.entry_checks,row.recommendation_code])});
  }
 }catch(e){if(owns)await pool.end();throw new Error('POSTGRES_ANALYSIS_ARCHIVE_INIT_FAILED',{cause:e});}
 function observe(state){
  const at=Math.floor(clock());
  for(const symbol of symbols){
   const row=captureAnalysisSnapshot(state?.markets?.[symbol],at);
   if(!valid(row))continue;
   const mark=JSON.stringify([row.status,row.reason,row.score,row.frames,row.entry_checks,row.recommendation_code]);
   const prior=latest.get(symbol);
   if(prior&&at-prior.at<15)continue;
   if(prior&&prior.mark===mark&&at-prior.at<1800)continue;
   const key=digest(row);
   if(queued.has(key))continue;
   queue.push(row);queued.add(key);
   latest.set(symbol,{at,mark});
   if(queue.length>1500){const removed=queue.shift();queued.delete(digest(removed));}
  }
  if(!syncing)void flush();
 }
 async function write(rows){
  const args=[],parts=[];
  for(const row of rows.filter(valid)){
   const i=args.length;
   args.push(digest(row),row.recorded_at,row.symbol,row.status,JSON.stringify(row));
   parts.push('($'+(i+1)+',$'+(i+2)+',$'+(i+3)+',$'+(i+4)+',$'+(i+5)+'::jsonb)');
  }
  if(parts.length)await query('INSERT INTO nabd_analysis_observations (observation_key,recorded_at,symbol,status,data) VALUES '+
   parts.join(',')+' ON CONFLICT (observation_key) DO NOTHING',args);
 }
 async function flush(){
  if(syncing||closed)return;
  syncing=true;
  try{
   // Import old sanitized SQLite observations in bounded batches without delaying orders.
   if(sqlite){
    const batch=sqlite.prepare('SELECT data FROM analysis_history ORDER BY id LIMIT 100 OFFSET ?').all(offset);
    if(batch.length){
     const parsed=batch.map(r=>{try{return JSON.parse(r.data);}catch{return null;}}).filter(valid);
     await write(parsed);offset+=batch.length;
    }else sqlite=null;
   }
   if(queue.length){
    const batch=queue.slice(0,80);
    await write(batch);
    queue.splice(0,batch.length);
    for(const row of batch)queued.delete(digest(row));
   }
   lastSync=clock();
  }catch{
   healthy=false;lastError='POSTGRES_ARCHIVE_SYNC_UNAVAILABLE';
  }finally{syncing=false;}
 }
 function start(sqliteDb){
  sqlite=sqliteDb||null;void flush();
  timer=setInterval(()=>void flush(),5000);
  timer.unref?.();
 }
 async function list(filters={}){
  const f=validateHistoryFilters(filters),args=[],parts=['1=1'];
  const add=(expr,value)=>{args.push(value);parts.push(expr.replace('?', '$'+args.length));};
  if(f.symbol!=='ALL')add('symbol=?',f.symbol);
  if(f.status!=='ALL')add('status=?',f.status);
  if(f.since!==null)add('recorded_at>=?',f.since);
  if(f.query)add('POSITION(LOWER(?) IN LOWER(data::text))>0',f.query);
  if(f.before!==null){
   args.push(f.before);
   parts.push('(recorded_at,id) < (SELECT recorded_at,id FROM nabd_analysis_observations WHERE id=$'+args.length+')');
  }
  args.push(f.limit+1);
  const result=await query('SELECT id,data FROM nabd_analysis_observations WHERE '+parts.join(' AND ')+
   ' ORDER BY recorded_at DESC,id DESC LIMIT $'+args.length,args);
  const more=result.rows.length>f.limit,items=result.rows.slice(0,f.limit).map(decode);
  const earliest=await query('SELECT MIN(recorded_at) AS first FROM nabd_analysis_observations');
  return {items,next_cursor:more?items.at(-1).id:null,
   first_recorded_at:earliest.rows[0]?.first==null?null:Number(earliest.rows[0].first),
   retention_days:90,storage_persistent:true,storage_backend:'postgres',
   last_synced_at:lastSync,kind:'ANALYSIS_OBSERVATIONS_NOT_TRADES',
   scope:'GLOBAL_MARKET',backfilled:false};
 }
 async function exportCsv(filters={}){
  const rows=[];let before=null;
  do{
   const result=await list({...filters,before,limit:100});
   rows.push(...result.items);before=result.next_cursor;
  }while(before&&rows.length<1000);
  return analysisHistoryCsv(rows.slice(0,1000));
 }
 async function get(id){
  if(!Number.isSafeInteger(id)||id<1)throw new RangeError('Invalid history id');
  const res=await query('SELECT id,data FROM nabd_analysis_observations WHERE id=$1',[id]);
  return res.rows[0]?decode(res.rows[0]):null;
 }
 async function close(){
  closed=true;clearInterval(timer);
  while(syncing)await new Promise(resolve=>setTimeout(resolve,10));
  if(owns)await pool.end();
 }
 return {start,observe,flush,list,exportCsv,get,close,
  status:()=>({ready:healthy,backend:'postgres',last_synced_at:lastSync,last_error:lastError})};
}
