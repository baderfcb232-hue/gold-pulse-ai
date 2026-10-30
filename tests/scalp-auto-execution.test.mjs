import test from 'node:test';
import assert from 'node:assert/strict';
import {websiteTradeDecision} from '../website-entry.mjs';
import {brokerGoldMarket} from '../broker-market.mjs';
import {cleanSnapshot} from '../engine.mjs';
import {entryFixture,eaFixture,NOW} from './fixtures.mjs';
import {GOLD_SCALP_STRATEGY} from '../strategies/gold-scalping.mjs';
function scenario(){
 const raw=entryFixture('BUY'),settings=eaFixture().ea;
 raw.symbol='XAUUSD.m';raw.ea={...settings,signal:null};
 raw.execution={...raw.execution,main_connected:true,demo_recommendations:true,
   website_recommendations:true,website_since:NOW-10};
 raw.positions=[];raw.deals=[];raw.account={currency:'USD',balance:10000,equity:10000,free_margin:10000,floating:0};
 const s=cleanSnapshot(raw,NOW),m=brokerGoldMarket(s,NOW,{goldStrategy:'SCALP'});
 const entry=s.ask,sl=entry-1.5,tp1=entry+1.5;
 const p={strategy:GOLD_SCALP_STRATEGY,id:'scalp-demo-plan',source:m.source,source_id:m.source_id,
   broker_symbol:s.symbol,symbol:'XAUUSD',side:'BUY',bar_time:s.candles.M5.at(-1).time,
   issued_at:NOW,expires_at:NOW+300,entry,sl,tp1,tp2:entry+2.25,status:'TRACKING'};
 return {enabled:true,snapshot:s,now:NOW,durable:true,costs:{ready:true},
   analysisPlan:{...p},market:{...m,analysis:{...m.analysis,status:'READY',strategy:GOLD_SCALP_STRATEGY},
   currentSignal:p},requiredStrategy:GOLD_SCALP_STRATEGY};
}
test('explicit Demo scalp candidate is eligible only when all legacy broker and risk protections pass',()=>{
  const f=scenario(),x=websiteTradeDecision(f);
  assert.equal(x.reason,'WEBSITE_READY');
  assert.equal(x.plan.tp,f.market.currentSignal.tp1);
  assert.equal(x.plan.expires_at,NOW+15);
  for(const [reason,mutate] of [
   ['NOT_JUSTMARKETS_DEMO',z=>z.snapshot.execution.demo=false],
   ['MT5_EXECUTION_NOT_READY',z=>z.snapshot.execution.paused=true],
   ['MT5_EXECUTION_NOT_READY',z=>z.snapshot.execution.enabled=false],
   ['MT5_EXECUTION_NOT_READY',z=>z.snapshot.ea.emergency_stop=true],
   ['STALE_MT5',z=>z.snapshot.quote_at=NOW-30],
   ['WAITING_COSTS',z=>z.costs.ready=false],
   ['DURABLE_ENTRY_JOURNAL_REQUIRED',z=>z.durable=false],
   ['WEBSITE_SOURCE_MISMATCH',z=>z.market.currentSignal.source_id='REFERENCE'],
   ['WEBSITE_PLAN_CHANGED',z=>z.analysisPlan.bar_time-=300],
   ['WEBSITE_STRATEGY_MISMATCH',z=>z.market.currentSignal.strategy='EMA-PULLBACK-1'],
  ]){
    const modified=scenario();mutate(modified);
    assert.equal(websiteTradeDecision(modified).reason,reason,reason);
  }
});
test('new scalp plans are not blocked solely by an existing position',()=>{
 const f=scenario(); f.snapshot.positions=[{ticket:'123',side:'BUY',volume:0.01,entry:f.market.currentSignal.entry,
   sl:f.market.currentSignal.sl,tp:f.market.currentSignal.tp1}];
 assert.equal(websiteTradeDecision(f).reason,'WEBSITE_READY');
});
test('BTC and gold strategy identities cannot authorize each other',()=>{
 const f=scenario();f.requiredStrategy='EMA-PULLBACK-1';
 assert.equal(websiteTradeDecision(f).reason,'WEBSITE_STRATEGY_MISMATCH');
});
