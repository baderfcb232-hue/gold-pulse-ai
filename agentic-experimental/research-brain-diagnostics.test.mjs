import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyResearchFailure,createResearchBrain} from './research-brain.mjs';

test('AI failure reasons stay bounded and secret-free',()=>{
 const cases=[
  [new Error('AI_HTTP_429'),'AI_RATE_LIMITED'],
  [new Error('AI_HTTP_401'),'AI_AUTH_FAILED'],
  [new Error('AI_HTTP_503'),'AI_PROVIDER_UNAVAILABLE'],
  [new Error('AI_INCOMPLETE_RESPONSE'),'AI_INCOMPLETE_RESPONSE'],
  [new Error('AI_EMPTY_RESPONSE'),'AI_EMPTY_RESPONSE'],
  [new SyntaxError('invalid private payload'),'AI_RESPONSE_INVALID'],
  [Object.assign(new Error('request timed out'),{name:'TimeoutError'}),'AI_REQUEST_TIMEOUT'],
  [new Error('secret token abc'),'AI_ANALYSIS_FAILED']
 ];
 for(const [error,reason] of cases)assert.equal(classifyResearchFailure(error),reason);
});

test('failed model call returns diagnosable reason without sending an order or leaking API text',async()=>{
 const now=1800000000;
 const ctx={symbol:'XAUUSD',feedType:'MT5_DEMO_BROKER',observedAt:now-1,
  bid:100,ask:100.2,spreadLimit:2.5,candlesVerified:true,
  multiTimeframeVerified:true,accountType:'DEMO',news:{classification:'NONE'}};
 const brain=createResearchBrain({key:'not-real-test-key',clock:()=>now,
  fetcher:async()=>({ok:false,status:429})});
 const result=await brain.analyze(ctx);
 assert.deepEqual(result.reasons,['AI_RATE_LIMITED']);
 assert.equal(result.order,null);
 assert.equal(result.tradeAllowed,false);
 assert.equal(brain.report().lastError,'AI_RATE_LIMITED');
 assert.equal(brain.report().blocked,1);
});
