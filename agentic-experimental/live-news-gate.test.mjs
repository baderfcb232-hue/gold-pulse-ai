import test from 'node:test';
import assert from 'node:assert/strict';
import {assessLiveNewsOpportunity,liveNewsSystemStatus} from './live-news-gate.mjs';
const now=1800000010,scheduledAt=1800000000;
const valid={now,scheduledAt,forecastObservedAt:scheduledAt-120,actualFirstObservedAt:scheduledAt+2,
 officialReleaseAt:scheduledAt,forecast:3.0,actual:3.2,providerLatencyVerified:true,
 providerAllowedForRealtime:true,brokerQuoteAt:now-1,brokerSymbolVerified:true,
 brokerSpread:20,brokerMaxSpread:30,brokerCandlesVerified:true,
 postReleasePriceReactionVerified:true,aiDecisionValidated:true,
 accountDemo:true,newsExecutionApproved:true,alreadyProcessed:false};
test('even perfect evidence never allows a trade (shadow only)',()=>{
 const d=assessLiveNewsOpportunity(valid);
 assert.equal(d.status,'SHADOW_RESEARCH_READY');
 assert.equal(d.conditionsMet,true);
 assert.equal(d.orderPermitted,false);assert.equal(d.wouldExecute,false);
 assert.equal(d.signal,'WAIT');
});
test('delayed event fails latency gate',()=>{
 const d=assessLiveNewsOpportunity({...valid,actualFirstObservedAt:scheduledAt+3600,now:scheduledAt+3601});
 assert.ok(d.reasons.includes('ACTUAL_NOT_VERIFIED_WITHIN_5_SECONDS'));
});
test('missing pre-release forecast fails',()=>{
 const d=assessLiveNewsOpportunity({...valid,forecastObservedAt:scheduledAt+1});
 assert.ok(d.reasons.includes('NO_PRE_RELEASE_FORECAST'));
});
test('stale quote or excessive spread fails',()=>{
 const d=assessLiveNewsOpportunity({...valid,brokerQuoteAt:now-4,brokerSpread:100});
 assert.ok(d.reasons.includes('BROKER_QUOTE_NOT_FRESH'));
 assert.ok(d.reasons.includes('BROKER_SPREAD_UNSAFE'));
});
test('unlicensed real-time feed never passes',()=>{
 const d=assessLiveNewsOpportunity({...valid,providerAllowedForRealtime:false,providerLatencyVerified:false});
 assert.ok(d.reasons.includes('REALTIME_PROVIDER_NOT_LICENSED'));
 assert.ok(d.reasons.includes('OFFICIAL_RELEASE_LATENCY_UNVERIFIED'));
});
test('duplicate event, no AI validation and no user approval fail',()=>{
 const d=assessLiveNewsOpportunity({...valid,alreadyProcessed:true,aiDecisionValidated:false,newsExecutionApproved:false});
 assert.ok(d.reasons.includes('DUPLICATE_EVENT'));
 assert.ok(d.reasons.includes('AI_PLAN_NOT_VALIDATED'));
 assert.ok(d.reasons.includes('NEWS_AUTOTRADE_NOT_APPROVED'));
});
test('system status clearly identifies current blockers',()=>{
 const s=liveNewsSystemStatus({journalConnected:true,calendarKeyConfigured:false});
 assert.equal(s.status,'BLOCKED');
 assert.ok(s.blockers.includes('CONSENSUS_PROVIDER_NOT_CONFIGURED'));
 assert.equal(s.liveTradingEnabled,false);
 assert.equal(s.demoNewsExecutionEnabled,false);
});
test('even all prerequisites return shadow readiness only',()=>{
 const s=liveNewsSystemStatus({journalConnected:true,calendarKeyConfigured:true,
  realtimeFeedVerified:true,officialReleaseTimestampVerified:true,
  preReleaseForecastCaptured:true,brokerFeedVerified:true});
 assert.equal(s.status,'SHADOW_DATA_READY');
 assert.equal(s.tradingEnabled,false);
});
