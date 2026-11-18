// Phase 5: bounded, redacted observation log for isolated research.
// No broker orders, personal account data, API credentials, raw model text or prices.
const SYMBOLS=new Set(['XAUUSD','BTCUSD']);
const STAGES=new Set(['SCHEDULED','BLOCKED','ANALYZED','PERSISTENCE_FAILED',
 'QUEUED','DELIVERED_TO_DEMO_EA','EXPIRED_UNPULLED_INTENT',
 'EXPIRED_OR_PRICE_MOVED','EA_REPORTED_FILL_WITH_DEAL',
 'UNVERIFIED_EA_FILL_CLAIM','EA_REPORTED_REJECTION',
 'EA_UNCERTAIN_BROKER_RESULT']);
const safeReason=x=>typeof x==='string'&&/^[A-Z][A-Z0-9_]{0,79}$/.test(x)?x:'REDACTED_REASON';
const allowStance=x=>['BUY_WATCH','SELL_WATCH','WAIT'].includes(x)?x:null;
export function createIsolatedDecisionAudit({clock=()=>Math.floor(Date.now()/1000),limit=50}={}){
 if(!Number.isSafeInteger(limit)||limit<1||limit>500)throw Error('INVALID_AUDIT_LIMIT');
 const entries=[],stageCounts=Object.create(null),reasonCounts=Object.create(null);
 let total=0,invalid=0;
 function record(symbol,event){
  if(!SYMBOLS.has(symbol)||!event||typeof event!=='object'||
      !STAGES.has(event.stage)){
   invalid++;return {accepted:false,reason:'INVALID_AUDIT_EVENT'};
  }
  const reason=event.stage==='BLOCKED'||event.stage==='PERSISTENCE_FAILED'?
    safeReason(event.reason):null;
  const stamp=clock();
  const item={time:Number.isSafeInteger(stamp)&&stamp>0?
    new Date(stamp*1000).toISOString():null,
   symbol,stage:event.stage,reason,
   stance:event.stage==='ANALYZED'?allowStance(event.stance):null,
   confidence:event.stage==='ANALYZED'&&typeof event.confidence==='number'&&
    Number.isFinite(event.confidence)&&event.confidence>=0&&event.confidence<=1?
    Math.round(event.confidence*100)/100:null};
  entries.push(item);if(entries.length>limit)entries.shift();
  stageCounts[item.stage]=(stageCounts[item.stage]||0)+1;
  if(reason)reasonCounts[reason]=(reasonCounts[reason]||0)+1;
  total++;
  return {accepted:true};
 }
 function report(){
  return {status:'ISOLATED_READ_ONLY_OBSERVER',total,invalid,
   recent:[...entries].reverse().map(e=>({...e})),
   stageCounts:{...stageCounts},reasonCounts:{...reasonCounts},
   retention:'IN_MEMORY_BOUNDED',maxRecent:limit,
   includesAccountIdentifiers:false,includesProviderCredentials:false,
   includesRawModelText:false,canTriggerTrade:false,
   executionAllowed:false,liveTradingEnabled:false};
 }
 return {record,report};
}
