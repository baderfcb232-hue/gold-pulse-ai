// Pure shadow orchestration for isolated MT5 DEMO sensor snapshots.
// A research plan can never turn into a broker order through this pipeline.
import {validateIsolatedDemoSnapshot} from './mt5-demo-sensor.mjs';
import {evaluatePhase4ShadowDecision} from './phase4-decision-risk.mjs';
import {validateResearchContext} from './research-brain.mjs';
const fail=(phase,reasons)=>({status:'BLOCKED',phase,reasons,analysis:null,risk:null,
 simulationOnly:true,executionAllowed:false,order:null});
export function createShadowResearchPipeline({brain,clock=()=>Math.floor(Date.now()/1000)}={}){
 if(!brain||typeof brain.analyze!=='function')throw Error('BRAIN_REQUIRED');
 let checks=0,analyzed=0,blocked=0,lastResult=null;
 async function assess({snapshot,proposal,news}={}){
  checks++;
  const now=clock();
  const verified=validateIsolatedDemoSnapshot(snapshot,now);
  if(verified.status!=='VALIDATED_RESEARCH_SENSOR'){
   blocked++;lastResult=fail('DEMO_SENSOR',verified.errors);return lastResult;
  }
  const s=verified.safe;
  const ctx={symbol:s.symbol,feedType:'MT5_DEMO_BROKER',observedAt:s.timestamp,
   bid:s.bid,ask:s.ask,spreadLimit:proposal?.spreadLimit,
   candlesVerified:true,multiTimeframeVerified:s.multiTimeframeVerified===true,
   candlesM5:s.candlesM5,candlesM15:s.candlesM15,candlesH1:s.candlesH1,candlesH4:s.candlesH4,
   accountType:'DEMO',news:news||{classification:'NONE'}};
  const context=validateResearchContext(ctx,now);
  if(context.status!=='RESEARCH_CONTEXT_READY'){
   blocked++;lastResult=fail('MARKET_CONTEXT',context.reasons);return lastResult;
  }
  const analysis=await brain.analyze(ctx);
  if(analysis.status!=='RESEARCH_ANALYSIS_ONLY'||!analysis.plan){
   blocked++;lastResult=fail('AI_ANALYSIS',analysis.reasons||['NO_ANALYSIS']);return lastResult;
  }
  analyzed++;
  // Phase 4: deterministic shadow policy. Missing or stale risk context fails closed.
  const decision=evaluatePhase4ShadowDecision({
    symbol:s.symbol,plan:analysis.plan,proposal,broker:s,now,news:ctx.news
  });
  lastResult={status:decision.status,phase:'PHASE4_DECISION_RISK',
    reasons:decision.reasons,analysis:{stance:analysis.plan.stance,
      confidence:analysis.plan.confidence},
    risk:decision.risk,simulationOnly:true,executionAllowed:false,order:null};
  if(lastResult.status==='BLOCKED')blocked++;
  return lastResult;
 }
 return {assess,report:()=>({checks,analyzed,blocked,lastResult,
  brokerFeedConnected:false,liveOrderTransport:false,executionAllowed:false})};
}
