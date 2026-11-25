import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createDemoTradeIntents} from './demo-trade-intents.mjs';
const now=1800000000,secret='test-execution-only-32-byte-secret-12345';
const sha=x=>createHmac('sha256',secret).update(x).digest('hex');
const full=(sym='XAUUSD')=>({environment:'EXPERIMENTAL_NABD_AGENTIC',accountType:'DEMO',
 brokerServer:'Independent-JustMarkets-Demo',brokerSymbol:sym==='BTCUSD'?'BTCUSD.m':'XAUUSD.m',accountLogin:1234567,timestamp:now-1,bid:100,ask:100.2,tickSize:0.01,
 candlesM5:[{time:now-300}]});
const features=Object.fromEntries(['M5','M15','H1','H4'].map(tf=>[tf,{
 status:'INDICATORS_AVAILABLE',emaDirection:'UP',
 lastClose:100,ema200:90,ema200Verified:true,rsi14:60,atr14:2}]));
const watch={stance:'BUY_WATCH',confidence:0.88};
const proposal={symbol:'XAUUSD',plan:watch,features,closedBarTime:now-300};
const signed=(payload)=>{const body=JSON.stringify(payload);return {body,
 timestamp:String(now),mac:sha(now+'\n'+body),secure:true}};
const pull=signed({source:'ISOLATED_DEMO_TRADE_EXECUTOR',accountType:'DEMO',
 accountLogin:1234567,brokerServer:'Independent-JustMarkets-Demo',
 symbols:['XAUUSD','BTCUSD'],brokerSymbols:{XAUUSD:'XAUUSD.m',BTCUSD:'BTCUSD.m'},capturedAt:now});
function create(options={}){
 return createDemoTradeIntents({enabled:true,secret,clock:()=>now,
 quoteProvider:sym=>full(sym),...options});
}
test('model WATCH + deep verified trend creates single expiry-bound signed DEMO intent',()=>{
 const d=create();
 assert.equal(d.consider(proposal).created,true);
 const result=d.pull(pull);
 assert.equal(result.status,'INTENT_DELIVERED');
 const parts=result.wire.split('|');
 assert.equal(parts.length,14);
 assert.equal(parts[0],'V1');assert.equal(parts[2],'XAUUSD');
 assert.equal(parts[3],'BUY');
 assert.equal(Number(parts[4]),now-300);
 assert.equal(Number(parts[6]),now+20);
 assert.equal(Number(parts[10]),0.4);
 assert.equal(sha(parts.slice(0,-1).join('|')),parts.at(-1));
 assert.equal(d.pull(pull).wire,null);
 assert.equal(d.consider(proposal).reason,'DUPLICATE_M5_INTENT');
 assert.equal(d.report().created,1);
 assert.equal(d.report().filledAcks,0);
 assert.equal(d.report().serverPlacesOrders,false);
 assert.equal(d.report().liveTrading,false);
});
test('unsigned request, forged LIVE accounts and changed demo login are denied',()=>{
 const d=create();
 assert.equal(d.consider(proposal).created,true);
 assert.equal(d.pull({...pull,mac:'f'.repeat(64)}).status,'REJECTED');
 const live=signed({...JSON.parse(pull.body),accountType:'LIVE'});
 assert.equal(d.pull(live).status,'REJECTED');
 assert.equal(d.pull(pull).status,'INTENT_DELIVERED');
 const other=signed({...JSON.parse(pull.body),accountLogin:222});
 assert.equal(d.pull(other).status,'WRONG_DEMO_ACCOUNT');
});
test('risk gate rejects WAIT, low confidence, missing indicators, trend conflict, stale price and large spread',()=>{
 assert.equal(create().consider({...proposal,plan:{stance:'WAIT',confidence:1}}).reason,'NO_AI_WATCH');
 assert.equal(create().consider({...proposal,plan:{...watch,confidence:0.7}}).reason,'LOW_CONFIDENCE');
 assert.equal(create().consider({...proposal,features:{...features,M5:{...features.M5,ema200Verified:false}}}).reason,'HISTORY_NOT_VERIFIED');
 assert.equal(create().consider({...proposal,features:{...features,H1:{...features.H1,emaDirection:'DOWN'}}}).reason,'TREND_CONFLICT');
 assert.equal(create({quoteProvider:()=>({...full(),timestamp:now-10})}).consider(proposal).reason,'STALE_BROKER_QUOTE');
 assert.equal(create({quoteProvider:()=>({...full(),ask:103})}).consider(proposal).reason,'SPREAD_LIMIT');
 assert.equal(create({quoteProvider:()=>({...full(),accountType:'LIVE'})}).consider(proposal).reason,'UNVERIFIED_BROKER');
});
test('expired intents are dropped without retry or a remotely generated order',()=>{
 let tick=now;
 const d=create({clock:()=>tick,quoteProvider:sym=>({...full(sym),timestamp:tick-1})});
 assert.equal(d.consider(proposal).created,true);
 tick+=21;
 assert.equal(d.pull({...pull, timestamp:String(tick),mac:sha(tick+'\n'+pull.body)}).status,'REJECTED');
 const refreshed=signed({...JSON.parse(pull.body),capturedAt:now+21});
 const payload=refreshed.body;const req={...refreshed,timestamp:String(tick),mac:sha(tick+'\n'+payload)};
 assert.equal(d.pull(req).status,'NO_INTENT');
 assert.equal(d.report().delivered,0);
});
test('audit ACK is signed, bound to selected DEMO account and idempotent',()=>{
 const d=create();d.consider(proposal);d.pull(pull);
 const body={id:'XAUUSD-'+(now-300),status:'FILLED',accountType:'DEMO',
 accountLogin:1234567,occurredAt:now};
 assert.equal(d.ack({...signed(body),mac:'0'.repeat(64)}).status,'REJECTED');
 assert.equal(d.ack(signed({...body,accountType:'LIVE'})).status,'REJECTED');
 assert.equal(d.ack(signed(body)).status,'RECORDED');
 assert.equal(d.ack(signed(body)).status,'DUPLICATE');
 assert.equal(d.report().filledAcks,0);
 assert.equal(d.report().eaUnverifiedFillClaims,1);
 assert.equal(d.report().brokerIndependentlyVerifiedFills,0);
});
test('false, missing execution flag or key never issues commands',()=>{
 assert.equal(createDemoTradeIntents({enabled:false,secret,clock:()=>now,
 quoteProvider:full}).consider(proposal).created,false);
 assert.equal(createDemoTradeIntents({enabled:true,secret:'',clock:()=>now,
 quoteProvider:full}).consider(proposal).reason,'SECRET_NOT_CONFIGURED');
});

test('executorRegistered is historical; executorOnline requires recent authenticated polls',()=>{
 let t=now;
 const d=create({clock:()=>t,quoteProvider:sym=>({...full(sym),timestamp:t-1})});
 assert.equal(d.report().executorRegistered,false);
 assert.equal(d.report().executorOnline,false);
 assert.equal(d.pull(pull).status,'NO_INTENT');
 assert.equal(d.report().executorOnline,true);
 assert.ok(d.report().lastExecutorSeenAt);
 t+=16;
 assert.equal(d.report().executorRegistered,true);
 assert.equal(d.report().executorOnline,false);
 const refresh=signed({...JSON.parse(pull.body),capturedAt:t});
 assert.equal(d.pull({...refresh,timestamp:String(t),mac:sha(t+'\n'+refresh.body)}).status,'NO_INTENT');
 assert.equal(d.report().executorOnline,true);
});
test('authenticated executor heartbeat remains visible while sensor is offline without granting orders',()=>{
 const d=create({quoteProvider:()=>null});
 assert.equal(d.report().executorTransportOnline,false);
 const forged={...pull,mac:'0'.repeat(64)};
 assert.equal(d.pull(forged).status,'REJECTED');
 assert.equal(d.report().executorTransportOnline,false);
 assert.equal(d.pull(pull).status,'WAITING_FOR_SENSOR');
 const status=d.report();
 assert.equal(status.executorTransportOnline,true);
 assert.equal(status.executorOnline,false);
 assert.equal(status.executorRegistered,false);
 assert.equal(status.executorWaitingForSensor,1);
 assert.ok(status.lastAuthenticatedExecutorAt);
 assert.equal(status.delivered,0);
 assert.equal(status.brokerAcks,0);
});
test('foreign Demo broker account never receives a pending order',()=>{
 const d=create(); assert.equal(d.consider(proposal).created,true);
 const foreign=signed({...JSON.parse(pull.body),brokerServer:'OtherBroker-Demo'});
 assert.equal(d.pull(foreign).status,'BROKER_MISMATCH');
 assert.equal(d.report().brokerFeedMismatch,0);
 assert.equal(d.report().delivered,0);
 assert.equal(d.report().queued.length,1);
 assert.equal(d.pull(pull).status,'INTENT_DELIVERED');
});
test('an ACK with a validated deal reference is EA-reported, never independent broker proof',()=>{
 const d=create();d.consider(proposal);d.pull(pull);
 const body={id:'XAUUSD-'+(now-300),status:'FILLED',accountType:'DEMO',
   accountLogin:1234567,occurredAt:now,brokerDealTicket:102402,
   tradeRetcode:10009,executedVolume:0.02};
 assert.equal(d.ack(signed(body)).status,'RECORDED');
 assert.equal(d.report().filledAcks,1);
 assert.equal(d.report().eaUnverifiedFillClaims,0);
 assert.equal(d.report().brokerIndependentlyVerifiedFills,0);
});
test('an impossible ACK time cannot be accepted',()=>{
 const d=create();d.consider(proposal);d.pull(pull);
 const claim={id:'XAUUSD-'+(now-300),status:'FILLED',accountType:'DEMO',
   accountLogin:1234567,occurredAt:now-31};
 assert.equal(d.ack(signed(claim)).status,'REJECTED');
});

test('wrong demo account is refused before pinning executor or consuming orders',()=>{
 const d=create();
 assert.equal(d.consider(proposal).created,true);
 const wrong=signed({...JSON.parse(pull.body),accountLogin:999999});
 assert.equal(d.pull(wrong).status,'WRONG_DEMO_ACCOUNT');
 assert.equal(d.report().executorRegistered,false);
 assert.equal(d.pull(pull).status,'INTENT_DELIVERED');
});
test('legacy sensor without signed account may analyze, but cannot authorize a trade',()=>{
 const d=create({quoteProvider:()=>{const {accountLogin,...old}=full();return old}});
 assert.equal(d.consider(proposal).reason,'SENSOR_ACCOUNT_UNVERIFIED');
 assert.equal(d.pull(pull).status,'SENSOR_ACCOUNT_UNVERIFIED');
 assert.equal(d.report().executorRegistered,false);
});

test('a signed order is never routed to a mismatched MT5 symbol suffix',()=>{
 const d=create();
 assert.equal(d.consider(proposal).created,true);
 const bad=signed({...JSON.parse(pull.body),
   brokerSymbols:{XAUUSD:'XAUUSD',BTCUSD:'BTCUSD.m'}});
 assert.equal(d.pull(bad).status,'BROKER_SYMBOL_MISMATCH');
 assert.equal(d.report().delivered,0);
 assert.equal(d.pull(pull).status,'INTENT_DELIVERED');
});
test('time window allows ordinary 4-second observer cadence without permitting stale broker quotes',()=>{
 let t=now+5;
 const d=create({clock:()=>t});
 assert.equal(d.consider(proposal).created,true);
 const p=JSON.parse(pull.body);p.capturedAt=t;
 const body=JSON.stringify(p);
 const ok={body,timestamp:String(t),mac:sha(t+'\n'+body),secure:true};
 assert.equal(d.pull(ok).status,'INTENT_DELIVERED');
 t=now+7;
 const stale=create({clock:()=>t});
 assert.equal(stale.consider(proposal).reason,'STALE_BROKER_QUOTE');
});
test('expired unpulled Demo intent cannot permanently block the next M5 candle',()=>{
 let t=now;
 const mk=(bar)=>({...proposal,closedBarTime:bar});
 const d=create({clock:()=>t,quoteProvider:()=>({...full(),timestamp:t-1,
   candlesM5:[{time:t-300}]})});
 assert.equal(d.consider(mk(t-300)).created,true);
 t+=300;
 assert.equal(d.consider(mk(t-300)).created,true);
 assert.equal(d.report().created,2);
 assert.equal(d.report().queued.length,1);
});
test('uncertain broker response remains explicit rather than reported as a rejected order',()=>{
 const d=create();
 d.consider(proposal);
 d.pull(pull);
 const payload={id:'XAUUSD-'+(now-300),status:'UNCERTAIN',accountType:'DEMO',
   accountLogin:1234567,occurredAt:now};
 assert.equal(d.ack(signed(payload)).status,'RECORDED');
 assert.equal(d.report().uncertainBrokerResults,1);
 assert.equal(d.report().filledAcks,0);
});

test('Demo execution status reports per-market freshness without disclosing account identifiers',()=>{
 const d=create({quoteProvider:symbol=>symbol==='XAUUSD'?
  {...full('XAUUSD'),timestamp:now-1}:
  {...full('BTCUSD'),timestamp:now-7}});
 const report=d.report();
 assert.equal(report.sensorFreshness.XAUUSD.quoteFresh,true);
 assert.equal(report.sensorFreshness.BTCUSD.quoteFresh,false);
 assert.equal(report.sensorFreshness.BTCUSD.quoteAgeSeconds,7);
 assert.equal(report.sensorFreshness.XAUUSD.demoAccountVerified,true);
 assert.equal(JSON.stringify(report.sensorFreshness).includes('1234567'),false);
 assert.equal(report.brokerIndependentlyVerifiedFills,0);
});

test('a one-time executor pickup with missing ACK is observable, never silently called a fill or resent',()=>{
 let t=now;
 const d=create({clock:()=>t,quoteProvider:symbol=>({...full(symbol),timestamp:t-1})});
 assert.equal(d.consider(proposal).created,true);
 assert.equal(d.pull(pull).status,'INTENT_DELIVERED');
 assert.equal(d.report().unacknowledgedCount,1);
 assert.equal(d.report().overdueAckCount,0);
 assert.equal(d.report().recentDeliveries[0].deliveryState,'AWAITING_ACK');
 t+=46;
 const report=d.report();
 assert.equal(report.overdueAckCount,1);
 assert.equal(report.recentDeliveries[0].deliveryState,'ACK_OVERDUE');
 assert.equal(report.recentDeliveries[0].id,'XAUUSD-'+(now-300));
 assert.equal(report.brokerAcks,0);
 assert.equal(report.filledAcks,0);
 assert.equal(report.deliveryNeverRetried,true);
 assert.equal(report.liveTrading,false);
 const refreshed={...JSON.parse(pull.body),capturedAt:t};
 const body=JSON.stringify(refreshed);
 assert.equal(d.pull({body,timestamp:String(t),mac:sha(t+'\n'+body),secure:true}).status,'NO_INTENT');
 assert.equal(d.report().delivered,1);
});
test('proper signed Demo ACK reconciles one-time delivery without independent broker confirmation',()=>{
 const d=create();
 d.consider(proposal);
 assert.equal(d.pull(pull).status,'INTENT_DELIVERED');
 const ack={id:'XAUUSD-'+(now-300),status:'REJECTED',accountType:'DEMO',
  accountLogin:1234567,occurredAt:now};
 assert.equal(d.ack(signed(ack)).status,'RECORDED');
 const report=d.report();
 assert.equal(report.unacknowledgedCount,0);
 assert.equal(report.overdueAckCount,0);
 assert.equal(report.recentDeliveries[0].deliveryState,'ACK_RECEIVED');
 assert.equal(report.recentDeliveries[0].ackStatus,'EA_REPORTED_REJECTION');
 assert.equal(report.brokerIndependentlyVerifiedFills,0);
});

test('ACK diagnostics identify signed but invalid outcomes without modifying delivery or creating trades',()=>{
 const d=create();d.consider(proposal);d.pull(pull);
 const id='XAUUSD-'+(now-300);
 const base={id,status:'REJECTED',accountType:'DEMO',accountLogin:1234567,occurredAt:now};
 assert.equal(d.ack({...signed(base),mac:'0'.repeat(64)}).status,'REJECTED');
 assert.equal(d.ack(signed({...base,accountLogin:7654321})).status,'REJECTED');
 assert.equal(d.ack(signed({...base,id:'XAUUSD-999999999'})).status,'REJECTED');
 const pending=d.report();
 assert.equal(pending.brokerAcks,0);
 assert.equal(pending.unacknowledgedCount,1);
 assert.equal(pending.ackRejectCounts.ACK_SIGNATURE_INVALID,1);
 assert.equal(pending.ackRejectCounts.ACK_ACCOUNT_OR_OUTCOME_INVALID,1);
 assert.equal(pending.ackRejectCounts.ACK_DELIVERY_NOT_FOUND,1);
 assert.equal(pending.lastAckRejectReason,'ACK_DELIVERY_NOT_FOUND');
 assert.equal(JSON.stringify(pending.ackRejectCounts).includes('1234567'),false);
 assert.equal(d.ack(signed(base)).status,'RECORDED');
 assert.equal(d.report().unacknowledgedCount,0);
 assert.equal(d.report().serverPlacesOrders,false);
});

test('expired ACK envelope is diagnosed but cannot change the broker outcome',()=>{
 let t=now;
 const d=create({clock:()=>t,quoteProvider:symbol=>({...full(symbol),timestamp:t-1})});
 d.consider(proposal);d.pull(pull);
 t=now+12;
 const ackBody={id:'XAUUSD-'+(now-300),status:'UNCERTAIN',
  accountType:'DEMO',accountLogin:1234567,occurredAt:t};
 const stale=signed(ackBody);
 assert.equal(d.ack(stale).status,'REJECTED');
 assert.equal(d.report().ackRejectCounts.ACK_REQUEST_EXPIRED,1);
 assert.equal(d.report().brokerAcks,0);
 const freshBody=JSON.stringify(ackBody);
 const refreshed={body:freshBody,timestamp:String(t),mac:sha(t+'\n'+freshBody),secure:true};
 assert.equal(d.ack(refreshed).status,'RECORDED');
 assert.equal(d.report().uncertainBrokerResults,1);
});

test('rejected ACK emits only fixed reason code for durable operational tracing',()=>{
 const reasons=[];
 const d=create({onAckDiagnostic:reason=>reasons.push(reason)});
 d.consider(proposal);d.pull(pull);
 assert.equal(d.ack({...signed({id:'fake'}),mac:'0'.repeat(64)}).status,'REJECTED');
 assert.deepEqual(reasons,[],'untrusted traffic must not create durable audit rows');
 assert.equal(d.ack(signed({id:'fake'})).status,'REJECTED');
 assert.deepEqual(reasons,['ACK_DELIVERY_NOT_FOUND']);
 assert.equal(d.report().brokerAcks,0);
 assert.equal(d.report().filledAcks,0);
 assert.equal(d.report().deliveryNeverRetried,true);
});

test('independent signed Demo sensor History must match ACK ticket, broker identity and original SL/TP',()=>{
 const proofs=[],anchors=[];
 const d=create({onBrokerHistoryProof:proof=>proofs.push(proof),onLifecycleAnchor:a=>anchors.push(a)});
 assert.equal(d.consider(proposal).created,true);
 const pullResult=d.pull(pull);
 assert.equal(pullResult.status,'INTENT_DELIVERED');
 const parts=pullResult.wire.split('|');
 const broker={...full(),symbol:'XAUUSD',tickSize:0.01};
 const history={dealTicket:887122,orderTicket:99221,brokerSymbol:'XAUUSD.m',
  side:'BUY',entry:'IN',dealAt:now,volume:0.02,
  stop:Number(parts[8]),target:Number(parts[9])};
 const ack={id:'XAUUSD-'+(now-300),status:'FILLED',accountType:'DEMO',
  accountLogin:1234567,occurredAt:now,brokerDealTicket:887122,
  tradeRetcode:10009,executedVolume:0.02};
 assert.equal(d.observeBrokerHistory([history],broker).matched,0,
  'sensor history before signed executor ACK cannot prove a fill');
 assert.equal(d.ack(signed(ack)).status,'RECORDED');
 assert.equal(d.observeBrokerHistory([{...history,stop:history.stop+1}],broker).matched,0);
 assert.equal(d.observeBrokerHistory([{...history,side:'SELL'}],broker).matched,0);
 assert.equal(d.observeBrokerHistory([{...history,dealTicket:887123}],broker).matched,0);
 assert.equal(d.observeBrokerHistory([history],{...broker,accountLogin:99}).matched,0);
 assert.equal(d.observeBrokerHistory([history],broker).matched,1);
 assert.equal(d.observeBrokerHistory([history],broker).matched,0);
 assert.equal(d.report().mt5HistoryCrossCheckedFills,1);
 assert.equal(d.report().brokerIndependentlyVerifiedFills,0,
   'a same-terminal MT5 history read is not a broker-signed independent attestation');
 assert.equal(d.report().recentDeliveries[0].historyProof,'SIGNED_SENSOR_MT5_HISTORY_MATCH');
 assert.equal(anchors.length,1);assert.equal(anchors[0].dealTicket,887122);assert.equal(anchors[0].volume,.02);assert.match(anchors[0].feed,/^[a-f0-9]{64}$/);
 assert.deepEqual(proofs,[{intentId:ack.id,symbol:'XAUUSD',
  dealTicket:887122,observedAt:now}]);
});
test('a forged or missing Demo broker order SL/TP cannot establish execution proof',()=>{
 const d=create();
 d.consider(proposal);
 const wire=d.pull(pull).wire.split('|');
 d.ack(signed({id:'XAUUSD-'+(now-300),status:'FILLED',accountType:'DEMO',
  accountLogin:1234567,occurredAt:now,brokerDealTicket:9001,
  tradeRetcode:10009,executedVolume:0.02}));
 const base={dealTicket:9001,orderTicket:10002,brokerSymbol:'XAUUSD.m',
  side:'BUY',entry:'IN',dealAt:now,volume:0.02,stop:Number(wire[8]),
  target:Number(wire[9])};
 assert.equal(d.observeBrokerHistory([{...base,target:0}],{...full(),symbol:'XAUUSD'}).matched,0);
 assert.equal(d.observeBrokerHistory([{...base,entry:'OUT'}],{...full(),symbol:'XAUUSD'}).matched,0);
 assert.equal(d.observeBrokerHistory([base],{...full(),symbol:'XAUUSD'}).matched,1);
});

const heartbeatPayload={source:'ISOLATED_DEMO_EXECUTOR_HEARTBEAT',version:'1.25',accountType:'DEMO',accountLogin:1234567,brokerServer:'Independent-JustMarkets-Demo',brokerSymbols:{XAUUSD:'XAUUSD.m',BTCUSD:'BTCUSD.m'},capturedAt:now,armed:false};
const hb=(payload=heartbeatPayload,ts=now)=>{const body=JSON.stringify(payload);return {body,timestamp:String(ts),mac:sha('NABD_HEARTBEAT_V1\n'+ts+'\n'+body),secure:true}};
test('read-only heartbeat matches both fresh signed snapshots without consuming or registering',()=>{
 const d=create({quoteProvider:sym=>({...full(sym),symbol:sym,executionEnabled:false})});
 assert.equal(d.consider(proposal).created,true);
 assert.equal(d.heartbeat(hb()).status,'HEARTBEAT_MATCHED');
 assert.equal(d.report().heartbeat.online,true);assert.equal(d.report().heartbeat.feedMatched,true);
 assert.equal(d.report().heartbeat.eaReportsArmed,false);
 assert.equal(d.report().executorRegistered,false);assert.equal(d.report().delivered,0);
 assert.equal(d.report().queued.length,1);
 assert.equal(d.heartbeat(hb()).status,'HEARTBEAT_REPLAY');
 assert.equal(d.pull(hb()).status,'REJECTED');
 assert.equal(d.pull(pull).status,'INTENT_DELIVERED');
});
test('heartbeat verifies authentication, time, both symbols and account even with trading disabled',()=>{
 const d=create({enabled:false,quoteProvider:sym=>({...full(sym),symbol:sym,executionEnabled:false})});
 assert.equal(d.heartbeat({...hb(),mac:'f'.repeat(64)}).status,'HEARTBEAT_SIGNATURE_INVALID');
 assert.equal(d.heartbeat(hb({...heartbeatPayload,capturedAt:now-11},now-11)).status,'HEARTBEAT_EXPIRED');
 assert.equal(d.heartbeat(hb({...heartbeatPayload,accountType:'LIVE'})).status,'HEARTBEAT_PAYLOAD_INVALID');
 assert.equal(d.heartbeat(hb({...heartbeatPayload,accountLogin:222})).status,'HEARTBEAT_FEED_MISMATCH');
 assert.equal(d.heartbeat(hb()).status,'HEARTBEAT_MATCHED');
 assert.equal(d.report().executorRegistered,false);
 assert.equal(create({quoteProvider:()=>null}).heartbeat(hb()).status,'HEARTBEAT_WAITING_SENSOR');
});
