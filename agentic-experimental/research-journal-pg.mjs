// Disabled-by-default isolated Postgres journal adapter.
import {readFile} from 'node:fs/promises';
import {createDurableForwardStore} from './phase8-durable-forward.mjs';
// Requires explicit isolated DATABASE URL, 'pg' package at runtime and schema migration.
// No automatic connection to any production database.
export const ISOLATED_DB_NAME='nabd_agentic_research_test';
export function assertIsolatedDatabase(name){
 if(name!==ISOLATED_DB_NAME)throw Error('WRONG_DATABASE_FAIL_CLOSED');
}
export function createResearchJournal({query,clock}={}){
 if(typeof query!=='function')throw Error('JOURNAL_QUERY_REQUIRED');
 let verified=false;
 const durable=createDurableForwardStore({query,clock});
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
 async function firstActual({provider,id,scheduledAt}){
  ensure();
  const result=await query('SELECT actual_raw, EXTRACT(EPOCH FROM first_observed_at)::bigint AS observed_at FROM agentic_research.actual_observations WHERE event_provider=$1 AND provider_event_id=$2 AND scheduled_at=to_timestamp($3)',[provider,id,scheduledAt]);
  const row=result?.rows?.[0];return row?{raw:row.actual_raw,observedAt:Number(row.observed_at)}:null;
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

 async function saveAnalysis({symbol,closedBarAt,analyzedAt,trigger,status,stance=null,
  confidence=null,reasonCodes=[],plan=null}={}){
  ensure();
  if(!['XAUUSD','BTCUSD'].includes(symbol)||
     !Number.isSafeInteger(closedBarAt)||closedBarAt<=0||
     !Number.isSafeInteger(analyzedAt)||analyzedAt<closedBarAt||
     typeof trigger!=='string'||trigger.length<1||trigger.length>64||
     typeof status!=='string'||status.length<1||status.length>80||
     (stance!==null&&!['BUY_WATCH','SELL_WATCH','WAIT'].includes(stance))||
     (confidence!==null&&(!Number.isFinite(confidence)||confidence<0||confidence>1))||
     !Array.isArray(reasonCodes)||reasonCodes.length>10||
     reasonCodes.some(x=>typeof x!=='string'||x.length>100))
   throw Error('INVALID_ISOLATED_ANALYSIS');
  const summary=plan&&typeof plan==='object'?{
   thesis:typeof plan.thesis==='string'?plan.thesis.slice(0,1000):null,
   counterThesis:typeof plan.counterThesis==='string'?plan.counterThesis.slice(0,1000):null,
   evidence:Array.isArray(plan.evidence)?plan.evidence.filter(x=>typeof x==='string')
     .slice(0,8).map(x=>x.slice(0,240)):[],
   invalidation:typeof plan.invalidation==='string'?plan.invalidation.slice(0,1000):null,
   riskNotes:typeof plan.riskNotes==='string'?plan.riskNotes.slice(0,1000):null,
   timeHorizonMinutes:Number.isSafeInteger(plan.timeHorizonMinutes)?plan.timeHorizonMinutes:null
  }:{};
  const r=await query(
   'INSERT INTO agentic_research.shadow_analysis_decisions (symbol,closed_bar_at,analyzed_at,trigger,analysis_status,stance,confidence,reason_codes,plan_summary) VALUES ($1,to_timestamp($2),to_timestamp($3),$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT DO NOTHING RETURNING symbol',
   [symbol,closedBarAt,analyzedAt,trigger,status,stance,confidence,reasonCodes,JSON.stringify(summary)]);
  return {inserted:r?.rowCount===1};
 }
 async function viewDecisions(id) {
  ensure();
  const cut = id?.lastIndexOf('-') ?? -1;
  const selected = cut > 0 ? id.slice(0,cut) : null;
  const epoch = cut > 0 ? Number(id.slice(cut+1)) : 0;
  const result = await query(`
   WITH recent AS (
    (SELECT * FROM agentic_research.shadow_analysis_decisions WHERE symbol='XAUUSD' ORDER BY closed_bar_at DESC LIMIT 24)
    UNION ALL
    (SELECT * FROM agentic_research.shadow_analysis_decisions WHERE symbol='BTCUSD' ORDER BY closed_bar_at DESC LIMIT 24)
    UNION
    (SELECT * FROM agentic_research.shadow_analysis_decisions WHERE symbol=$1 AND closed_bar_at=to_timestamp($2))
   )
   SELECT d.symbol, EXTRACT(EPOCH FROM d.closed_bar_at)::bigint AS bar, d.analyzed_at, d.trigger,
    d.analysis_status, d.stance, d.confidence, d.reason_codes, d.plan_summary,
    f.ema_stance, f.agreement, f.outcome_status, f.outcome_tick_at, f.direction, f.hit
   FROM recent d LEFT JOIN agentic_research.demo_forward_evaluations f
     ON d.symbol=f.symbol AND d.closed_bar_at=f.closed_bar_at ORDER BY d.analyzed_at DESC`,[selected,epoch]);
  return result.rows;
 }
 async function saveOperationalEvent({source,stage,symbol=null,reason=null,observedAt}={}){
  ensure();
  const code=x=>typeof x==='string'&&/^[A-Z][A-Z0-9_]{1,79}$/.test(x);
  if(!['BRAIN','TRADE','ACK','SENSOR'].includes(source)||!code(stage)||
     (symbol!==null&&!['XAUUSD','BTCUSD'].includes(symbol))||
     (reason!==null&&!code(reason))||
     !Number.isSafeInteger(observedAt)||observedAt<=0)
   throw Error('INVALID_OPERATIONAL_EVENT');
  const result=await query(
   'INSERT INTO agentic_research.demo_operational_events (source,stage,symbol,reason_code,observed_at) VALUES ($1,$2,$3,$4,to_timestamp($5)) RETURNING id',
   [source,stage,symbol,reason,observedAt]);
  return {inserted:result?.rowCount===1};
 }
 async function operationalReport(){
  ensure();
  const [recent,groups]=await Promise.all([
   query('SELECT source,stage,symbol,reason_code,observed_at FROM agentic_research.demo_operational_events ORDER BY id DESC LIMIT 40',[]),
   query('SELECT source,stage,reason_code,COUNT(*)::bigint AS total FROM agentic_research.demo_operational_events GROUP BY source,stage,reason_code ORDER BY source,stage,reason_code',[])
  ]);
  const counts=(groups.rows||[]).map(x=>({source:x.source,stage:x.stage,
   reason:x.reason_code||null,total:Number(x.total)}));
  return {status:'PERSISTED_ISOLATED_AUDIT',storage:'ISOLATED_POSTGRESQL',
   total:counts.reduce((a,b)=>a+b.total,0),counts,
   recent:(recent.rows||[]).map(x=>({source:x.source,stage:x.stage,
    symbol:x.symbol||null,reason:x.reason_code||null,
    at:new Date(x.observed_at).toISOString()})),
   containsAccountIdentifiers:false,containsCredentials:false,
   containsBrokerTickets:false,canTriggerTrades:false};
 }
 return {verify,saveForecast,firstForecast,firstActual,saveActual,saveAnalysis,viewDecisions,
  saveOperationalEvent,operationalReport,
  saveForward:async x=>{ensure();return durable.save(x)},
  observeForward:async x=>{ensure();return durable.observe(x)},
  forwardReport:async()=>{ensure();return durable.report()},
  status:()=>({verified,database:verified?ISOLATED_DB_NAME:null,
   writesAllowed:verified,persistenceConnected:verified})};
}
export async function connectResearchJournal({url=process.env.NABD_TEST_RESEARCH_DATABASE_URL,clock}={}){
 if(!url)return {status:'NOT_CONFIGURED',journal:null};
 let parsed;try{parsed=new URL(url);}catch{return {status:'INVALID_DATABASE_URL',journal:null};}
 if(!['postgresql:','postgres:'].includes(parsed.protocol)||!parsed.hostname)
  return {status:'INVALID_DATABASE_URL',journal:null};
 try{
  const {default:pg}=await import('pg');
  const pool=new pg.Pool({connectionString:url,max:2,connectionTimeoutMillis:5000,
    idleTimeoutMillis:10000,ssl:undefined});
  const journal=createResearchJournal({query:(sql,args)=>pool.query(sql,args),clock});
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

