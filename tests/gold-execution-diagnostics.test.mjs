import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describeEaRejection,linkExecutionTrace} from '../execution-trace.mjs';

const gold = readFileSync(new URL('../mt5/NABD_GOLD_4_01.mq5',import.meta.url),'utf8');
const preset = readFileSync(new URL('../mt5/NABD_GOLD_FUSION_Demo.set',import.meta.url),'utf8');

test('GOLD EA retains protective order checks while reporting precise codes',()=>{
  const start=gold.indexOf('int safety_code=0;');
  const end=gold.indexOf('datetime started=ServerNow();',start);
  assert.ok(start>0 && end>start);
  const guard=gold.slice(start,end);
  for(const code of [125,126,127,128,129])assert.match(guard,new RegExp('safety_code='+code));
  for(const expr of ['distance<=MinimumStopDistance()','!OrderCalcProfit(','MathAbs(profit)>allowed_risk',
    '!ConcurrentWebsiteEntryAllowed(MathMax(0.0,-profit))','!MarginIsAcceptable('])
    assert.ok(guard.includes(expr),'missing risk check: '+expr);
  assert.match(gold,/LogEvent\("WEBSITE_PERMISSIONS"/);
  assert.match(gold,/g_website_attempt_code=124/);
});

test('GOLD FUSION preset enables Demo HEDGING concurrency but keeps risk caps',()=>{
  assert.match(preset,/InpDemoWebsiteNoDailyLimits=true/);
  assert.match(preset,/InpMaxConcurrentPositions=5/);
  assert.match(preset,/InpMaxOpenRiskPercent=2\.0/);
  assert.match(preset,/InpMaxDailyLossPercent=2\.0/);
  assert.match(preset,/InpMaxMarginUsePercent=25\.0/);
  assert.match(preset,/InpMaxTradesPerDay=0/);
  assert.match(preset,/InpNABDDemoRecommendations=true/);
  assert.match(preset,/InpNABDWebsiteRecommendations=true/);
});

test('GOLD rejected requests provide Arabic reasons; never imply a filled order',()=>{
  for(const code of [102,105,120,124,125,126,127,128,129])
    assert.match(describeEaRejection(code),/^رفض MT5: /);
  assert.equal(describeEaRejection(999),'EA_REJECTED');
  const p={id:'gold-1',symbol:'XAUUSD',source:'MT5 · JustMarkets',side:'BUY'};
  const [linked]=linkExecutionTrace([p],[{status:'REJECTED',reason_code:125,plan_id:'gold-1',symbol:'XAUUSD',time:100,plan:p}],[],{});
  assert.equal(linked.execution_trace.status,'REJECTED');
  assert.match(linked.execution_trace.reason,/وقف الخسارة/);
  assert.equal(linked.execution_trace.broker_fill_confirmed,false);
});
