import { test } from 'node:test';
import assert from 'node:assert/strict';
import {createObservatory, authorizedView} from './observatory.mjs';
test('only a dedicated read token authorizes the projection',()=>{
  const key='x'.repeat(64);
  assert.equal(authorizedView('Bearer '+key,key),true);
  assert.equal(authorizedView('Bearer '+key,''),false);
  assert.equal(authorizedView('Bearer different',key),false);
});
test('quotes, decision, risk and corroborated history remain separately attributable',async()=>{
 const at=1800000000, bar=at-300, id='XAUUSD-'+bar;
 const v=createObservatory({clock:()=>at*1000});
 const candle={time:bar,open:4,high:6,low:3,close:5,privateExtra:555};
 const snapshot={accountLogin:98765432,accountType:'DEMO',symbol:'XAUUSD',brokerSymbol:'XAUUSD.m',
  timestamp:at,receivedAt:at,multiTimeframeVerified:true,bid:5,ask:5.1};
 for(const f of ['M5','M15','H1','H4'])snapshot['candles'+f]=[candle];
 v.observe(snapshot,{reason:'M5_CLOSED',scheduled:true});
 v.analysis('XAUUSD',{stage:'ANALYZED',at:new Date(at*1000).toISOString(),
  closedBarAt:new Date(bar*1000).toISOString(),stance:'BUY_WATCH',confidence:.86});
 v.decision({symbol:'XAUUSD',closedBarTime:bar,plan:{stance:'BUY_WATCH',evidence:['observed']},features:{}},{created:true});
 const read=()=>v.read({requested:id,trade:{recentDeliveries:[]},sensor:{markets:{}},journal:null});
 const ack={id,occurredAt:at,status:'FILLED',tradeRetcode:10009,brokerDealTicket:45,executedVolume:.02,accountLogin:98765432};
 v.acknowledge(ack);
 const history={id,symbol:'XAUUSD.m',deal:'45',time:at,price:5,lot:.02,sl:4,tp:7};
 v.history([history],{...snapshot,accountLogin:98765431});
 let view=await read();
 assert.equal(view.markets.XAUUSD.cycles[0].fill,undefined);
 assert.equal(view.markets.XAUUSD.cycles[0].ack.deal,'45');
 v.history([history],snapshot);
 view=await read();
 assert.equal(view.markets.XAUUSD.cycles[0].fill.price,5);
 assert.equal(view.markets.XAUUSD.cycles[0].risk.status,'ACCEPTED');
 assert.equal(view.archivedChart.candles.M5[0].time,bar);
 assert.equal(JSON.stringify(view).includes('98765432'),false);
 assert.equal(JSON.stringify(view).includes('privateExtra'),false);
 assert.equal(view.markets.BTCUSD.cycles.length,0);
});
