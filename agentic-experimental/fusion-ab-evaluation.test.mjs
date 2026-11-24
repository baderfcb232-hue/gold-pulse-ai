import test from 'node:test';
import assert from 'node:assert/strict';
import {compareFusionPair,scoreFusionPairs} from './fusion-ab-evaluation.mjs';
const t=1728000000;
const bars=(duration,n)=>Array.from({length:n},(_,i)=>({time:t-(n-i)*duration,open:100+i,close:100.5+i,high:101+i,low:99+i}));
const snapshot={environment:'EXPERIMENTAL_NABD_AGENTIC',accountType:'DEMO',executionEnabled:false,symbol:'XAUUSD',brokerServer:'JustMarkets-Demo',timestamp:t,bid:200,ask:200.1,tickSize:0.01,tickValue:1,contractSize:100,candlesM5:bars(300,220),candlesM15:bars(900,60),candlesH1:bars(3600,60),candlesH4:bars(14400,60)};
const context={symbol:'XAUUSD',feedType:'MT5_DEMO_BROKER',accountType:'DEMO',candlesVerified:true,multiTimeframeVerified:true,observedAt:t,bid:200,ask:200.1};
test('paired replay changes only advisory evidence',async()=>{
 let a,b;const plan={status:'RESEARCH_ANALYSIS_ONLY',plan:{stance:'WAIT',confidence:0.6}};
 const r=await compareFusionPair({context,snapshot,baselineBrain:{analyze:async c=>{a=c;return plan}},fusionBrain:{analyze:async c=>{b=c;return plan}}});
 assert.equal(a.fusionEvidence,undefined);assert.equal(b.fusionEvidence.advisoryOnly,true);
 const {fusionEvidence,...rest}=b;assert.deepEqual(a,rest);assert.equal(r.executionAllowed,false);
 await assert.rejects(()=>compareFusionPair({context,snapshot:{...snapshot,executionEnabled:true}}),/UNVERIFIED_PAIR_CONTEXT/);
});
test('only paired verified future outcomes count; WAIT is not a hit',()=>{
 const row={symbol:'XAUUSD',observedAt:t,outcomeAt:t+3600,verifiedFutureBrokerOutcome:true,direction:'UP',baseline:{stance:'WAIT'},fusion:{stance:'BUY_WATCH'}};
 const r=scoreFusionPairs([row,row,{...row,observedAt:t+1,verifiedFutureBrokerOutcome:false}],{minimum:1}).markets.XAUUSD;
 assert.equal(r.paired,1);assert.equal(r.baseline.wait,1);assert.equal(r.baseline.hitRate,null);assert.equal(r.fusion.hitRate,1);
 assert.equal(scoreFusionPairs([row]).markets.XAUUSD.fusion.hitRate,null);
});
