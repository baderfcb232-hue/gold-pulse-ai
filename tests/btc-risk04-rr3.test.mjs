import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const ea=readFileSync(new URL('../mt5/NABD_BTC_FUSION_V2_4_06_Demo.mq5',import.meta.url),'utf8');
const set=readFileSync(new URL('../mt5/NABD_BTC_FUSION_V2_4_06_Demo.set',import.meta.url),'utf8');
test('BTC package uses 0.4 percent risk, 3R target, two positions and six entries',()=>{
 for(const row of ['InpMaxConcurrentPositions=2','InpMaxTradesPerDay=6','InpRiskPercent=0.4',
  'InpMaxOpenRiskPercent=0.8','InpRewardRisk=3.0','InpDemoWebsiteNoDailyLimits=false',
  'InpMaxDailyLossPercent=2.0'])assert.ok(set.split(/\r?\n/).includes(row),row);
 assert.match(ea,/InpRiskPercent\s+= 0\.40;/);
 assert.match(ea,/InpRewardRisk\s+= 3\.00;/);
 assert.match(ea,/InpMaxOpenRiskPercent\s+= 0\.8;/);
 assert.doesNotMatch(ea,/if\(manual_website\)allowed_risk=AccountInfoDouble\(ACCOUNT_EQUITY\)/);
 assert.equal(ea.split('{').length,ea.split('}').length);
 assert.doesNotMatch(set,/InpNABDToken=[^\s]+/);
});
test('two 0.4 percent BTC positions fit exactly inside the 0.8 percent cap',()=>{
 const start=ea.indexOf('bool BTCConcurrentLimitsAllow(');
 const end=ea.indexOf('\nbool ConcurrentWebsiteEntryAllowed(',start);
 const js=ea.slice(start,end).replace('bool BTCConcurrentLimitsAllow','function BTCConcurrentLimitsAllow')
 .replace(/const (int|double) /g,'');
 const allowed=vm.runInNewContext(js+';BTCConcurrentLimitsAllow',{MathIsValidNumber:Number.isFinite});
 assert.equal(allowed(1,2,40,40,10000,.8),true);
 assert.equal(allowed(1,2,40,40.01,10000,.8),false);
 assert.equal(allowed(2,2,40,40,10000,.8),false);
});

// Regression guard: unlimited-entry Demo must not disable the account loss circuit breaker.
test('BTC Demo unlimited entries still enforce daily loss allowance',()=>{
 const start=ea.indexOf('bool DailyRiskLimitReached(string &reason)\n  {');
 const end=ea.indexOf('\n//+------------------------------------------------------------------+',start);
 assert.ok(start>=0 && end>start);
 const guard=ea.slice(start,end);
 assert.doesNotMatch(guard,/if\(DemoWebsiteNoDailyLimitsEnabled\(\)\)\s*\{reason="";return false;\}/);
 assert.match(guard,/today_net<=-limit/);
 const riskStart=ea.indexOf('double ExecutionRiskBudget(const ENUM_ORDER_TYPE order_type,const double entry,const double stop_loss)\n  {');
 const riskEnd=ea.indexOf('\ndouble CalculateVolume(',riskStart);
 assert.ok(riskStart>=0 && riskEnd>riskStart);
 assert.match(ea.slice(riskStart,riskEnd),/return MathMin\(budget,daily\);/);
});
