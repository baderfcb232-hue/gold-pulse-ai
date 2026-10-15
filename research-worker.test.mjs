import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createResearchWorker, parseDailyCandles} from './research-worker.mjs';
import {analyzeDailyContext} from './research-engine.mjs';
import {cleanSnapshot} from './engine.mjs';
import {fixture, NOW} from './tests/fixtures.mjs';

const DAY = 86400, END = Math.floor(NOW / DAY) * DAY;
const daily = n => Array.from({length: n}, (_, i) => {
  const c = 100 + Math.sin(i / 18) * 8;
  return {time: END - (n - i) * DAY, open: c, high: c + 1, low: c - 1, close: c};
});

test('daily parser filters outside buckets, sorts and rejects duplicates/incomplete data', () => {
  const row = [END - DAY, 99, 101, 100, 100, 1];
  assert.equal(parseDailyCandles([row, [END, 99, 101, 100, 100]], END - DAY, END + DAY, NOW).length, 1);
  assert.throws(() => parseDailyCandles([row, row], END - DAY, END, NOW));
  assert.throws(() => parseDailyCandles([[END - DAY, 105, 101, 100, 100]], END - DAY, END, NOW));
});

test('worker automatically loads daily history once, refreshes hourly and preserves cache on failure', async () => {
  const db = new DatabaseSync(':memory:'); let now = NOW, requests = 0, fail = false;
  const fetcher = async url => {
    requests++; if (fail) throw Error('private error');
    const u = new URL(url), from = Date.parse(u.searchParams.get('start')) / 1000, to = Date.parse(u.searchParams.get('end')) / 1000;
    assert.equal(u.searchParams.get('granularity'), '86400'); assert.ok((to - from) / DAY <= 299);
    const rows = [];
    for (let t = from; t <= to; t += DAY) rows.push([t, 99, 101, 100, 100, 1]);
    return new Response(JSON.stringify(rows.reverse()), {status: 200});
  };
  const worker = createResearchWorker({db, clock: () => now, fetcher});
  try {
    await worker.refresh(); assert.equal(requests, 5);
    const r = worker.status().markets.BTCUSD;
    assert.equal(r.candles, 1200); assert.equal(r.context.status, 'CONTEXT_ONLY');
    assert.equal(r.context.publicationAllowed, false); assert.equal(r.backtest.status, 'WAITING_COSTS');
    assert.equal(worker.status().markets.XAUUSD.status, 'WAITING_BROKER_D1');
    now += 60; await worker.refresh(); assert.equal(requests, 5);
    now += 3601; fail = true; await worker.refresh(); assert.equal(requests, 6);
    assert.equal(worker.status().markets.BTCUSD.candles, 1200);
    assert.equal(worker.status().markets.BTCUSD.error, 'DAILY_FEED_UNAVAILABLE');
    assert.ok(!JSON.stringify(worker.status()).includes('private error'));
  } finally {await worker.close(); db.close();}
});

test('broker daily analysis and known-cost backtest run internally without mixing reference sources', async () => {
  const db = new DatabaseSync(':memory:');
  const worker = createResearchWorker({db, clock: () => NOW,
    costs: {XAUUSD: {spreadBps: 2, slippageBps: 1, commissionBps: 1, carryBpsPerDay: .1, acknowledged: true}}});
  try {
    worker.acceptBrokerDaily({symbol: 'XAUUSD.m', broker: 'TEST_BROKER', daily_candles: daily(1000)});
    const r = worker.status().markets['MT5:XAUUSD.m'];
    assert.equal(r.context.symbol, 'XAUUSD.m'); assert.equal(r.backtest.status, 'SIMULATION_ONLY');
    assert.equal(r.backtest.report.results.length, 2); assert.equal(r.backtest.report.publicationAllowed, false);
    worker.acceptBrokerDaily({symbol: 'BTCUSD', broker: 'TEST_BROKER', daily_candles: daily(1000)});
    assert.ok(worker.status().markets['MT5:BTCUSD']); assert.equal(worker.status().markets.BTCUSD, undefined);
    assert.equal(worker.status().publicationAllowed, false);
  } finally {await worker.close(); db.close();}
});

test('old and new bridge formats stay compatible; daily history never appears as live orders', () => {
  const raw = fixture(); assert.deepEqual(cleanSnapshot(raw, NOW).daily_candles, []);
  raw.daily_candles = daily(1000);
  const clean = cleanSnapshot(raw, NOW); assert.equal(clean.daily_candles.length, 1000);
  assert.equal(analyzeDailyContext({symbol: raw.symbol, source: raw.broker, timeframe: 'D1', bars: clean.daily_candles}, NOW).publicationAllowed, false);
  raw.daily_candles.at(-1).time = NOW;
  assert.throws(() => cleanSnapshot(raw, NOW), /daily candle/);
});

test('empty/short daily history cannot be promoted, and outdated context is marked stale', async () => {
  assert.throws(() => analyzeDailyContext({timeframe: 'D1', bars: daily(151)}, NOW));
  const db = new DatabaseSync(':memory:'); let now = NOW;
  const worker = createResearchWorker({db, clock: () => now});
  try {
    worker.acceptBrokerDaily({symbol: 'XAUUSD', broker: 'fixture', daily_candles: daily(152)});
    assert.equal(worker.status().markets['MT5:XAUUSD'].backtest.status, 'WAITING_HISTORY');
    now += 5 * DAY; assert.equal(worker.status().markets['MT5:XAUUSD'].context.status, 'STALE');
  } finally {await worker.close(); db.close();}
});


test('candidate reviews use matching broker context and never promote orders or source failures', async () => {
  const db = new DatabaseSync(':memory:'); let fail = false;
  const worker = createResearchWorker({db, clock: () => NOW, candidates: () => {
    if (fail) throw Error('private');
    return [{id: 'matched', source: 'MT5_EA', symbol: 'XAUUSD.m', side: 'BUY'},
      {id: 'unmatched', source: 'Gold API', symbol: 'XAUUSD', side: 'BUY'}];
  }});
  try {
    worker.acceptBrokerDaily({symbol: 'XAUUSD.m', broker: 'fixture', daily_candles: daily(1000)});
    worker.reviewCandidates(); const reviews = worker.status().candidateReviews;
    assert.equal(reviews.length, 2); assert.ok(reviews.every(r => r.publicationAllowed === false));
    assert.notEqual(reviews[0].reason, 'WAITING_MATCHED_DAILY_SOURCE');
    assert.equal(reviews[1].reason, 'WAITING_MATCHED_DAILY_SOURCE');
    fail = true; worker.reviewCandidates(); assert.deepEqual(worker.status().candidateReviews, []);
  } finally {await worker.close(); db.close();}
});
