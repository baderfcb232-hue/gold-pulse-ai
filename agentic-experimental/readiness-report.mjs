// Aggregated experimental readiness. A connected model is not a trained trading analyst.
export function buildExperimentReadiness({bls={},fred={},brain={},demo={},journal={},smoke={},
 fxStreetAuthorized=false,officialReleaseVerified=false}={}){
 const steps=[
  {id:'HISTORICAL_ECONOMIC_DATA',status:bls.status==='OBSERVING'?'BLS_DIRECT_READY':fred.status==='OBSERVING_HISTORICAL'?'FRED_REFERENCE_READY':'BLOCKED',
   source:bls.status==='OBSERVING'?'BLS_PUBLIC_DATA_API':fred.status==='OBSERVING_HISTORICAL'?'FRED_BLS_HISTORICAL_REFERENCE':null,
   reason:bls.status==='OBSERVING'?null:fred.status==='OBSERVING_HISTORICAL'?'BLS_DIRECT_UNAVAILABLE_USING_HISTORICAL_REFERENCE':bls.lastError||fred.lastError||'NO_HISTORICAL_SOURCE'},
  {id:'AI_RESEARCH_PLANNER',status:brain.status==='READY_FOR_VERIFIED_DEMO_CONTEXT'?'CODE_READY':'BLOCKED',
   reason:brain.status==='READY_FOR_VERIFIED_DEMO_CONTEXT'?'NOT_RUN_ON_REAL_DEMO_MARKET':'AI_KEY_NOT_CONFIGURED'},
  {id:'DEMO_BROKER_SENSOR',status:demo.brokerConnected===true?'READY':'BLOCKED',
   reason:demo.brokerConnected===true?null:'NO_ISOLATED_MT5_DEMO_CONNECTION'},
  {id:'SHADOW_PIPELINE',status:smoke.status==='SYNTHETIC_SELF_TEST_PASSED'?'SYNTHETIC_TEST_PASS':'BLOCKED',
   reason:smoke.status==='SYNTHETIC_SELF_TEST_PASSED'?'NOT_REAL_BROKER_OR_OPENAI_EXECUTION':'SELF_TEST_NOT_PASSING'},
  {id:'ISOLATED_POSTGRES',status:journal.persistenceConnected===true?'READY':'BLOCKED',
   reason:journal.persistenceConnected===true?null:'RESEARCH_JOURNAL_DISCONNECTED'},
  {id:'FXSTREET_LIVE_NEWS',status:fxStreetAuthorized&&officialReleaseVerified?'PENDING_LIVE_TEST':'BLOCKED',
   reason:fxStreetAuthorized&&officialReleaseVerified?'FIRST_RELEASE_LATENCY_NOT_TESTED':'AWAITING_PROVIDER_LICENSE_AND_TIMING'}
 ];
 const blockers=steps.filter(s=>s.status==='BLOCKED').map(s=>s.id);
 return {status:'EXPERIMENTAL_NOT_TRADE_READY',steps,blockers,
  codeDeployed:true,productionChanged:false,liveTradeAllowed:false,
  demoTradeAllowed:false,ordersCreated:0,
  notice:'Synthetic testing and model connectivity never authorize market orders'};
}
