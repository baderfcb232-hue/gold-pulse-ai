import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./NABD_Demo_Trade_Executor_Safe_v1_24.mq5',import.meta.url),'utf8');

test('executor has no embedded HMAC or broker account credentials',()=>{
  assert.match(source,/input string InpExecHmacSecret = ""/);
  assert.doesNotMatch(source,/#define NABD_EXEC_SECRET/);
  assert.doesNotMatch(source,/\\b[0-9a-fA-F]{64}\\b/);
  assert.doesNotMatch(source,/password\\s*=/i);
});
test('executor requires a Demo broker and explicit local arming',()=>{
  assert.match(source,/ACCOUNT_TRADE_MODE_DEMO/);
  assert.match(source,/InpEnableDemoAutoTrading = false/);
  assert.match(source,/InpAllowedDemoAccountLogin/);
  assert.match(source,/StringLen\\(InpExecHmacSecret\\)<32/);
  assert.match(source,/TerminalInfoInteger\\(TERMINAL_TRADE_ALLOWED\\)/);
  assert(source.indexOf('NABD DEMO NOT ARMED: Algo Trading disabled') <
         source.indexOf('SignedPost(NABD_PULL_URL'),
         'cannot consume one-shot order while terminal trading is disabled');
});
test('limits are explicit and enforced at both account and BTC symbol levels',()=>{
  assert.match(source,/InpMaxTradesPerDay = 8;/);
  assert.match(source,/InpMaxBtcTradesPerDay = 6;/);
  assert.match(source,/CountOurTradesToday\\(\\)>=InpMaxTradesPerDay/);
  assert.match(source,/CountOurTradesToday\\(sym\\)>=InpMaxBtcTradesPerDay/);
  assert.match(source,/InpMaxBtcTradesPerDay>6/);
  assert.match(source,/InpMaxDailyEquityLossPct = 2\\.0/);
  assert.match(source,/risk>0\\.400001/);
  assert.match(source,/OrderCalcProfit/);
  assert.match(source,/OrderCalcMargin/);
  assert.match(source,/GlobalVariableSet\\(lastKey,\\(double\\)bar\\)==0/);
});
test('bounded ACK retry never resends a broker order',()=>{
  assert.match(source,/for\\(int attempt=1;attempt<=2;attempt\\+\\+\\)/);
  assert.match(source,/ACK UNCONFIRMED/); // explicit audit failure rather than hidden loss
  assert.equal((source.match(/g_trade\\.Buy\\(/g)||[]).length,1);
  assert.equal((source.match(/g_trade\\.Sell\\(/g)||[]).length,1);
  assert(source.indexOf('AuditFill(id,outcome') > source.indexOf('bool sent=buy?'));
});
