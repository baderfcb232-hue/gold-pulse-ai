import test from 'node:test';
import assert from 'node:assert/strict';
import {createShadowResearchPipeline} from './shadow-pipeline.mjs';
const now=1800000000;
const bars=(duration)=>[3,2,1].map(n=>{
 const time=now-duration*n;
 return {time,open:100,high:101,low:99,close:100.4};
});
const demo={environment:'EXPERIMENTAL_NABD_AGENTIC',accountType:'DEMO',executionEnabled:false,
 symbol:'XAUUSD',brokerServer:'Isolated-Broker-Demo',timestamp:now-1,
 bid:100,ask:100.2,tickSize:0.01,tickValue:1,contractSize:1,
 candlesM5:bars(300),candlesM15:bars(900),candlesH1:bars(3600),candlesH4:bars(14400)};
const proposal={side:'BUY',balance:2000,riskPercent:0.4,entry:100,stop:98,target:106,
 spreadLimit:0.5,positionsForSymbol:0};
test('isolated pipeline validates demo frames then analyzes and reviews shadow risk',async()=>{
 let calls=0;
 const p=createShadowResearchPipeline({clock:()=>now,brain:{analyze:async ctx=>{
  calls++;assert.equal(ctx.multiTimeframeVerified,true);
  assert.equal(ctx.candlesH4.length,3);
  return {status:'RESEARCH_ANALYSIS_ONLY',plan:{stance:'BUY_WATCH',confidence:0.7}};
 }}});
 const r=await p.assess({snapshot:demo,proposal});
 assert.equal(calls,1);assert.equal(r.status,'SHADOW_RESEARCH_ONLY');
 assert.equal(r.risk.rewardRisk,3);assert.equal(r.risk.riskAmount,8);
 assert.equal(r.order,null);assert.equal(r.executionAllowed,false);
 assert.equal(p.report().analyzed,1);
});
test('missing higher timeframes never invokes model',async()=>{
 let called=false;
 const p=createShadowResearchPipeline({clock:()=>now,brain:{analyze:async()=>{called=true;}}});
 const {candlesM15,...notMulti}=demo;
 const r=await p.assess({snapshot:notMulti,proposal});
 assert.equal(called,false);assert.equal(r.status,'BLOCKED');
 assert.equal(r.phase,'MARKET_CONTEXT');
 assert.ok(r.reasons.includes('UNVERIFIED_CHART_CONTEXT'));
});
test('LIVE broker cannot invoke model',async()=>{
 let called=false;
 const p=createShadowResearchPipeline({clock:()=>now,brain:{analyze:async()=>{called=true;}}});
 const r=await p.assess({snapshot:{...demo,accountType:'LIVE'},proposal});
 assert.equal(r.phase,'DEMO_SENSOR');assert.equal(called,false);
});
test('AI WAIT decision blocks risk admission and keeps all order paths disabled',async()=>{
 const p=createShadowResearchPipeline({clock:()=>now,brain:{analyze:async()=>({
  status:'RESEARCH_ANALYSIS_ONLY',plan:{stance:'WAIT',confidence:1}})}});
 const r=await p.assess({snapshot:demo,proposal});
 assert.equal(r.status,'BLOCKED');
 assert.ok(r.reasons.includes('AI_HYPOTHESIS_NOT_ALIGNED'));
 assert.equal(r.order,null);assert.equal(r.risk.lotSize,null);
});
test('delayed news blocks AI analysis',async()=>{
 let called=false;
 const p=createShadowResearchPipeline({clock:()=>now,brain:{analyze:async()=>{called=true;}}});
 const r=await p.assess({snapshot:demo,proposal,news:{classification:'DELAYED'}});
 assert.equal(r.status,'BLOCKED');assert.equal(called,false);
 assert.ok(r.reasons.includes('NEWS_RESEARCH_ONLY'));
});
