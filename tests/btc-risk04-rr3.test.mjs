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
