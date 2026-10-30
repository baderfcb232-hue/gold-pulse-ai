import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// Execute the actual MQL assignment expression with bounds-checked array access.
// This reproduces MQL's fatal out-of-range failure rather than JS's undefined.
// MetaEditor compilation remains a separate deployment check on Windows.
const source = readFileSync(new URL('../mt5/NABD_Bridge.mqh', import.meta.url), 'utf8');
const expression = source.match(/GlobalVariableSet\(NABDKey\("WV"\),([^;]+)\);/)[1];
function approvalLot(values) {
  const parts = new Proxy(values, {get(target, key) {
    if (/^\d+$/.test(String(key)) && Number(key) >= target.length)
      throw new RangeError('MQL array out of range');
    return target[key];
  }});
  return runInNewContext(expression, {fields: values.length, parts, StringToDouble: Number});
}
test('12-field AUTO approval cannot crash the bridge and clears prior manual sizing', () => {
  let manualLot = 0.25;
  manualLot = approvalLot(Array(12).fill('1'));
  assert.equal(manualLot, 0);
});
test('13-field manual approval preserves the exact requested lot', () => {
  assert.equal(approvalLot([...Array(12).fill('1'), '0.07']), 0.07);
});
