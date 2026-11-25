import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createClosedHistoryIngest,lifecycleFeed,validateClosedPosition} from './demo-closed-history.mjs';
const now=1900000000,secret='isolated-test-history-secret-at-least-32';
const symbols={XAUUSD:'XAUUSD.m',BTCUSD:'BTCUSD.m'},server='Broker-Demo',login=12345;
const entry={dealTicket:101,brokerSymbol:symbols.XAUUSD,entry:'IN',side:'BUY',at:now-120,volume:.02,profit:0,commission:-.2,swap:0,fee:0};
const out={...entry,dealTicket:102,entry:'OUT',side:'SELL',at:now-10,volume:.01,profit:3,commission:-.1,swap:-.05,fee:-.02};
const position={symbol:'XAUUSD',positionId:200,positionOpen:false,deals:[entry,out,{...out,dealTicket:103,profit:4}]};
const packet={source:'ISOLATED_DEMO_MT5_CLOSED_HISTORY_V1',accountType:'DEMO',marginMode:'HEDGING',accountLogin:login,brokerServer:server,observedAt:now,currency:'USD',symbols,positions:[position]};
function request(p=packet,domain='NABD_CLOSED_HISTORY_V1'){
 const body=JSON.stringify(p),timestamp=String(now);
 return {body,timestamp,mac:createHmac('sha256',secret).update(domain+'\n'+timestamp+'\n'+body).digest('hex'),secure:true};
}
function make(overrides={}){
 const saved=[];
 const ing=createClosedHistoryIngest({secret,clock:()=>now,quoteProvider:s=>({accountType:'DEMO',accountLogin:login,brokerServer:server,brokerSymbol:symbols[s],timestamp:now-1}),journalProvider:()=>({saveClosedPosition:async x=>{saved.push(x);return {inserted:true,matched:true}}}),...overrides});
 return {ing,saved};
}
test('signed closed full-volume partial exits include all entry and exit costs',async()=>{
 const {ing,saved}=make();
 assert.equal((await ing.receive(request())).status,'OBSERVED');
 assert.equal(saved.length,1);assert.ok(Math.abs(saved[0].net-6.46)<1e-8);assert.equal(saved[0].exitCount,2);
 assert.equal(saved[0].feed,lifecycleFeed(server,symbols.XAUUSD,login));
 assert.equal((await ing.receive(request())).code,'CLOSURE_REPLAY');assert.equal(saved.length,1);
});
test('reject partial, duplicate, open, reversed or mixed position histories',()=>{
 for(const p of [{...position,positionOpen:true},{...position,deals:[entry,out]},{...position,deals:[entry,out,out]},{...position,deals:[entry,{...out,side:'BUY'},position.deals[2]]},{...position,deals:[entry,{...out,brokerSymbol:'BTCUSD.m'},position.deals[2]]},{...position,deals:[entry,{...entry,dealTicket:222},out,position.deals[2]]}]){
 assert.equal(validateClosedPosition(p,{now,symbols,feed:()=>'',currency:'USD'}),null);
 }
});
test('reject legacy signature, netting, live, wrong identity and no database',async()=>{
 assert.equal((await make().ing.receive(request(packet,'LEGACY'))).code,'INVALID_CLOSURE_SIGNATURE');
 for(const p of [{...packet,marginMode:'NETTING'},{...packet,accountType:'LIVE'}])assert.equal((await make().ing.receive(request(p))).code,'INVALID_CLOSURE_PROVENANCE');
 assert.equal((await make({quoteProvider:()=>null}).ing.receive(request())).code,'CLOSURE_SENSOR_ACCOUNT_MISMATCH');
 assert.equal((await make({journalProvider:()=>null}).ing.receive(request())).code,'CLOSURE_JOURNAL_UNAVAILABLE');
});
test('database rejection of unmatched closure stays out of matched metrics',async()=>{
 const {ing}=make({journalProvider:()=>({saveClosedPosition:async()=>({inserted:false,matched:false})})});
 const r=await ing.receive(request());assert.equal(r.unmatched,1);assert.equal(r.inserted,0);assert.equal(ing.report().matched,0);
});
