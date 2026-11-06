/* NABD phase 8 — immutable, sanitized public market analysis observations.
   Not a recommendation ledger, execution trace or customer ledger. */
const SYMBOLS=new Set(['XAUUSD','BTCUSD']);
const STATUSES=new Set(['NO_DATA','WARMING','SCANNING','WATCH','READY','NEWS_BLOCK','BLOCKED','STALE','GAP','UNKNOWN']);
const DIRS=new Set(['BUY','SELL','NEUTRAL']);
const MAX_DAYS=30,MAX_ROWS=20000,PAGE_SIZE=50;
const txt=(v,n=220)=>typeof v==='string'?v.replace(/[\u0000-\u001F\u007F]/g,' ').replace(/\s+/g,' ').trim().slice(0,n):'';
const normStatus=v=>STATUSES.has(v)?v:'UNKNOWN';
function framesOf(a){
 const frames={};
 for(const tf of ['M5','M15','H1','H4'])if(DIRS.has(a?.frames?.[tf]?.direction))frames[tf]=a.frames[tf].direction;
 return frames;
}
function checksOf(a){
 const out=[],seen=new Set();
 for(const p of [...(Array.isArray(a?.entrySafetyChecks)?a.entrySafetyChecks:[]),
   ...(Array.isArray(a?.readinessChecks)?a.readinessChecks:[]),
   ...(Array.isArray(a?.checks)?a.checks:[])]){
  const name=txt(p?.name||p?.label,110);
  if(!name||seen.has(name))continue;
  seen.add(name);out.push({name,pass:p.pass===true?true:p.pass===false?false:null});
  if(out.length>=16)break;
 }
 return out;
}
export function publicAnalysisObservation(m,now=Date.now()/1000){
 if(!SYMBOLS.has(m?.symbol)||!Number.isFinite(now)||now<=0)return null;
 const a=m.analysis||{},quoteAge=Number.isFinite(m.quote?.time)?now-m.quote.time:Infinity;
 const receiptAge=Number.isFinite(m.received_at)?now-m.received_at:Infinity;
 const ttl=Number.isFinite(m.quoteTtl)&&m.quoteTtl>0?m.quoteTtl:20;
 const fresh=m.connection==='LIVE'&&quoteAge>=-5&&quoteAge<=ttl&&receiptAge>=-5&&receiptAge<=ttl;
 const status=fresh?normStatus(a.status):m.quote?.time?'STALE':'NO_DATA';
 const score=fresh&&Array.isArray(a.checks)&&a.checks.length&&Number.isFinite(a.score)&&a.score>=0&&a.score<=100?Math.round(a.score):null;
 const reason=fresh?txt(a.reason_label||a.reason,240):
   status==='STALE'?'Market feed delayed; old analysis not live.':'No live market analysis available.';
 const checks=fresh?checksOf(a):[],frames=fresh?framesOf(a):{};
 return Object.freeze({
  symbol:m.symbol,recorded_at:Math.floor(now),source_kind:m.source_id?.startsWith('MT5:')?'MT5_BROKER':'REFERENCE',
  connection:fresh?'LIVE':status,analysis_status:status,
  strategy:fresh?txt(a.strategy,70):'',decision:fresh&&DIRS.has(a.decision)?a.decision:'WAIT',
  score,frames,checks,reason,
  last_bar:Number.isFinite(m.last_bar)&&m.last_bar>0?Math.floor(m.last_bar):null,
  quote_time:Number.isFinite(m.quote?.time)&&m.quote.time>0?Math.floor(m.quote.time):null,
  record_type:'MARKET_ANALYSIS_OBSERVATION'
 });
}
const majorKey=o=>JSON.stringify([o.source_kind,o.connection,o.analysis_status,o.decision,o.reason,o.strategy,o.frames,o.checks.filter(c=>c.pass===false).map(c=>c.name)]);
const fullKey=o=>JSON.stringify([majorKey(o),o.score,o.last_bar]);
export function createAnalysisJournal({db,clock=()=>Date.now()/1000,persistent=false}){
 db.exec("CREATE TABLE IF NOT EXISTS market_analysis_history (id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT NOT NULL, recorded_at REAL NOT NULL, significant TEXT NOT NULL, fingerprint TEXT NOT NULL, data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_market_analysis_history_symbol_time ON market_analysis_history(symbol,recorded_at DESC,id DESC);");
 const latest=new Map();
 for(const symbol of SYMBOLS){
  const prior=db.prepare('SELECT significant,fingerprint,recorded_at FROM market_analysis_history WHERE symbol=? ORDER BY id DESC LIMIT 1').get(symbol);
  if(prior)latest.set(symbol,prior);
 }
 const insert=db.prepare('INSERT INTO market_analysis_history(symbol,recorded_at,significant,fingerprint,data) VALUES (?,?,?,?,?)');
 let lastCleanup=0;
 function capture(state){
  const now=clock();let written=0;
  for(const symbol of SYMBOLS){
   const m=state?.markets?.[symbol];
   if(!m)continue;
   const observation=publicAnalysisObservation(m,now);
   if(!observation)continue;
   const significant=majorKey(observation),fingerprint=fullKey(observation),previous=latest.get(symbol);
   const elapsed=previous?now-previous.recorded_at:Infinity;
   const major=previous&&previous.significant!==significant;
   const insertNow=!previous||elapsed>=20&&(major||previous.fingerprint!==fingerprint&&elapsed>=300||
     previous.fingerprint===fingerprint&&elapsed>=900&&observation.connection==='LIVE');
   if(!insertNow)continue;
   insert.run(symbol,observation.recorded_at,significant,fingerprint,JSON.stringify(observation));
   latest.set(symbol,{significant,fingerprint,recorded_at:now});written++;
  }
  if(now-lastCleanup>=3600){
   db.prepare('DELETE FROM market_analysis_history WHERE recorded_at<?').run(now-MAX_DAYS*86400);
   db.prepare('DELETE FROM market_analysis_history WHERE id NOT IN (SELECT id FROM market_analysis_history ORDER BY id DESC LIMIT ?)').run(MAX_ROWS);
   lastCleanup=now;
  }
  return written;
 }
 function list({symbol='ALL',status='ALL',source='ALL',since=0,before=0,limit=PAGE_SIZE}={}){
  if(symbol!=='ALL'&&!SYMBOLS.has(symbol))throw new RangeError('Invalid symbol');
  if(status!=='ALL'&&!STATUSES.has(status))throw new RangeError('Invalid status');
  if(!['ALL','MT5_BROKER','REFERENCE'].includes(source))throw new RangeError('Invalid source');
  if(!Number.isInteger(since)||since<0||since>clock()+300)throw new RangeError('Invalid time filter');
  if(!Number.isInteger(before)||before<0)throw new RangeError('Invalid cursor');
  if(!Number.isInteger(limit)||limit<1||limit>PAGE_SIZE)throw new RangeError('Invalid limit');
  const where=[],params=[];
  if(symbol!=='ALL'){where.push('symbol=?');params.push(symbol);}
  if(since>0){where.push('recorded_at>=?');params.push(since);}
  if(before>0){where.push('id<?');params.push(before);}
  if(source!=='ALL'){where.push("json_extract(data,'$.source_kind')=?");params.push(source);}
  if(status!=='ALL'){where.push("json_extract(data,'$.analysis_status')=?");params.push(status);}
  const sql='SELECT id,data FROM market_analysis_history'+(where.length?' WHERE '+where.join(' AND '):'')+' ORDER BY id DESC LIMIT ?';
  const found=db.prepare(sql).all(...params,limit+1),more=found.length>limit;
  const rows=found.slice(0,limit).map(({id,data})=>({id,...JSON.parse(data)}));
  return {kind:'MARKET_ANALYSIS_OBSERVATIONS_NOT_TRADE_FILLS',rows,next_cursor:more?rows.at(-1).id:null,
   storage:persistent?'persistent':'not_confirmed_persistent',
   started_at:db.prepare('SELECT MIN(recorded_at) AS t FROM market_analysis_history').get().t??null,
   retention_days:MAX_DAYS,serverTime:clock()};
 }
 return {capture,list};
}
