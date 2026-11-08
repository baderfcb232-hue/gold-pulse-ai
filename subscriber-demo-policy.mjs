/** Phase 13: pure, fail-closed Demo subscriber command policy.
 * No order submission, network access, credential storage, or API wiring.
 * Inputs MUST be server-verified; callers MUST enforce atomic DB deduplication.
 */
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SIGNAL=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const NONCE=/^[A-Za-z0-9_-]{16,128}$/;
const deny=reason=>Object.freeze({allowed:false,reason});
const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const integer=x=>Number.isSafeInteger(x)&&x>=0;
export function authorizeSubscriberDemoCommand({account,grant,worker,signal,risk,nowMs}={}){
 if(!Number.isSafeInteger(nowMs)||nowMs<=0)return deny('CLOCK_INVALID');
 if(!account||!grant||!worker||!signal||!risk)return deny('INCOMPLETE_EVIDENCE');
 if(!UUID.test(account.id||'')||!UUID.test(grant.accountId||'')||!UUID.test(worker.accountId||''))return deny('IDENTITY_INVALID');
 if(account.id!==grant.accountId||account.id!==worker.accountId)return deny('ACCOUNT_MISMATCH');
 if(account.deleted===true||account.enabled!==true||account.environment!=='demo'||account.broker!=='JustMarkets')return deny('ACCOUNT_NOT_DEMO_ACTIVE');
 if(grant.authorized!==true||grant.revoked===true||grant.scope!=='demo-execute'||!integer(grant.expiresAtMs)||nowMs>=grant.expiresAtMs)return deny('GRANT_NOT_ACTIVE');
 if(!account.ownerId||typeof account.ownerId!=='string'||grant.ownerId!==account.ownerId)return deny('OWNER_MISMATCH');
 if(worker.authorized!==true||worker.monitoringOnly===true||worker.environment!=='demo'||worker.connected!==true)return deny('EXECUTION_WORKER_NOT_READY');
 if(worker.login!==account.login||worker.server!==account.server||worker.broker!==account.broker)return deny('BROKER_IDENTITY_MISMATCH');
 if(risk.paused!==false||risk.emergencyStop!==false||risk.allowNewPositions!==true)return deny('RISK_STOP');
 if(!positive(risk.maxRiskPct)||risk.maxRiskPct>1||!positive(risk.requestedRiskPct)||risk.requestedRiskPct>risk.maxRiskPct)return deny('RISK_LIMIT');
 if(!integer(risk.openPositions)||!integer(risk.maxOpenPositions)||risk.maxOpenPositions>20||risk.openPositions>=risk.maxOpenPositions)return deny('POSITION_LIMIT');
 if(!SIGNAL.test(signal.id||'')||!NONCE.test(signal.nonce||''))return deny('SIGNAL_INVALID');
 if(signal.accountId!==account.id||signal.symbol!==risk.symbol||!['BUY','SELL'].includes(signal.side))return deny('SIGNAL_SCOPE_MISMATCH');
 if(!integer(signal.issuedAtMs)||!integer(signal.expiresAtMs)||signal.issuedAtMs>nowMs+1000||signal.expiresAtMs<=nowMs||signal.expiresAtMs-signal.issuedAtMs>30000)return deny('SIGNAL_EXPIRED');
 if(!positive(signal.entry)||!positive(signal.sl)||!positive(signal.tp))return deny('PRICE_INVALID');
 if(signal.side==='BUY'&&!(signal.sl<signal.entry&&signal.entry<signal.tp))return deny('PRICE_INVALID');
 if(signal.side==='SELL'&&!(signal.tp<signal.entry&&signal.entry<signal.sl))return deny('PRICE_INVALID');
 // This is a suggested key, NOT an atomic reservation.
 return Object.freeze({allowed:true,reason:'DEMO_POLICY_OK',dedupeKey:account.id+':'+signal.id});
}
