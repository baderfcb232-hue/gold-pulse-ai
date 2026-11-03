import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeGoldPerformance} from './performance.mjs';

const at = iso => Date.parse(iso) / 1000;
const account = {balance: 2012, currency: 'USD'};
const d = (ticket, id, iso, entry_type, volume, profit, commission = 0) =>
  ({ticket, position_id: id, time: at(iso), entry_type, volume, profit, commission, swap: 0, fee: 0});

test('empty/unshared histories never fabricate a win rate', () => {
  assert.equal(summarizeGoldPerformance({}).available, false);
  const result = summarizeGoldPerformance({account, now: at('2026-11-03T12:00:00Z')});
  assert.equal(result.available, true);
  assert.equal(result.daily.winRatePercent, null);
  assert.equal(result.daily.returnPercentEstimate, 0);
});

test('counts partial exits as deals but one final winning position', () => {
  const deals = [
    d('1','p1','2026-11-03T08:00:00Z','IN',0.04,0,-1),
    d('2','p1','2026-11-03T09:00:00Z','OUT',0.02,8,-0.5),
    d('3','p1','2026-11-03T10:00:00Z','OUT',0.02,7,-0.5)
  ];
  const result = summarizeGoldPerformance({account,deals,now:at('2026-11-03T12:00:00Z')});
  assert.equal(result.daily.closedTrades,1);
  assert.equal(result.daily.wins,1);
  assert.equal(result.daily.dealCount,3);
  assert.equal(result.daily.net,13);
  assert.equal(result.daily.returnPercentEstimate,100*13/(2012-13));
});

test('an open partially-closed position stays out of closed-trade win rate', () => {
  const deals=[
    d('1','p2','2026-11-03T08:00:00Z','IN',0.04,0),
    d('2','p2','2026-11-03T09:00:00Z','OUT',0.02,6)
  ];
  const result=summarizeGoldPerformance({account,deals,
    positions:[{position_id:'p2',profit:3,swap:-1}],now:at('2026-11-03T12:00:00Z')});
  assert.equal(result.daily.net,6);
  assert.equal(result.daily.closedTrades,0);
  assert.equal(result.floatingGold,2);
});

test('local day/month boundaries reflect Asia/Hebron rather than UTC', () => {
  const deals=[
    d('1','p3','2026-10-31T22:30:00Z','IN',0.01,0),
    d('2','p3','2026-10-31T23:00:00Z','OUT',0.01,-4)
  ];
  const result=summarizeGoldPerformance({account,deals,now:at('2026-11-01T12:00:00Z')});
  assert.equal(result.month,'2026-11');
  assert.equal(result.monthly.net,-4);
  assert.equal(result.monthly.closedTrades,1);
  assert.equal(result.monthly.losses,1);
});
