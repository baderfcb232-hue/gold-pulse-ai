// Paired, research-only comparison. No broker calls and no automatic strategy selection.
// Caller supplies frozen, verified historical contexts and future outcomes separately.
import {buildFusionEvidence} from './fusion-evidence.mjs';
import {validateIsolatedDemoSnapshot} from './mt5-demo-sensor.mjs';
import {multiTimeframeFeatures} from './market-features.mjs';
export async function compareFusionPair({context,snapshot,baselineBrain,fusionBrain}={}){
 if(!context||context.feedType!=='MT5_DEMO_BROKER'||context.accountType!=='DEMO'||!context.candlesVerified||!context.multiTimeframeVerified||
  !snapshot||snapshot.symbol!==context.symbol||snapshot.timestamp!==context.observedAt||
  snapshot.bid!==context.bid||snapshot.ask!==context.ask)throw Error('UNVERIFIED_PAIR_CONTEXT');
 const validated=validateIsolatedDemoSnapshot(snapshot,context.observedAt);
 if(validated.status!=='VALIDATED_RESEARCH_SENSOR'||!validated.safe.multiTimeframeVerified)throw Error('UNVERIFIED_PAIR_CONTEXT');
 const clean=validated.safe;
 const base=structuredClone(context);delete base.fusionEvidence;
 // Both variants derive identical inputs from one validated, frozen snapshot.
 for(const [tf,n] of Object.entries({M5:40,M15:32,H1:24,H4:24}))base['candles'+tf]=clean['candles'+tf].slice(-n);
 base.technicalEvidence=multiTimeframeFeatures(clean);
 const enhanced={...structuredClone(base),fusionEvidence:buildFusionEvidence(clean)};
 const [a,b]=await Promise.all([baselineBrain.analyze(base),fusionBrain.analyze(enhanced)]);
 const normalize=r=>r?.status==='RESEARCH_ANALYSIS_ONLY'&&['BUY_WATCH','SELL_WATCH','WAIT'].includes(r.plan?.stance)?{stance:r.plan.stance,confidence:r.plan.confidence}:null;
 return {symbol:base.symbol,observedAt:base.observedAt,baseline:normalize(a),fusion:normalize(b),evaluationMode:'OFFLINE_FROZEN_CONTEXT_REPLAY',executionAllowed:false};
}
export function scoreFusionPairs(rows,{minimum=30}={}){
 const result={};
 for(const symbol of ['XAUUSD','BTCUSD']){
  const seen=new Set(),stats={paired:0,baseline:{directional:0,hits:0,wait:0},fusion:{directional:0,hits:0,wait:0}};
  for(const r of rows){
   if(r.symbol!==symbol||!r.baseline||!r.fusion||!Number.isSafeInteger(r.observedAt)||!Number.isSafeInteger(r.outcomeAt)||
    r.outcomeAt<r.observedAt+3600||r.outcomeAt>r.observedAt+3720||r.verifiedFutureBrokerOutcome!==true||
    !['UP','DOWN','FLAT'].includes(r.direction)||seen.has(r.observedAt))continue;
   if(![r.baseline,r.fusion].every(p=>['BUY_WATCH','SELL_WATCH','WAIT'].includes(p.stance)))continue;
   seen.add(r.observedAt);stats.paired++;
   for(const k of ['baseline','fusion']){
    const stance=r[k].stance,s=stats[k];
    if(stance==='WAIT'){s.wait++;continue;}
    s.directional++;if((stance==='BUY_WATCH'&&r.direction==='UP')||(stance==='SELL_WATCH'&&r.direction==='DOWN'))s.hits++;
   }
  }
  for(const k of ['baseline','fusion']){
   const s=stats[k];s.hitRate=s.directional>=minimum?s.hits/s.directional:null;s.coverage=stats.paired?s.directional/stats.paired:null;
  }
  result[symbol]=stats;
 }
 return {markets:result,horizonMinutes:60,minimumDirectionalSamples:minimum,profitabilityMeasured:false,transactionCostsIncluded:false,executionAllowed:false};
}
