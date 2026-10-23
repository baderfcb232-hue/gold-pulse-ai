import test from 'node:test';
import assert from 'node:assert/strict';
import {automaticRiskSizing} from './automatic-risk.mjs';
const now=2000000000;
const snapshot=()=>({symbol:'XAUUSD.m',account:{currency:'USD',balance:200,equity:200,free_margin:200},
  execution:{risk_percent:.5},spec:{tick_size:.01,tick_value_loss:1,volume_min:.01,volume_step:.01,volume_max:100,margin_per_lot:133.23}});
const plan=()=>({id:'gold-6pm',broker_symbol:'XAUUSD.m',side:'SELL',entry:4000.36,sl:4008.04,
  issued_at:now-30,expires_at:now+100,status:'TRACKING'});

test('the reported 200 USD account cannot risk 7.68 USD with a 1 USD budget',()=>{
  const r=automaticRiskSizing(snapshot(),plan(),now);
  assert.equal(r.budget,1);assert.equal(r.estimate.volume,0);
  assert.equal(r.estimate.code,'BELOW_MINIMUM_VOLUME');
  assert.ok(Math.abs(r.estimate.minimumLoss-7.68)<1e-8);
  assert.ok(Math.abs(r.estimate.minimumEquity-1536)<1e-7);
  assert.equal(r.maxStopDistance,1);
});
test('sizing changes with equity and stop, rounds down, and never narrows the strategy stop',()=>{
  const s=snapshot(),p=plan(),original=structuredClone(p);
  s.account.equity=10000;
  const larger=automaticRiskSizing(s,p,now);
  assert.equal(larger.estimate.volume,.06);assert.ok(larger.estimate.loss<=50);
  s.account.equity=200;p.sl=4000.86;
  const tighter=automaticRiskSizing(s,p,now);
  assert.equal(tighter.estimate.volume,.02);assert.ok(tighter.estimate.loss<=1+1e-8);
  assert.equal(p.sl,4000.86);assert.equal(original.sl,4008.04);
  s.account.equity=100;assert.equal(automaticRiskSizing(s,p,now).estimate.volume,.01);
});
test('small budgets and tiny stops never exceed broker maximum, while zero margin blocks sizing',()=>{
  const s=snapshot(),p=plan();s.spec.volume_max=.01;p.sl=p.entry+.1;
  const r=automaticRiskSizing(s,p,now);assert.equal(r.estimate.volume,.01);
  s.account.free_margin=0;assert.equal(automaticRiskSizing(s,p,now).estimate.code,'INSUFFICIENT_MARGIN');
});
test('an expired example remains an estimate and no-plan mode still exposes the automatic budget',()=>{
  const p=plan();p.expires_at=now-1;
  assert.equal(automaticRiskSizing(snapshot(),p,now).plan.expired,true);
  p.expires_at=now+100;p.status='SL';assert.equal(automaticRiskSizing(snapshot(),p,now).plan.expired,true);
  const r=automaticRiskSizing(snapshot(),null,now);assert.equal(r.budget,1);assert.equal(r.plan,null);assert.equal(r.estimate,null);
});
test('invalid account, risk, contract, stop direction and mismatched symbols cannot generate a volume',()=>{
  for(const change of [s=>s.account=null,s=>s.account.equity=-1,s=>s.execution.risk_percent=null,
    s=>s.execution.risk_percent=Infinity,s=>s.spec.tick_size=Infinity,s=>s.spec.volume_max=.001]){
    const s=snapshot();change(s);assert.equal(automaticRiskSizing(s,plan(),now).available,false);
  }
  for(const change of [p=>p.broker_symbol='BTCUSD',p=>p.sl=p.entry,p=>p.sl=p.entry-1,p=>p.entry=Infinity]){
    const p=plan();change(p);const r=automaticRiskSizing(snapshot(),p,now);assert.equal(r.estimate,null);assert.equal(r.reason,'INVALID_PLAN');
  }
});
