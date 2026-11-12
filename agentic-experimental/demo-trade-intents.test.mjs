import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createDemoTradeIntents} from './demo-trade-intents.mjs';
const now=1800000000,secret='test-execution-only-32-byte-secret-12345';
const sha=x=>createHmac('sha256',secret).update(x).digest('hex');
const full=()=>({environment:'EXPERIMENTAL_NABD_AGENTIC',accountType:'DEMO',
 brokerServer:'Independent-JustMarkets-Demo',timestamp:now-1,bid:100,ask:100.2,
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
 symbols:['XAUUSD','BTCUSD'],capturedAt:now});
function create(options={}){
 return createDemoTradeIntents({enabled:true,secret,clock:()=>now,
 quoteProvider:()=>full(),...options});
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
 const d=create({clock:()=>tick,quoteProvider:()=>({...full(),timestamp:tick-1})});
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
 assert.equal(d.report().filledAcks,1);
});
test('false, missing execution flag or key never issues commands',()=>{
 assert.equal(createDemoTradeIntents({enabled:false,secret,clock:()=>now,
 quoteProvider:full}).consider(proposal).created,false);
 assert.equal(createDemoTradeIntents({enabled:true,secret:'',clock:()=>now,
 quoteProvider:full}).consider(proposal).reason,'SECRET_NOT_CONFIGURED');
});
