import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateRiskPreflight as preflight, RISK_REASONS} from './risk-control-policy.mjs';
const valid=()=>({
  now: 2000,
  limits:{riskPercent:0.4,maxDailyLoss:2,maxDailyTrades:6,maxOpenPositions:2,
          maxSpread:80,maxSlippage:10,quoteMaxAgeSeconds:5},
  state:{paused:false,emergencyStop:false,dailyLoss:0,dailyTrades:0,
         openPositions:0,proposedRiskPercent:0.4,availableMargin:100,requiredMargin:25},
  quote:{timestamp:1999,spread:20,slippage:2},
  signal:{expiresAt:2020}
});
test('safe complete snapshot may propose a new Demo entry without executing one',()=>{
  assert.deepEqual(preflight(valid()),{allowNewEntry:true,reason:null,closeOpenPositions:false});
});
test('persistent pause and emergency stop block new entries but do NOT close positions',()=>{
  for(const key of ['paused','emergencyStop']){
    const v=valid();v.state[key]=true;
    assert.deepEqual(preflight(v),{allowNewEntry:false,reason:RISK_REASONS.STOPPED,closeOpenPositions:false});
  }
});
test('daily loss, count, open positions and risk each prevent new entry',()=>{
  const cases=[['dailyLoss',2,'DAILY_LOSS_LIMIT'],['dailyTrades',6,'DAILY_TRADE_LIMIT'],
    ['openPositions',2,'OPEN_POSITION_LIMIT'],['proposedRiskPercent',0.41,'TRADE_RISK_LIMIT']];
  for(const [field,value,reason] of cases){
    const v=valid();v.state[field]=value;
    assert.equal(preflight(v).reason,reason);
  }
});
test('old or future quotes, expired signals and execution costs block entries',()=>{
  for(const [field,value,reason] of [['timestamp',1990,'STALE_PRICE'],['timestamp',2001,'STALE_PRICE'],
    ['spread',81,'SPREAD_LIMIT'],['slippage',11,'SLIPPAGE_LIMIT']]){
    const v=valid();v.quote[field]=value;assert.equal(preflight(v).reason,reason);
  }
  const v=valid();v.signal.expiresAt=1999;assert.equal(preflight(v).reason,'SIGNAL_EXPIRED');
});
test('missing, invalid, infinite and nonsensical data fail closed',()=>{
  for(const change of [
    v=>{v.limits.maxDailyLoss=undefined;},
    v=>{v.state.dailyTrades=NaN;},
    v=>{v.quote.spread=Infinity;},
    v=>{v.state.availableMargin=-1;},
    v=>{v.limits.maxOpenPositions=0;},
    v=>{v.state.dailyTrades=2.5;},
    v=>{v.limits.quoteMaxAgeSeconds=0;}
  ]){const v=valid();change(v);assert.equal(preflight(v).allowNewEntry,false);}
  assert.equal(preflight({}).allowNewEntry,false);
});
test('margin shortage blocks a new entry',()=>{
  const v=valid();v.state.requiredMargin=101;
  assert.equal(preflight(v).reason,'MARGIN_LIMIT');
});
