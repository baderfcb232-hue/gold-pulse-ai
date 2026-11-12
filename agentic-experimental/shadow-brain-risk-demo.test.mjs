import test from 'node:test';
import assert from 'node:assert/strict';
import {validateResearchContext,validateAnalysisPlan,createResearchBrain} from './research-brain.mjs';
import {reviewShadowRisk} from './shadow-risk-engine.mjs';
import {validateIsolatedDemoSnapshot,demoSensorReadiness} from './mt5-demo-sensor.mjs';
const now=1800000000;
const context={symbol:'XAUUSD',feedType:'MT5_DEMO_BROKER',observedAt:now-1,
 bid:4100,ask:4100.3,spreadLimit:1,candlesVerified:true,multiTimeframeVerified:true,
 news:{classification:'REALTIME',authorized:true,releaseTimeVerified:true,
 preReleaseForecastCaptured:true},accountType:'DEMO'};
const plan={stance:'BUY_WATCH',confidence:0.7,thesis:'Test upward reaction',
 counterThesis:'Dollar strength could reverse price',evidence:['demo context verified'],
 invalidation:'Price breaks below reference level',riskNotes:'Spread can widen',
 timeHorizonMinutes:5};
test('brain rejects Binance or indicative gold instead of treating it as broker evidence',()=>{
 const r=validateResearchContext({...context,feedType:'BINANCE_SPOT_BTCUSDT_REFERENCE_ONLY'},now);
 assert.equal(r.status,'BLOCKED');
 assert.ok(r.reasons.includes('BROKER_PRICE_SOURCE_REQUIRED'));
});
test('unverified news and old broker quote block analysis',()=>{
 const r=validateResearchContext({...context,observedAt:now-10,
 news:{classification:'REALTIME',authorized:false}},now);
 assert.ok(r.reasons.includes('BROKER_MARKET_CONTEXT_STALE'));
 assert.ok(r.reasons.includes('UNVERIFIED_LIVE_NEWS'));
});
test('well-formed AI analysis is strictly nonexecuting',()=>{
 const r=validateAnalysisPlan(plan);
 assert.equal(r.stance,'BUY_WATCH');assert.equal(r.signal,'WAIT');
 assert.equal(r.executionPermission,false);
 assert.throws(()=>validateAnalysisPlan({...plan,confidence:1.5}),/AI_PLAN_INVALID/);
});
test('model invocation is grounded, non-stored and structured',async()=>{
 const requests=[];
 const brain=createResearchBrain({key:'unit-test',clock:()=>now,fetcher:async(u,options)=>{
   requests.push({u,options});
   return {ok:true,json:async()=>({status:'completed',
     output:[{content:[{type:'output_text',text:JSON.stringify(plan)}]}]})};
 }});
 const r=await brain.analyze(context);
 assert.equal(r.status,'RESEARCH_ANALYSIS_ONLY');
 assert.equal(r.tradeAllowed,false);assert.equal(r.order,null);
 assert.equal(requests.length,1);
 const body=JSON.parse(requests[0].options.body);
 assert.equal(body.store,false);assert.equal(body.text.format.type,'json_schema');
});
test('no AI key is fail closed',async()=>{
 const r=await createResearchBrain({key:'',clock:()=>now}).analyze(context);
 assert.deepEqual(r.reasons,['AI_API_KEY_MISSING']);
});
test('risk verifies spread, R:R, alignment without inventing lot sizes',()=>{
 const result=reviewShadowRisk({symbol:'XAUUSD',side:'BUY',accountType:'DEMO',
  balance:2000,riskPercent:0.4,entry:4100,stop:4095,target:4115,
  spread:0.3,spreadLimit:1,quoteAgeSeconds:1,modelPlan:plan});
 assert.equal(result.status,'SHADOW_RISK_ACCEPTABLE');
 assert.equal(result.riskAmount,8);assert.equal(result.rewardRisk,3);
 assert.equal(result.lotSize,null);assert.equal(result.executionAllowed,false);
});
test('risk rejects wrong account, spread, stale quotes and unaligned plan',()=>{
 const r=reviewShadowRisk({symbol:'BTCUSD',side:'SELL',accountType:'LIVE',
  balance:2000,riskPercent:1,entry:100,stop:101,target:99,
  spread:4,spreadLimit:2,quoteAgeSeconds:10,modelPlan:plan});
 assert.ok(r.reasons.includes('DEMO_ONLY'));
 assert.ok(r.reasons.includes('RISK_CAP_EXCEEDED'));
 assert.ok(r.reasons.includes('AI_HYPOTHESIS_NOT_ALIGNED'));
 assert.equal(r.executionAllowed,false);
});
const candle=(time)=>({time,open:100,high:101,low:99,close:100.4});
const sample={environment:'EXPERIMENTAL_NABD_AGENTIC',accountType:'DEMO',
 executionEnabled:false,symbol:'BTCUSD',brokerServer:'JustMarkets-Demo',
 timestamp:now-1,bid:100,ask:100.1,tickSize:0.01,tickValue:1,
 contractSize:1,candlesM5:[candle(now-600),candle(now-300)]};
test('isolated MT5 DEMO sensor validates data but never emits an order',()=>{
 const r=validateIsolatedDemoSnapshot(sample,now);
 assert.equal(r.status,'VALIDATED_RESEARCH_SENSOR');
 assert.equal(r.ordersSupported,false);assert.equal(r.safe.accountType,'DEMO');
 assert.equal(demoSensorReadiness().brokerConnected,false);
});
test('production MT5 and unverified demo payload are rejected',()=>{
 assert.equal(validateIsolatedDemoSnapshot({...sample,accountType:'LIVE'},now).status,'REJECTED');
 assert.equal(validateIsolatedDemoSnapshot({...sample,brokerServer:'JustMarkets-Live'},now).status,'REJECTED');
 assert.equal(validateIsolatedDemoSnapshot({...sample,timestamp:now-30},now).status,'REJECTED');
});

test('M5 observation rejects an open or unordered candle and malformed bar',()=>{
 const openBar={...candle(now-299)};
 const unclosed=validateIsolatedDemoSnapshot({...sample,candlesM5:[candle(now-600),openBar]},now);
 assert.equal(unclosed.status,'REJECTED');
 assert.ok(unclosed.errors.includes('INVALID_DEMO_CANDLES'));
 const unordered=validateIsolatedDemoSnapshot({...sample,candlesM5:[candle(now-300),candle(now-600)]},now);
 assert.equal(unordered.status,'REJECTED');
 const malformed=validateIsolatedDemoSnapshot({...sample,candlesM5:[null,candle(now-300)]},now);
 assert.equal(malformed.status,'REJECTED');
});
