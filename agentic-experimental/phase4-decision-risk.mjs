// Phase 4 deterministic fail-closed decision gate. Isolated DEMO/PAPER research only.
// Never converts AI text into an execution permission or MT5 order.
import {reviewShadowRisk} from './shadow-risk-engine.mjs';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const blocked=(reasons)=>({status:'BLOCKED',reasons,stance:'WAIT',confidence:null,
 risk:null,simulationOnly:true,executionAllowed:false,order:null});
export function evaluatePhase4ShadowDecision({symbol,plan,proposal,broker,now,news}={}){
 const reasons=[];
 if(!['XAUUSD','BTCUSD'].includes(symbol))reasons.push('UNSUPPORTED_SYMBOL');
 if(!plan||!['BUY_WATCH','SELL_WATCH','WAIT'].includes(plan.stance))
  reasons.push('INVALID_AI_DECISION');
 else if(plan.stance==='WAIT')reasons.push('AI_DECISION_WAIT');
 if(!finite(plan?.confidence)||plan.confidence<0.65||plan.confidence>1)
  reasons.push('AI_CONFIDENCE_BELOW_SHADOW_THRESHOLD');
 if(typeof plan?.thesis!=='string'||!plan.thesis.trim()||
    typeof plan?.counterThesis!=='string'||!plan.counterThesis.trim()||
    !Array.isArray(plan?.evidence)||!plan.evidence.some(e=>typeof e==='string'&&e.trim())||
    typeof plan?.invalidation!=='string'||!plan.invalidation.trim())
  reasons.push('AI_REASONING_INCOMPLETE');
 if(!Number.isSafeInteger(now)||!Number.isSafeInteger(broker?.timestamp)||
    broker.timestamp>now||now-broker.timestamp>2)
  reasons.push('BROKER_QUOTE_NOT_CURRENT');
 if(broker?.accountType!=='DEMO'||broker?.environment!=='EXPERIMENTAL_NABD_AGENTIC')
  reasons.push('DEMO_BROKER_IDENTITY_REQUIRED');
 if(!['NONE','REALTIME'].includes(news?.classification))
  reasons.push('UNVERIFIED_ECONOMIC_CONTEXT');
 if(news?.classification==='REALTIME'&&
    (!news.authorized||!news.releaseTimeVerified||!news.preReleaseForecastCaptured))
  reasons.push('UNVERIFIED_REALTIME_ECONOMIC_EVIDENCE');
 if(!Number.isSafeInteger(proposal?.positionsForSymbol)||proposal.positionsForSymbol<0)
  reasons.push('OPEN_POSITION_COUNT_NOT_VERIFIED');
 if(!finite(proposal?.dailyLossPercent)||proposal.dailyLossPercent<0||
    proposal.dailyLossPercent>=2)
  reasons.push('DAILY_LOSS_LIMIT_OR_UNKNOWN');
 if(!finite(proposal?.riskPercent)||proposal.riskPercent<=0||proposal.riskPercent>0.5)
  reasons.push('INVALID_RISK_BUDGET');
 else if(finite(proposal?.dailyLossPercent)&&proposal.dailyLossPercent+proposal.riskPercent>2)
  reasons.push('DAILY_RISK_CAP_BREACH');
 if(symbol==='BTCUSD'&&(!Number.isSafeInteger(proposal?.dailyEntries)||
    proposal.dailyEntries<0||proposal.dailyEntries>=6))
  reasons.push('BTC_DAILY_ENTRY_COUNT_NOT_VERIFIED');
 if(reasons.length)return blocked([...new Set(reasons)]);
 const risk=reviewShadowRisk({
  symbol,side:proposal?.side,accountType:'DEMO',
  balance:proposal?.balance,riskPercent:proposal?.riskPercent,
  entry:proposal?.entry,stop:proposal?.stop,target:proposal?.target,
  spread:broker.ask-broker.bid,spreadLimit:proposal?.spreadLimit,
  quoteAgeSeconds:now-broker.timestamp,
  positionsForSymbol:proposal.positionsForSymbol,dailyEntries:proposal.dailyEntries,
  modelPlan:plan
 });
 return {status:risk.status==='SHADOW_RISK_ACCEPTABLE'?'SHADOW_RESEARCH_ONLY':'BLOCKED',
  reasons:risk.reasons,stance:plan.stance,confidence:plan.confidence,
  risk,simulationOnly:true,executionAllowed:false,order:null};
}
