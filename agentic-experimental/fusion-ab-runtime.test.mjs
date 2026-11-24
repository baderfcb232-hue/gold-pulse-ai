import test from 'node:test';
import assert from 'node:assert/strict';
import {createFusionRuntime} from './fusion-ab-runtime.mjs';
const result=stance=>({status:'RESEARCH_ANALYSIS_ONLY',plan:{stance,confidence:0.8}});
test('comparison is off by default and never trades',()=>{
 const x=createFusionRuntime();assert.equal(x.start({},Promise.resolve(result('WAIT'))),false);
 assert.equal(x.report().ordersCreated,0);assert.equal(x.report().enabled,false);
});
test('bounded prospective pair uses identical context minus fusion, fresh matched future quote',async()=>{
 let t=1728000000,calls=0;
 const quote=()=>({symbol:'XAUUSD',accountType:'DEMO',environment:'EXPERIMENTAL_NABD_AGENTIC',brokerServer:'JustMarkets-Demo',brokerSymbol:'XAUUSD.m',accountLogin:42,timestamp:t,bid:100,ask:101});
 const ctx={symbol:'XAUUSD',accountType:'DEMO',feedType:'MT5_DEMO_BROKER',observedAt:t,candlesVerified:true,multiTimeframeVerified:true,fusionEvidence:{version:'V2'}};
 const x=createFusionRuntime({enabled:true,clock:()=>t,maxPerDay:1,quoteProvider:quote,brains:{XAUUSD:{analyze:async c=>{calls++;assert.equal(c.fusionEvidence,undefined);return result('WAIT')}}}});
 assert.equal(x.start(ctx,Promise.resolve(result('BUY_WATCH'))),true);
 assert.equal(x.start(ctx,Promise.resolve(result('BUY_WATCH'))),false);
 await new Promise(setImmediate);
 assert.equal(x.report().paired,1);assert.equal(calls,1);
 t+=3599;x.observe({...quote(),bid:110,ask:111});assert.equal(x.report().scored,0);
 t++;x.observe({...quote(),accountLogin:43,bid:110,ask:111});assert.equal(x.report().scored,0);
 x.observe({...quote(),bid:110,ask:111});assert.equal(x.report().scored,1);
 assert.equal(x.report().markets.XAUUSD.fusion.hits,1);assert.equal(x.report().markets.XAUUSD.baseline.wait,1);
 assert.equal(x.start({...ctx,observedAt:t},Promise.resolve(result('BUY_WATCH'))),false);
 assert.equal(x.report().ordersCreated,0);
});
