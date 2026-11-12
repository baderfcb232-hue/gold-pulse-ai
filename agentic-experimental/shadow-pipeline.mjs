// Pure shadow orchestration for isolated MT5 DEMO sensor snapshots.
// A research plan can never turn into a broker order through this pipeline.
import {validateIsolatedDemoSnapshot} from './mt5-demo-sensor.mjs';
import {reviewShadowRisk} from './shadow-risk-engine.mjs';
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
  // This can produce a shadow risk review only; stop levels are hypothetical
  // and no lot, broker order, or execution payload is created.
  const risk=reviewShadowRisk({
   symbol:s.symbol,side:proposal?.side,accountType:'DEMO',
   balance:proposal?.balance,riskPercent:proposal?.riskPercent,
   entry:proposal?.entry,stop:proposal?.stop,target:proposal?.target,
   spread:s.ask-s.bid,spreadLimit:proposal?.spreadLimit,
   quoteAgeSeconds:now-s.timestamp,
   positionsForSymbol:proposal?.positionsForSymbol,dailyEntries:proposal?.dailyEntries,modelPlan:analysis.plan
  });
  lastResult={status:risk.status==='SHADOW_RISK_ACCEPTABLE'?
   'SHADOW_RESEARCH_ONLY':'BLOCKED',phase:'SHADOW_RISK',
   reasons:risk.reasons,analysis:{stance:analysis.plan.stance,confidence:analysis.plan.confidence},
   risk,simulationOnly:true,executionAllowed:false,order:null};
  if(lastResult.status==='BLOCKED')blocked++;
  return lastResult;
 }
 return {assess,report:()=>({checks,analyzed,blocked,lastResult,
  brokerFeedConnected:false,liveOrderTransport:false,executionAllowed:false})};
}
