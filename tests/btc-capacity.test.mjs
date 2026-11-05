import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const ea=readFileSync(new URL('../mt5/NABD_BTC_FUSION_V2_4_05_Demo.mq5',import.meta.url),'utf8');
const preset=readFileSync(new URL('../mt5/NABD_BTC_FUSION_V2_4_05_Demo.set',import.meta.url),'utf8');
const start=ea.indexOf('bool BTCConcurrentLimitsAllow(');
const end=ea.indexOf('\nbool ConcurrentWebsiteEntryAllowed(',start);
const js=ea.slice(start,end).replace('bool BTCConcurrentLimitsAllow','function BTCConcurrentLimitsAllow')
 .replace(/const (int|double) /g,'');
const allowed=vm.runInNewContext(js+';BTCConcurrentLimitsAllow',{MathIsValidNumber:Number.isFinite});
test('BTC allows second 0.5% position inside 1% combined budget, blocks third and overexposure',()=>{
 assert.equal(allowed(0,2,0,50,10000,1),true);
 assert.equal(allowed(1,2,50,50,10000,1),true);
 assert.equal(allowed(2,2,90,1,10000,1),false);
 assert.equal(allowed(1,2,50,50.01,10000,1),false);
 assert.equal(allowed(1,2,50,50,9000,1),false);
 assert.equal(allowed(1,2,50,50,0,1),false);
 assert.equal(allowed(1,2,NaN,50,10000,1),false);
});
test('parallel BTC entries retain finite daily count/loss protection and do not count gold positions',()=>{
 for(const value of ['InpMaxConcurrentPositions=2','InpMaxTradesPerDay=6',
  'InpDemoWebsiteNoDailyLimits=false','InpMaxOpenRiskPercent=1.0','InpRiskPercent=0.5','InpMaxDailyLossPercent=2.0'])assert.ok(preset.includes(value));
 assert.match(ea,/InpMaxConcurrentPositions = 2;/);
 assert.match(ea,/InpMaxTradesPerDay\s+= 6;/);
 assert.match(ea,/\(!DemoWebsiteConcurrencyEnabled\(\) && HasOwnPosition\(\)\)/);
 assert.match(ea,/DemoWebsiteConcurrencyEnabled\(\) && !ConcurrentWebsiteEntryAllowed/);
 const concurrent=ea.slice(end,ea.indexOf('\nbool HasOwnPosition()',end));
 assert.ok(concurrent.indexOf('if(PositionGetString(POSITION_SYMBOL)!=g_symbol)continue;')<concurrent.indexOf('count++;'));
 assert.match(ea,/if\(InpMaxTradesPerDay>0 && entries>=InpMaxTradesPerDay\)/);
 assert.match(ea,/if\(limit>0.0 && today_net<=-limit\)/);
 const mode=ea.slice(ea.indexOf('bool DemoWebsiteConcurrencyEnabled()\n'),ea.indexOf('bool DemoWebsiteNoDailyLimitsEnabled()\n'));
 assert.doesNotMatch(mode,/InpDemoWebsiteNoDailyLimits/);
 assert.equal(ea.split('{').length,ea.split('}').length);
});
