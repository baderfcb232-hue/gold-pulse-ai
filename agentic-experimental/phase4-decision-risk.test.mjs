import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePhase4ShadowDecision as decide} from './phase4-decision-risk.mjs';
const now=1800000000;
const plan={stance:'BUY_WATCH',confidence:0.84,
 thesis:'Verified closed candles show an upward trend',
 counterThesis:'An unexpected reversal could invalidate this setup',
 evidence:['EMA8 exceeds EMA21 on closed M5','Higher frames reviewed'],
 invalidation:'Price closes below support',riskNotes:'Only research',timeHorizonMinutes:15};
const proposal={side:'BUY',balance:2000,riskPercent:0.4,entry:100,stop:98,
 target:106,spreadLimit:1,positionsForSymbol:0,dailyEntries:0,dailyLossPercent:0};
const broker={environment:'EXPERIMENTAL_NABD_AGENTIC',accountType:'DEMO',
 timestamp:now-1,bid:99.8,ask:100};
const input=(overrides={})=>({symbol:'XAUUSD',plan,proposal,broker,now,
 news:{classification:'NONE'},...overrides});
test('strong verified Demo decision only returns nonexecuting shadow review',()=>{
 const r=decide(input());
 assert.equal(r.status,'SHADOW_RESEARCH_ONLY');
 assert.equal(r.risk.riskAmount,8);
 assert.equal(r.risk.rewardRisk,3);
 assert.equal(r.risk.lotSize,null);
 assert.equal(r.executionAllowed,false);assert.equal(r.order,null);
});
test('WAIT, weak confidence or unsupported AI reasoning always blocks',()=>{
 for(const p of [{...plan,stance:'WAIT'}, {...plan,confidence:0.4},
  {...plan,evidence:[]},{...plan,counterThesis:''},{...plan,invalidation:''}]){
  const r=decide(input({plan:p}));
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.executionAllowed,false);assert.equal(r.order,null);
 }
});
test('daily drawdown and remaining budget are verified before risk review',()=>{
 for(const p of [{...proposal,dailyLossPercent:undefined},
  {...proposal,dailyLossPercent:2},
  {...proposal,dailyLossPercent:1.8,riskPercent:0.4},
  {...proposal,positionsForSymbol:undefined},
  {...proposal,positionsForSymbol:1}]){
  assert.equal(decide(input({proposal:p})).status,'BLOCKED');
 }
});
test('stale quote, unsafe broker identity, delayed news cannot pass',()=>{
 const scenarios=[
  input({broker:{...broker,timestamp:now-10}}),
  input({broker:{...broker,accountType:'LIVE'}}),
  input({news:{classification:'DELAYED'}}),
  input({news:{classification:'REALTIME',authorized:false}}),
  input({proposal:{...proposal,spreadLimit:0.1}}),
 ];
 for(const x of scenarios){
  const r=decide(x);assert.equal(r.status,'BLOCKED');
  assert.equal(r.order,null);
 }
});
test('Bitcoin enforces position count, six-per-day budget and 0.4% risk',()=>{
 const btc={...proposal,side:'BUY',riskPercent:0.4,positionsForSymbol:1,dailyEntries:5};
 const yes=decide(input({symbol:'BTCUSD',proposal:btc}));
 assert.equal(yes.status,'SHADOW_RESEARCH_ONLY');
 for(const p of [{...btc,dailyEntries:6},{...btc,dailyEntries:null},
  {...btc,positionsForSymbol:2},{...btc,riskPercent:0.5},
  {...btc,target:104}]){
  assert.equal(decide(input({symbol:'BTCUSD',proposal:p})).status,'BLOCKED');
 }
});
test('sell watch cannot be paired with buy proposal',()=>{
 const r=decide(input({plan:{...plan,stance:'SELL_WATCH'}}));
 assert.equal(r.status,'BLOCKED');
 assert.ok(r.reasons.includes('AI_HYPOTHESIS_NOT_ALIGNED'));
});
