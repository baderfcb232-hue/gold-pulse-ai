/* NABD Phase 8 — read-only analysis observation journal.
 * Saves sanitized market diagnostics, never account data, plan prices,
 * recommendation identifiers, or broker order/deal details.
 * A READY analysis is NOT proof of publication or execution.
 */
import {recommendationCode} from './execution-trace.mjs';
export const HISTORY_SYMBOLS=Object.freeze(['XAUUSD','BTCUSD']);
export const HISTORY_STATUSES=Object.freeze([
 'NO_DATA','WARMING','SCANNING','WATCH','READY','NEWS_BLOCK','BLOCKED','STALE','GAP','ERROR','UNKNOWN'
]);
export const ANALYSIS_HISTORY_RETENTION_DAYS=90;
const VALID_SYMBOL=new Set(HISTORY_SYMBOLS),VALID_STATUS=new Set(HISTORY_STATUSES);
const FRAMES=['M5','M15','H1','H4'];
function label(value,max=200){
 if(typeof value!=='string')return '';
 return value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\b\d{8,}\b/g,'[redacted]')
  .replace(/\s+/g,' ').trim().slice(0,max);
}
function checks(value){
 if(!Array.isArray(value))return [];
 return value.slice(0,12).filter(x=>x&&typeof x==='object').map(x=>({
  label:label(x.name||x.label,100),pass:x.pass===true?true:x.pass===false?false:null
 })).filter(x=>x.label);
}
function direction(value){return ['BUY','SELL','NEUTRAL'].includes(value)?value:null;}
export function captureAnalysisSnapshot(m,recordedAt){
 if(!m||!VALID_SYMBOL.has(m.symbol)||!Number.isFinite(recordedAt)||recordedAt<=0)return null;
 if(!Number.isFinite(m.quote?.time)||m.quote.time<=0)return null;
 const a=m.analysis&&typeof m.analysis==='object'?m.analysis:{};
 const isStale=m.connection!=='LIVE'||a.status==='STALE'||m.quote.time>recordedAt+5||
   recordedAt-m.quote.time>(Number.isFinite(m.quoteTtl)?m.quoteTtl:90);
 const status=isStale?'STALE':VALID_STATUS.has(a.status)?a.status:'UNKNOWN';
 const source_type=typeof m.source_id==='string'&&m.source_id.startsWith('MT5:')?'MT5':'REFERENCE';
 const frames={};
 if(!isStale)for(const frame of FRAMES){
  const side=direction(a.frames?.[frame]?.direction);
  if(side)frames[frame]=side;
 }
 const score=!isStale&&Number.isFinite(a.score)&&a.score>=0&&a.score<=100
  ?Math.round(a.score*10)/10:null;
 const reason=label(a.reason_label||a.reason||m.feed_error||'',240);
 // Correlate only an already published, current signal with the exact source.
 // A similar timestamp/price/strategy is NEVER sufficient for a verified link.
 const signal=m.currentSignal;
 const correlated=source_type==='MT5'&&!isStale&&a.status==='READY'&&
  typeof signal?.id==='string'&&signal.id.length>0&&signal.id.length<=250&&
  signal.symbol===m.symbol&&Number.isFinite(signal.issued_at)&&signal.issued_at<=recordedAt+5&&
  signal.issued_at>=recordedAt-86400&&Number.isFinite(signal.expires_at)&&signal.expires_at>recordedAt;
 const recommendation_code=correlated?recommendationCode(signal.id):null;
 return {
  symbol:m.symbol,recorded_at:Math.floor(recordedAt),quote_at:Math.floor(m.quote.time),
  status,decision:!isStale&&['BUY','SELL','WAIT'].includes(a.decision)?a.decision:'WAIT',
  score,source_type,reason:reason||(isStale?'Quote stale':'No explanation received'),
  strategy:label(a.strategy,45),frames,recommendation_code,
  indicator_checks:isStale?[]:checks(a.checks),
  readiness_checks:isStale?[]:checks(a.readinessChecks),
  entry_checks:isStale?[]:checks(a.entrySafetyChecks),
  scope:'GLOBAL_MARKET',kind:'ANALYSIS_OBSERVATION'
 };
}
function fingerprint(row){
 return JSON.stringify([row.status,row.decision,row.source_type,row.reason,row.strategy,row.recommendation_code,
  row.frames,row.indicator_checks.map(x=>x.pass),row.readiness_checks.map(x=>x.pass),
  row.entry_checks.map(x=>x.pass)]);
}
// CSV is generated solely from sanitized observation fields. Prefix spreadsheet
// formula starters to prevent CSV injection when a source sends malicious text.
export function analysisHistoryCsv(rows){
 const columns=['recorded_at','symbol','status','source_type','decision','score','strategy',
  'reason','M5','M15','H1','H4','failed_checks','kind'];
 const cell=value=>{
  let text=String(value??'').replace(/[\u0000-\u001F\u007F]/g,' ').trim();
  if(/^[=+\-@]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
 };
 const data=[columns.join(',')];
 for(const row of rows){
  const failure=[...(row.indicator_checks||[]),...(row.readiness_checks||[]),...(row.entry_checks||[])]
   .filter(x=>x?.pass===false).map(x=>x.label).slice(0,12).join(' | ');
  const values=[
   row.recorded_at,row.symbol,row.status,row.source_type,row.decision,row.score,row.strategy,
   row.reason,...['M5','M15','H1','H4'].map(tf=>row.frames?.[tf]||''),failure,'ANALYSIS_OBSERVATION'
  ];
  data.push(values.map(cell).join(','));
 }
 return '\uFEFF'+data.join('\r\n')+'\r\n';
}
function readRow(record){
 if(!record)return null;
 try{return {id:record.id,...JSON.parse(record.data)};}catch{return null;}
}
export function createAnalysisHistory({db,clock=()=>Date.now()/1000,storagePersistent=false,
 retentionDays=ANALYSIS_HISTORY_RETENTION_DAYS,minChangeSeconds=45,sampleSeconds=1800,
 maxRows=12000,onRecord=()=>{}}={}){
 if(!db)throw new Error('SQLite database required');
 db.exec('CREATE TABLE IF NOT EXISTS analysis_history ('+
  'id INTEGER PRIMARY KEY AUTOINCREMENT,'+
  'recorded_at INTEGER NOT NULL,symbol TEXT NOT NULL,status TEXT NOT NULL,'+
  'fingerprint TEXT NOT NULL,data TEXT NOT NULL);'+
  'CREATE INDEX IF NOT EXISTS idx_analysis_history_symbol_time ON analysis_history(symbol,recorded_at DESC,id DESC);'+
  'CREATE INDEX IF NOT EXISTS idx_analysis_history_status_time ON analysis_history(status,recorded_at DESC,id DESC);');
 const insert=db.prepare('INSERT INTO analysis_history(recorded_at,symbol,status,fingerprint,data) VALUES(?,?,?,?,?)');
 const insertedId=db.prepare('SELECT last_insert_rowid() AS id');
 const lastBySymbol=new Map();
 for(const symbol of HISTORY_SYMBOLS){
  const last=db.prepare('SELECT id,recorded_at,status,fingerprint FROM analysis_history WHERE symbol=? ORDER BY id DESC LIMIT 1').get(symbol);
  if(last)lastBySymbol.set(symbol,{at:last.recorded_at,status:last.status,fingerprint:last.fingerprint,id:last.id});
 }
 let writes=0;
 const prune=()=>{
  const cutoff=Math.floor(clock()-Math.max(1,retentionDays)*86400);
  db.prepare('DELETE FROM analysis_history WHERE recorded_at<?').run(cutoff);
  db.prepare('DELETE FROM analysis_history WHERE id IN (SELECT id FROM analysis_history ORDER BY id DESC LIMIT -1 OFFSET ?)').run(maxRows);
 };
 function capture(state){
  const at=Math.floor(clock());
  if(!state?.markets||!Number.isFinite(at)||at<=0)return 0;
  let written=0;
  for(const symbol of HISTORY_SYMBOLS){
   const data=captureAnalysisSnapshot(state.markets[symbol],at);
   if(!data)continue;
   const next=fingerprint(data),prev=lastBySymbol.get(symbol);
   const elapsed=prev?at-prev.at:Infinity;
   const statusChanged=prev&&prev.status!==data.status;
   if(prev&&elapsed<Math.max(10,minChangeSeconds)&&!statusChanged)continue;
   if(prev&&elapsed<10)continue;
   if(prev&&prev.fingerprint===next&&elapsed<Math.max(sampleSeconds,minChangeSeconds))continue;
   insert.run(data.recorded_at,symbol,data.status,next,JSON.stringify(data));
   // Durable mirror receives only the same sanitized observation.
   try{onRecord(data);}catch{}
   lastBySymbol.set(symbol,{at,status:data.status,fingerprint:next,id:insertedId.get().id});
   written++;writes++;
  }
  if(writes>=80){prune();writes=0;}
  return written;
 }
 function list({symbol='ALL',status='ALL',since=null,before=null,limit=40,query=''}={}){
  if(symbol!=='ALL'&&!VALID_SYMBOL.has(symbol))throw new RangeError('Invalid symbol');
  if(status!=='ALL'&&!VALID_STATUS.has(status))throw new RangeError('Invalid analysis status');
  if(since!=null&&(!Number.isSafeInteger(since)||since<0))throw new RangeError('Invalid time window');
  if(before!=null&&(!Number.isSafeInteger(before)||before<1))throw new RangeError('Invalid cursor');
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new RangeError('Invalid page size');
  if(typeof query!=='string'||query.length>100||/[\u0000-\u001F\u007F]/.test(query))throw new RangeError('Invalid search query');
  const search=query.trim();
  const clauses=['1=1'],args=[];
  if(symbol!=='ALL'){clauses.push('symbol=?');args.push(symbol);}
  if(status!=='ALL'){clauses.push('status=?');args.push(status);}
  if(since!=null){clauses.push('recorded_at>=?');args.push(since);}
  if(before!=null){clauses.push('id<?');args.push(before);}
  if(search){clauses.push('instr(lower(data),lower(?))>0');args.push(search);}
  const results=db.prepare('SELECT id,recorded_at,data FROM analysis_history WHERE '+clauses.join(' AND ')+
    ' ORDER BY id DESC LIMIT ?').all(...args,limit+1);
  const hasMore=results.length>limit;
  const page=results.slice(0,limit).map(readRow).filter(Boolean);
  const first=db.prepare('SELECT MIN(recorded_at) AS first FROM analysis_history').get()?.first||null;
  return {items:page,next_cursor:hasMore?page.at(-1)?.id||null:null,
   first_recorded_at:first,retention_days:retentionDays,
   storage_persistent:Boolean(storagePersistent),kind:'ANALYSIS_OBSERVATIONS_NOT_TRADES',
   scope:'GLOBAL_MARKET',backfilled:false};
 }
 function exportCsv({symbol='ALL',status='ALL',since=null,query=''}={}){
  const rows=[];let before=null;
  while(rows.length<1000){
   const page=list({symbol,status,since,query,before,limit:100});
   rows.push(...page.items);
   if(!page.next_cursor)break;
   before=page.next_cursor;
  }
  return analysisHistoryCsv(rows.slice(0,1000));
 }
 return {capture,list,exportCsv,prune};
}
