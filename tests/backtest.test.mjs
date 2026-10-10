import test from 'node:test';
import assert from 'node:assert/strict';
import {backtest} from '../backtest.mjs';
import {fixture} from './fixtures.mjs';
test('backtest refuses unknown costs or silently disabled news protection',()=>{
  const raw=fixture();assert.throws(()=>backtest(raw),/spread/);
  raw.spread_points=30;raw.commission_per_lot=7;assert.throws(()=>backtest(raw),/historical news/);
  const report=backtest(raw,{allowMissingNews:true});assert.equal(report.kind,'OFFLINE_SIMULATION');assert.equal(report.news_filter,'DISABLED EXPLICITLY');assert.equal(report.assumptions.swap_included,false);
  assert.equal(report.summary.trades,0);assert.equal(report.summary.win_rate,null);
});
