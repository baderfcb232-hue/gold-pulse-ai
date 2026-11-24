import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptiveStopPlan,smartExit} from './adaptive-exit.mjs';
test('adaptive stop retains 3R and .4 percent risk, rejects distant structure',()=>{
 const p=adaptiveStopPlan({side:'BUY',entry:100,atr:2,spread:.1,structure:97,regime:'TREND_UP'});
 assert.equal(p.action,'RESEARCH_PLAN');assert.equal(p.riskPct,.4);assert.equal(p.rewardRisk,3);
 assert.equal(p.target-p.entry,3*(p.entry-p.stop));assert.equal(p.executionPermission,false);
 assert.equal(adaptiveStopPlan({side:'BUY',entry:100,atr:2,spread:.1,structure:90,regime:'TREND_UP'}).reason,'STOP_TOO_DISTANT');
 assert.equal(adaptiveStopPlan({side:'BUY',entry:100,atr:2,spread:.1,structure:97,regime:'TREND_DOWN'}).reason,'TREND_CONFLICT');
});
const base={side:'BUY',entry:100,initialStop:98,currentStop:98,target:106,quote:103.2,atr:1,volume:.04,minVolume:.01,volumeStep:.01,breakEvenBuffer:.1,brokerMinDistance:.1};
test('partial only at half target and trail only after confirmed partial',()=>{
 assert.equal(smartExit({...base,quote:102.9}).reason,'BELOW_HALF_TARGET');
 const p=smartExit(base);assert.equal(p.action,'RESEARCH_PARTIAL_THEN_PROTECT');assert.equal(p.closeVolume,.02);
 assert.equal(p.stopAfterConfirmedFill,100.1);assert.equal(p.executionPermission,false);
 const t=smartExit({...base,partialConfirmed:true,currentStop:100.1,volume:.02});assert.equal(t.action,'RESEARCH_TIGHTEN_STOP');assert.equal(t.stop,101.7);
 assert.equal(smartExit({...base,partialConfirmed:true,currentStop:102}).reason,'NO_TIGHTER_STOP');
 assert.equal(smartExit({...base,currentStop:97}).reason,'INVALID_OR_WIDENED_INITIAL_RISK');
 assert.equal(smartExit({...base,volume:.01}).reason,'PARTIAL_VOLUME_UNSUPPORTED');
});
test('sell mirrored stop and broker distance protection',()=>{
 const b={...base,side:'SELL',entry:100,initialStop:102,currentStop:102,target:94,quote:96.8};
 assert.equal(smartExit(b).stopAfterConfirmedFill,99.9);
 assert.equal(smartExit({...b,partialConfirmed:true,currentStop:99.9}).stop,98.3);
 assert.equal(smartExit({...b,brokerMinDistance:5}).reason,'BROKER_DISTANCE_GUARD');
});
