import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const eas=['NABD_BTC_4_01.mq5','NABD_BTC_FUSION_V2_4_06_Demo.mq5','NABD_GOLD_4_01.mq5'];
test('phase 12 stop flag blocks all selected Demo EA entries and persists across parameter changes',()=>{
 for(const name of eas){
  const src=read('./mt5/'+name);
  assert.match(src,/input bool\s+InpPhase12StopRequired\s*=\s*false/);
  assert.match(src,/string Phase12StopKey\(\)/);
  assert.match(src,/NB_P12_%I64d_%u/);
  assert.match(src,/GlobalVariableCheck\(key\) && GlobalVariableGet\(key\)>0\.5/);
  assert.match(src,/if\(InpPhase12StopRequired\)return true/);
  assert.match(src,/Phase12EntryBlocked\(\) \|\| !ExecutionPermissionsAvailable\(\)/);
  assert.match(src,/if\(Phase12EntryBlocked\(\)\)\{g_website_attempt_code=125;break;\}/);
  assert.match(src,/if\(Phase12EntryBlocked\(\)\)\{NABDClearSignal\(\);UpdateChartPanel\(\);return;\}/);
  // The PAUSE flag must not be equated to emergency close.
  assert.doesNotMatch(src,/if\(Phase12EntryBlocked\(\)\).*CloseOwnPositions\(/);
  assert.doesNotMatch(src,/GlobalVariableSet\(Phase12StopKey\(\),0/);
 }
});
test('Demo pause companion is account scoped and has no order or resume operations',()=>{
 const src=read('./mt5/NABD_Phase12_DemoPauseOnly.mq5');
 assert.match(src,/ACCOUNT_TRADE_MODE_DEMO/);
 assert.match(src,/InpExplicitDemoPauseArm\s*=\s*false/);
 assert.match(src,/NB_P12_%I64d_%u/);
 assert.match(src,/GlobalVariablesFlush\(\)/);
 assert.match(src,/X-NABD-Stop-Token/);
 assert.match(src,/PAUSE_NEW_ENTRIES_ONLY/);
 assert.match(src,/\/api\/worker\/risk-stop\/poll/);
 assert.match(src,/\/api\/worker\/risk-stop\/ack/);
 assert.match(src,/gold-pulse-ai\.onrender\.com/);
 assert.doesNotMatch(src,/g_trade\.(Buy|Sell)|OrderSend\(/);
 assert.doesNotMatch(src,/\/api\/worker\/risk-stop\/resume|GlobalVariableSet\(P12Key\(\),0/);
});

test('offline local PAUSE probe uses the exact account-symbol durable stop and never calls broker or network',()=>{
 const src=read('./mt5/NABD_Phase12_LocalPauseProbe.mq5');
 assert.match(src,/InpArmPersistentDemoPause\s*=\s*false/);
 assert.match(src,/ACCOUNT_TRADE_MODE_DEMO/);
 assert.match(src,/justmarkets/);
 assert.match(src,/NB_P12_%I64d_%u/);
 assert.match(src,/2166136261/);
 assert.match(src,/16777619/);
 assert.match(src,/GlobalVariableSet\(key,1\.0\)/);
 assert.match(src,/GlobalVariablesFlush\(\)/);
 assert.doesNotMatch(src,/GlobalVariableDel\(/);
 assert.doesNotMatch(src,/OrderSend\(|\.Buy\(|\.Sell\(|WebRequest\(/);
});
