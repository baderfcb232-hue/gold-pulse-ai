import test from 'node:test';
import assert from 'node:assert/strict';
import {runSyntheticShadowSmoke} from './shadow-smoke.mjs';
test('end-to-end synthetic monitor passes only with all fail-closed controls',async()=>{
 const v=await runSyntheticShadowSmoke({now:1800000000});
 assert.equal(v.status,'SYNTHETIC_SELF_TEST_PASSED');
 assert.equal(v.cases.syntheticDemoScenario,'SHADOW_RESEARCH_ONLY');
 assert.equal(v.cases.liveAccountRejected,true);
 assert.equal(v.cases.missingM15Rejected,true);
 assert.equal(v.cases.delayedNewsRejected,true);
 assert.equal(v.syntheticDataOnly,true);
 assert.equal(v.orderExecutionSupported,false);
 assert.equal(v.realAINewsAnalysisTested,false);
});
