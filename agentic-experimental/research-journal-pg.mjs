// Disabled-by-default isolated Postgres journal adapter.
import {readFile} from 'node:fs/promises';
// Requires explicit isolated DATABASE URL, 'pg' package at runtime and schema migration.
// No automatic connection to any production database.
export const ISOLATED_DB_NAME='nabd_agentic_research_test';
export function assertIsolatedDatabase(name){
 if(name!==ISOLATED_DB_NAME)throw Error('WRONG_DATABASE_FAIL_CLOSED');
}
export function createResearchJournal({query}={}){
 if(typeof query!=='function')throw Error('JOURNAL_QUERY_REQUIRED');
 let verified=false;
 async function verify(){
  const result=await query('SELECT current_database() AS database_name',[]);
  assertIsolatedDatabase(result?.rows?.[0]?.database_name);
  verified=true;
  return {connected:true,database:ISOLATED_DB_NAME};
 }
 function ensure(){if(!verified)throw Error('JOURNAL_NOT_VERIFIED');}
 async function saveForecast({provider,id,scheduledAt,observedAt,raw,unit=null,numeric=null}){
  ensure();
  if(!provider||!id||!raw||!Number.isSafeInteger(scheduledAt)||
     !Number.isSafeInteger(observedAt)||observedAt>=scheduledAt)
     throw Error('INVALID_PRE_RELEASE_FORECAST');
  const result=await query(
   'INSERT INTO agentic_research.forecast_snapshots (event_provider,provider_event_id,scheduled_at,first_observed_at,forecast_raw,forecast_numeric,forecast_unit) VALUES ($1,$2,to_timestamp($3),to_timestamp($4),$5,$6,$7) ON CONFLICT DO NOTHING RETURNING forecast_raw',
   [provider,id,scheduledAt,observedAt,raw,numeric,unit]);
  return {inserted:result?.rowCount===1};
 }
 async function firstForecast({provider,id,scheduledAt}){
  ensure();
  const result=await query(
   'SELECT forecast_raw, EXTRACT(EPOCH FROM first_observed_at)::bigint AS observed_at FROM agentic_research.forecast_snapshots WHERE event_provider=$1 AND provider_event_id=$2 AND scheduled_at=to_timestamp($3)',
   [provider,id,scheduledAt]);
  const row=result?.rows?.[0];return row?{raw:row.forecast_raw,observedAt:Number(row.observed_at)}:null;
 }
 async function saveActual({provider,id,scheduledAt,observedAt,raw,unit=null,numeric=null}){
  ensure();
  if(!provider||!id||!raw||!Number.isSafeInteger(scheduledAt)||
     !Number.isSafeInteger(observedAt)||observedAt<scheduledAt)
    throw Error('INVALID_ACTUAL_OBSERVATION');
  const result=await query(
   'INSERT INTO agentic_research.actual_observations (event_provider,provider_event_id,scheduled_at,first_observed_at,actual_raw,actual_numeric,actual_unit,provenance) VALUES ($1,$2,to_timestamp($3),to_timestamp($4),$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING actual_raw',
   [provider,id,scheduledAt,observedAt,raw,numeric,unit,'VENDOR_FIRST_OBSERVED_NOT_OFFICIAL_RELEASE']);
  return {inserted:result?.rowCount===1};
 }
 return {verify,saveForecast,firstForecast,saveActual,status:()=>({verified,database:verified?ISOLATED_DB_NAME:null,
   writesAllowed:verified,persistenceConnected:verified})};
}
export async function connectResearchJournal({url=process.env.NABD_TEST_RESEARCH_DATABASE_URL}={}){
 if(!url)return {status:'NOT_CONFIGURED',journal:null};
 let parsed;try{parsed=new URL(url);}catch{return {status:'INVALID_DATABASE_URL',journal:null};}
 if(!['postgresql:','postgres:'].includes(parsed.protocol)||!parsed.hostname)
  return {status:'INVALID_DATABASE_URL',journal:null};
 try{
  const {default:pg}=await import('pg');
  const pool=new pg.Pool({connectionString:url,max:2,connectionTimeoutMillis:5000,
    idleTimeoutMillis:10000,ssl:undefined});
  const journal=createResearchJournal({query:(sql,args)=>pool.query(sql,args)});
  try{
   await journal.verify(); // Critical: verify exact test DB name before ANY DDL.
   const migration=await readFile(new URL('./sql/001_research_journal.sql',import.meta.url),'utf8');
   const migrationClient=await pool.connect();
   try{await migrationClient.query(migration);}finally{migrationClient.release();}
   await pool.query('SELECT 1 FROM agentic_research.forecast_snapshots LIMIT 0');
   return {status:'CONNECTED',journal,close:()=>pool.end()};
  }
  catch(e){await pool.end();return {status:String(e.message).slice(0,80),journal:null};}
 }catch(e){return {status:e?.code==='ERR_MODULE_NOT_FOUND'?'PG_DRIVER_UNAVAILABLE':'DATABASE_CONNECTION_FAILED',journal:null};}
}
