import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createDemoTradeIntents} from './demo-trade-intents.mjs';
const now=1800000000;
const secret='OFFLINE_STRESS_TEST_SECRET_NEVER_FOR_BROKER';
const sign=(body,ts)=>createHmac('sha256',secret).update(ts+'\n'+body).digest('hex');
const payload=JSON.stringify({source:'ISOLATED_DEMO_TRADE_EXECUTOR',accountType:'DEMO',
 accountLogin:876543,brokerServer:'UnitTest-JustMarkets-Demo',
 symbols:['XAUUSD','BTCUSD'],brokerSymbols:{XAUUSD:'XAUUSD.m',BTCUSD:'BTCUSD.m'},capturedAt:now});
test('2000 forged executor requests never create Demo orders or register an executor',()=>{
 const orders=createDemoTradeIntents({enabled:true,secret,clock:()=>now,quoteProvider:()=>null});
 let blocked=0;
 for(let i=0;i<2000;i++){
  const result=orders.pull({body:payload,timestamp:String(now),mac:'0'.repeat(64),secure:true});
  if(result.status==='REJECTED')blocked++;
 }
 assert.equal(blocked,2000);
 const r=orders.report();
 assert.equal(r.created,0);assert.equal(r.delivered,0);
 assert.equal(r.brokerAcks,0);assert.equal(r.executorOnline,false);
 assert.equal(r.liveTrading,false);assert.equal(r.serverPlacesOrders,false);
});
test('1000 validly authenticated polls with no fresh sensor fail closed without orders',()=>{
 const orders=createDemoTradeIntents({enabled:true,secret,clock:()=>now,quoteProvider:()=>null});
 let waiting=0;
 const req={body:payload,timestamp:String(now),mac:sign(payload,String(now)),secure:true};
 for(let i=0;i<1000;i++)
  if(orders.pull(req).status==='WAITING_FOR_SENSOR')waiting++;
 assert.equal(waiting,1000);
 assert.equal(orders.report().created,0);
 assert.equal(orders.report().brokerAcks,0);
 assert.equal(orders.report().sensorFreshness.XAUUSD.quoteFresh,false);
});
