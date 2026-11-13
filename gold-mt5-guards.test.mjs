import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const gold = readFileSync(new URL('./mt5/NABD_GOLD_4_01.mq5',import.meta.url),'utf8');

test('gold profit protection runs before legacy demo-management short circuit', () => {
  const manage = gold.slice(gold.indexOf('void ManageOpenPositions()\n  {'));
  assert.match(manage,/ManageHalfTargetProfitLock\(\);[\s\S]*ManageHalfTargetPartialClose\(\);[\s\S]*if\(DemoWebsiteNoDailyLimitsEnabled\(\)\)/);
  assert.match(gold,/InpUseHalfTargetProfitLock = true/);
  assert.match(gold,/InpUseAutoHalfClose\s+= true/);
  assert.match(gold,/MathAbs\(PositionGetDouble\(POSITION_SL\)-locked_sl\)/);
});
test('profit lock uses a fresh broker quote and never widens stop', () => {
  const start=gold.indexOf('void ManageHalfTargetProfitLock()\n  {');
  const end=gold.indexOf('void ManageHalfTargetPartialClose()\n  {');
  const fn=gold.slice(start,end);
  assert.ok(start>=0 && end>start);
  assert.match(fn,/ServerNow\(\)-tick\.time>10/);
  assert.match(fn,/current_sl>=locked_sl/);
  assert.match(fn,/current_sl<=locked_sl/);
  assert.match(fn,/MinimumStopDistance\(\)/);
});
test('automatic half close is hedging-only and claims each position before sending', () => {
  const start=gold.indexOf('void ManageHalfTargetPartialClose()\n  {');
  const end=gold.indexOf('void ManageOpenPositions()\n  {');
  const fn=gold.slice(start,end);
  assert.ok(start>=0 && end>start);
  assert.match(fn,/IsHedgingAccount\(\)/);
  assert.match(fn,/POSITION_IDENTIFIER/);
  assert.match(fn,/GlobalVariablesFlush\(\)/);
  assert.ok(fn.indexOf('GlobalVariablesFlush();')<fn.indexOf('PositionClosePartial(ticket,half'));
  assert.match(fn,/volume-half<minimum/);
});
test('session buffers apply to native and dashboard entries',()=>{
  assert.match(gold,/InpAfterSessionOpenMinutes = 30/);
  assert.match(gold,/InpBeforeSessionCloseMinutes = 60/);
  assert.match(gold,/SymbolInfoSessionTrade\(/);
  assert.match(gold,/if\(Phase12EntryBlocked\(\) \|\| !ExecutionPermissionsAvailable\(\) \|\| !IsWithinTradingHours\(\) \|\|/);
  assert.match(gold,/if\(!IsWithinTradingHours\(\)\)\{NABDWebsiteBlocked/);
});
test('gold unlimited-entry demo never bypasses daily loss budget',()=>{
  assert.doesNotMatch(gold,/if\(DemoWebsiteNoDailyLimitsEnabled\(\)\)\{reason="";return false;\}/);
  assert.match(gold,/return MathMin\(budget,daily\)/);
  assert.match(gold,/if\(count>=3 && unprotected_or_losing>0\)/);
});
