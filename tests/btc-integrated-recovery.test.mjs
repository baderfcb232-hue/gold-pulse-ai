import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ea = readFileSync(new URL('../mt5/NABD_BTC_FUSION_V2_4_03_Demo.mq5', import.meta.url),'utf8');
const preset = readFileSync(new URL('../mt5/NABD_BTC_FUSION_V2_4_03_Demo.set', import.meta.url),'utf8');
test('single-file BTC 4.03 embeds the preflight quote before expensive sync and retains full snapshots',()=>{
  assert.match(ea, /#property version\s+"4\.03"/);
  assert.match(ea, /const bool NABD_IS_BTC=true/);
  assert.match(ea, /bool NBSendBtcFastQuote\(/);
  const timer = ea.indexOf('void NBBOnTimer()\n  {');
  const fast = ea.indexOf('NBSendBtcFastQuote(tick,offset);',timer);
  const preflight = ea.indexOf('NBSendBtcFastQuote(tick,offset);',fast+1);
  const calendar = ea.indexOf('NBUpdateCalendar(offset);',preflight);
  const candles = ea.indexOf('NBCandles(PERIOD_M5,offset)',preflight);
  const full = ea.indexOf('NBRequest("POST","/api/mt5",payload,response)',preflight);
  assert.ok(timer>0 && fast>timer && preflight>fast && calendar>preflight && candles>preflight && full>candles);
  assert.match(ea,/NBRequest\("POST","\/api\/mt5\/btc-quote",quick,reply\)/);
  assert.match(ea,/if\(AccountInfoInteger\(ACCOUNT_TRADE_MODE\)!=ACCOUNT_TRADE_MODE_DEMO\)/);
  assert.match(ea,/void NABDOnTimer\(\)\s*\{\s*NBLOnTimer\(\);\s*NBBOnTimer\(\);\s*NBLOnTimer\(\);/);
});
test('BTC Demo package never ships an ingest secret and preserves risk guards',()=>{
  assert.match(preset,/InpMagicNumber=26092302/);
  assert.match(preset,/InpDemoWebsiteNoDailyLimits=false/);
  assert.match(preset,/InpMaxConcurrentPositions=1/);
  assert.match(preset,/InpMaxDailyLossPercent=2\.0/);
  assert.match(preset,/InpNABDWebsiteRecommendations=true/);
  assert.doesNotMatch(preset,/InpNABDToken=[^\s]+/);
  assert.match(ea,/InpBlockIfCalendarFails\s*= true/);
});
