// Deterministic synthetic-only smoke tests executed inside the isolated service.
// No MT5 data, no OpenAI call, no money or order endpoints.
import {createShadowResearchPipeline} from './shadow-pipeline.mjs';
const bars=(now,seconds)=>[3,2,1].map(i=>({
 time:now-i*seconds,open:100,high:101,low:99,close:100.4
}));
export async function runSyntheticShadowSmoke({now=Math.floor(Date.now()/1000)}={}){
 const data={environment:'EXPERIMENTAL_NABD_AGENTIC',accountType:'DEMO',
  executionEnabled:false,symbol:'XAUUSD',brokerServer:'SYNTHETIC-Demo',
  timestamp:now-1,bid:100,ask:100.2,tickSize:0.01,tickValue:1,contractSize:1,
  candlesM5:bars(now,300),candlesM15:bars(now,900),
  candlesH1:bars(now,3600),candlesH4:bars(now,14400)};
 const proposal={side:'BUY',balance:2000,riskPercent:0.4,entry:100,stop:98,
  target:106,spreadLimit:0.5,positionsForSymbol:0};
 let brainCalls=0;
 const pipeline=createShadowResearchPipeline({
  clock:()=>now,
  brain:{analyze:async()=>{brainCalls++;return{
   status:'RESEARCH_ANALYSIS_ONLY',plan:{stance:'BUY_WATCH',confidence:0.5}
  };}}
 });
 const valid=await pipeline.assess({snapshot:data,proposal});
 const live=await pipeline.assess({snapshot:{...data,accountType:'LIVE'},proposal});
 const missing=await pipeline.assess({snapshot:{...data,candlesM15:[]},proposal});
 const delayed=await pipeline.assess({snapshot:data,proposal,
  news:{classification:'DELAYED'}});
 const passed=brainCalls===1&&valid.status==='SHADOW_RESEARCH_ONLY'&&
  valid.order===null&&valid.executionAllowed===false&&
  valid.risk.lotSize===null&&live.status==='BLOCKED'&&
  missing.status==='BLOCKED'&&delayed.status==='BLOCKED';
 return {status:passed?'SYNTHETIC_SELF_TEST_PASSED':'SYNTHETIC_SELF_TEST_FAILED',
  syntheticDataOnly:true,realBrokerConnected:false,realAINewsAnalysisTested:false,
  orderExecutionSupported:false,
  cases:{syntheticDemoScenario:valid.status,liveAccountRejected:live.status==='BLOCKED',
    missingM15Rejected:missing.status==='BLOCKED',
    delayedNewsRejected:delayed.status==='BLOCKED'},
  brokerTradingEnabled:false,fxStreetConfigured:false};
}
