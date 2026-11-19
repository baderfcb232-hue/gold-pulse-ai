// Phase 10: isolated, read-only incident transitions.
// No restart, env modification, trading, order submission or automatic remediation.
const MARKETS=['XAUUSD','BTCUSD'];
const code=x=>typeof x==='string'&&/^[A-Z][A-Z0-9_]{0,79}$/.test(x)?x:'UNVERIFIED_REASON';
const unique=a=>[...new Set(Array.isArray(a)?a.map(code):[])].sort();
export function createIncidentMonitor({clock=()=>Math.floor(Date.now()/1000),maxHistory=100}={}){
 if(!Number.isSafeInteger(maxHistory)||maxHistory<1||maxHistory>500)throw Error('INVALID_INCIDENT_LIMIT');
 const active=new Map(),history=[],recovery=new Map();
 let opened=0,resolved=0,checked=0;
 function add(event){
  history.unshift(event);if(history.length>maxHistory)history.length=maxHistory;
 }
 function ingest(quality,{observations={}}={}){
  const now=clock();
  if(!Number.isSafeInteger(now)||now<=0)throw Error('INVALID_MONITOR_CLOCK');
  checked++;
  for(const symbol of MARKETS){
   const state=quality?.markets?.[symbol],why=unique(state?.reasons);
   const blocked=state?.status!=='READY_TO_OBSERVE_ONLY'||why.length>0;
   const reasons=blocked?(why.length?why:['QUALITY_RESULT_MISSING']):[];
   const current=active.get(symbol);
   if(blocked){
    recovery.delete(symbol);
    if(!current){
     const event={symbol,openedAt:new Date(now*1000).toISOString(),reasons,
      status:'OPEN',lastObservedAt:new Date(now*1000).toISOString()};
     active.set(symbol,event);opened++;
     add({type:'OPENED',symbol,at:event.openedAt,reasons});
    }else{
     current.lastObservedAt=new Date(now*1000).toISOString();
     current.reasons=reasons;
    }
    continue;
   }
   if(!current)continue;
   // Two separate NEW signed broker observations are needed to prove recovery.
   // Repeated GET refreshes on the same observation cannot mark an incident resolved.
   const stamp=observations?.[symbol];
   const tick=typeof stamp==='string'?Date.parse(stamp)/1000:NaN;
   const fresh=Number.isSafeInteger(tick)&&tick<=now&&now-tick<=10;
   const previous=recovery.get(symbol);
   if(!fresh||previous?.tick===tick)continue;
   const count=(previous?.count||0)+1;
   recovery.set(symbol,{tick,count});
   if(count<2)continue;
   active.delete(symbol);recovery.delete(symbol);resolved++;
   add({type:'RECOVERED',symbol,at:new Date(now*1000).toISOString(),
    previousReasons:current.reasons,verifiedDistinctObservations:2});
  }
  return report();
 }
 function report(){
  return {status:active.size?'ISOLATED_INCIDENTS_OPEN':'NO_ACTIVE_INCIDENTS_REPORTED',
   active:MARKETS.filter(s=>active.has(s)).map(s=>({...active.get(s),
    reasons:[...active.get(s).reasons],recoveryObservations:recovery.get(s)?.count||0})),
   events:history.map(e=>({...e,reasons:e.reasons?[...e.reasons]:undefined})),
   counters:{checked,opened,resolved},maxHistory,
   historyPersistence:'IN_MEMORY_RESETS_ON_RESTART',
   automaticRemediation:false,restartsTriggered:0,tradingAllowed:false,
   executionAllowed:false,ordersCreated:0,
   note:'A healthy status here means observed recovery only, never trading readiness'};
 }
 return {ingest,report};
}
