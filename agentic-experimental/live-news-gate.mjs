// Strict news execution readiness gate. Research-only; NO order routes and NO trades.
// Never infer publication latency from official RSS pubDate, vendor LastUpdate or delayed calendars.
const validTime=x=>Number.isSafeInteger(x)&&x>0;
export function assessLiveNewsOpportunity({
 now,scheduledAt,forecastObservedAt,actualFirstObservedAt,officialReleaseAt,
 forecast,actual,providerLatencyVerified=false,providerAllowedForRealtime=false,
 brokerQuoteAt,brokerSymbolVerified=false,brokerSpread,brokerMaxSpread,
 brokerCandlesVerified=false,postReleasePriceReactionVerified=false,
 aiDecisionValidated=false,accountDemo=false,newsExecutionApproved=false,
 alreadyProcessed=false
}={}){
 const reasons=[];
 if(!validTime(now)||!validTime(scheduledAt)||scheduledAt>now+30)
  reasons.push('INVALID_EVENT_TIME');
 if(!validTime(forecastObservedAt)||!validTime(scheduledAt)||forecastObservedAt>=scheduledAt)
  reasons.push('NO_PRE_RELEASE_FORECAST');
 if(typeof forecast!=='number'||!Number.isFinite(forecast)||
    typeof actual!=='number'||!Number.isFinite(actual))reasons.push('MISSING_COMPARABLE_VALUES');
 if(!providerAllowedForRealtime)reasons.push('REALTIME_PROVIDER_NOT_LICENSED');
 if(!providerLatencyVerified||!validTime(officialReleaseAt))
  reasons.push('OFFICIAL_RELEASE_LATENCY_UNVERIFIED');
 if(!validTime(actualFirstObservedAt)||!validTime(officialReleaseAt)||
    actualFirstObservedAt<officialReleaseAt||actualFirstObservedAt>now||
    actualFirstObservedAt-officialReleaseAt>5)
  reasons.push('ACTUAL_NOT_VERIFIED_WITHIN_5_SECONDS');
 if(!brokerSymbolVerified||!validTime(brokerQuoteAt)||!validTime(now)||
    brokerQuoteAt>now||now-brokerQuoteAt>2)
  reasons.push('BROKER_QUOTE_NOT_FRESH');
 if(!Number.isFinite(brokerSpread)||!Number.isFinite(brokerMaxSpread)||
    brokerMaxSpread<=0||brokerSpread<0||brokerSpread>brokerMaxSpread)
  reasons.push('BROKER_SPREAD_UNSAFE');
 if(!brokerCandlesVerified||!postReleasePriceReactionVerified)
  reasons.push('PRICE_REACTION_UNVERIFIED');
 if(!aiDecisionValidated)reasons.push('AI_PLAN_NOT_VALIDATED');
 if(!accountDemo)reasons.push('DEMO_ACCOUNT_REQUIRED');
 if(!newsExecutionApproved)reasons.push('NEWS_AUTOTRADE_NOT_APPROVED');
 if(alreadyProcessed)reasons.push('DUPLICATE_EVENT');
 // This component is shadow-only; even a complete input cannot grant execution.
 return {status:reasons.length?'BLOCKED':'SHADOW_RESEARCH_READY',
  reasons,signal:'WAIT',wouldExecute:false,orderPermitted:false,
  tradeExecutionEnabled:false,simulationOnly:true,
  // reported for diagnostics only; must NOT be passed to MT5 or order bridges
  conditionsMet:reasons.length===0};
}
export function liveNewsSystemStatus({
 journalConnected=false,calendarKeyConfigured=false,
 realtimeFeedVerified=false,officialReleaseTimestampVerified=false,
 preReleaseForecastCaptured=false,brokerFeedVerified=false,
 tradeExecutionEnabled=false}={}){
 const blockers=[];
 if(!journalConnected)blockers.push('ISOLATED_JOURNAL_DISCONNECTED');
 if(!calendarKeyConfigured)blockers.push('CONSENSUS_PROVIDER_NOT_CONFIGURED');
 if(!realtimeFeedVerified)blockers.push('LOW_LATENCY_NEWS_FEED_NOT_VERIFIED');
 if(!officialReleaseTimestampVerified)blockers.push('FIRST_RELEASE_TIMESTAMP_UNVERIFIED');
 if(!preReleaseForecastCaptured)blockers.push('NO_LIVE_PRE_RELEASE_FORECAST_OBSERVATION');
 if(!brokerFeedVerified)blockers.push('BROKER_SPECIFIC_PRICE_FEED_NOT_VERIFIED');
 // Even all green means only shadow data readiness, not execution authority.
 return {status:blockers.length?'BLOCKED':'SHADOW_DATA_READY',
  blockers,signal:'WAIT',liveTradingEnabled:false,
  demoNewsExecutionEnabled:false,shadowMode:true,
  tradingEnabled:false};
}
