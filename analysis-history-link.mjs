/* Operator-only read model for exact recommendation-to-broker evidence.
 * Does not create or alter orders, fills, analysis entries, or account records. */
import {recommendationCode} from './execution-trace.mjs';
export function verifiedAnalysisLink(observation,tracedSignals=[]){
 if(!observation||observation.source_type!=='MT5'||
    typeof observation.recommendation_code!=='string'||
    !/^[A-F0-9]{12}$/.test(observation.recommendation_code)){
  return {linked:false,reason:'NO_EXACT_PUBLISHED_RECOMMENDATION'};
 }
 const matching=tracedSignals.filter(p=>
   p?.symbol===observation.symbol&&typeof p?.id==='string'&&
   p.source?.startsWith('MT5')&&
   recommendationCode(p.id)===observation.recommendation_code&&
   Number.isFinite(p.issued_at)&&p.issued_at<=observation.recorded_at+5&&
   Number.isFinite(p.expires_at)&&p.expires_at>observation.recorded_at);
 // Never use symbol, price, time or strategy similarity as a fallback.
 if(matching.length!==1)return {linked:false,reason:'EXACT_SIGNAL_NOT_AVAILABLE'};
 const signal=matching[0],trace=signal.execution_trace;
 const fill=trace?.status==='FILLED'&&trace?.broker_fill_confirmed===true&&
   /^[1-9][0-9]{0,19}$/.test(trace.broker_deal_ticket||'');
 const state=fill?'BROKER_FILL_CONFIRMED':
   trace?.status==='REJECTED'?'EA_REJECTED':
   trace?.status==='SUBMITTED'?'SUBMITTED_NOT_BROKER_CONFIRMED':
   trace?.status==='DISPATCHED'?'DISPATCHED_NOT_BROKER_CONFIRMED':
   trace?.status==='BLOCKED'?'BLOCKED':
   'EXECUTION_NOT_CONFIRMED';
 return {linked:true,kind:'EXACT_RECOMMENDATION_ID_MATCH',signal_code:observation.recommendation_code,
   published_at:signal.issued_at,published_status:signal.status||null,
   execution_state:state,broker_fill_confirmed:Boolean(fill),
   broker_deal_ticket:fill?trace.broker_deal_ticket:null,
   rejection_reason:trace?.status==='REJECTED'?String(trace.reason||'EA_REJECTED').slice(0,180):null};
}
