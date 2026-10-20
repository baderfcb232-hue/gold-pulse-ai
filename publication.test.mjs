import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {brokerCostStatus} from './broker-costs.mjs';
import {reviewPublication} from './publication.mjs';
import {createApplication} from './server.mjs';
import {cleanSnapshot, sourceAnalysis} from './engine.mjs';
import {eaFixture, NOW, fakeTelegram} from './tests/fixtures.mjs';

const costs = {spreadBps: .2, slippageBps: .01, commissionBps: .01, carryBpsPerDay: .01, acknowledged: true};
function profile(raw = eaFixture()) {
  return {accountRef: raw.account_ref, broker: raw.broker, symbol: raw.symbol, magic: raw.execution.managed_magic,
    verifiedAt: NOW, evidence: 'SYNTHETIC TEST ONLY; not actual broker costs', costs: {...costs}};
}
function reviewInput() {
  const snapshot = cleanSnapshot(eaFixture(), NOW), analysis = sourceAnalysis(snapshot, NOW, {signalSource: 'EA'});
  return {enabled: true, snapshot, analysis, plan: {...analysis.plan, id: 'TEST_ONLY'},
    costs: brokerCostStatus(snapshot, [profile()], NOW), now: NOW,
    daily: {status: 'CONTEXT_ONLY', lastClosedAt: NOW - 86400, emaTrend: 'UP', donchianBreak: null}};
}

test('costs stay unknown until verified for the exact account, broker, symbol and magic', () => {
  const s = cleanSnapshot(eaFixture(), NOW);
  assert.equal(brokerCostStatus(null, [], NOW).status, 'WAITING_BROKER');
  assert.equal(brokerCostStatus(s, [], NOW).status, 'WAITING_VERIFIED_COSTS');
  for (const key of ['accountRef', 'broker', 'symbol', 'magic']) {
    const p = profile(); p[key] = 'DIFFERENT'; assert.equal(brokerCostStatus(s, [p], NOW).ready, false);
  }
  assert.equal(brokerCostStatus(s, [profile()], NOW).ready, true);
  assert.equal(brokerCostStatus(s, [profile(), profile()], NOW).status, 'AMBIGUOUS_COST_PROFILE');
  assert.equal(brokerCostStatus(s, {}, NOW).status, 'INVALID_COST_CONFIGURATION');
  for (const bad of [null, '0', -1, Infinity]) {
    const p = profile(); p.costs.commissionBps = bad; assert.equal(brokerCostStatus(s, [p], NOW).status, 'INVALID_COST_PROFILE');
  }
  const p = profile(); p.costs.acknowledged = false;
  assert.equal(brokerCostStatus(s, [p], NOW).ready, false);
});

test('live spread, expired profiles and stale quotes do not become zero-cost assumptions', () => {
  const s = cleanSnapshot(eaFixture(), NOW), p = profile();
  p.verifiedAt -= 31 * 86400;
  assert.equal(brokerCostStatus(s, [p], NOW).status, 'EXPIRED_COST_PROFILE');
  p.verifiedAt = NOW; p.costs.spreadBps = 0;
  assert.equal(brokerCostStatus(s, [p], NOW).status, 'SPREAD_EXCEEDS_SCENARIO');
  p.costs.spreadBps = .2;
  const stale = brokerCostStatus(s, [p], NOW + 11);
  assert.equal(stale.observedSpreadBps, null); assert.equal(stale.status, 'WAITING_LIVE_BROKER');
  assert.equal(stale.costs.commissionBps, .01);
});

test('explicit publication cannot bypass costs, freshness, news, daily context or entry drift', () => {
  assert.equal(reviewPublication(reviewInput()).ready, true);
  const cases = [
    ['PAUSED', x => x.enabled = false],
    ['WAITING_BROKER', x => x.analysis.connection = 'STALE'],
    ['WAITING_SETUP', x => x.plan.symbol = 'BTCUSD'],
    ['WAITING_SETUP', x => x.plan.issued_at -= 91],
    ['WAITING_SETUP', x => x.plan.status = 'SL'],
    ['WAITING_COSTS', x => x.costs.ready = false],
    ['WAITING_HISTORY', x => x.daily = null],
    ['WAITING_HISTORY', x => x.daily.lastClosedAt -= 4 * 86400],
    ['WAITING_HISTORY', x => x.snapshot.candles.H1 = []],
    ['NEWS_BLOCK', x => x.snapshot.calendar.status = 'unavailable'],
    ['NEWS_BLOCK', x => x.snapshot.calendar.events.push({currency: 'USD', importance: 3, time: NOW})],
    ['CONTEXT_OPPOSES', x => x.daily.emaTrend = 'DOWN'],
    ['CONTEXT_OPPOSES', x => x.analysis.frames.H1.direction = 'SELL'],
    ['PRICE_MOVED', x => x.snapshot.ask += .31],
    ['COST_TOO_HIGH', x => x.costs.costs.commissionBps = 2]
  ];
  for (const [reason, mutate] of cases) {
    const input = reviewInput(); mutate(input); const r = reviewPublication(input);
    assert.equal(r.ready, false, reason); assert.equal(r.reason, reason); assert.equal(r.plan, null);
  }
});

test('sell publication uses the broker bid, original stop and ask for exit boundaries', () => {
  const raw = eaFixture(), mirror = v => 8000 - v;
  [raw.bid, raw.ask] = [mirror(raw.ask), mirror(raw.bid)];
  for (const bars of Object.values(raw.candles)) for (const b of bars) {
    [b.open, b.high, b.low, b.close] = [mirror(b.open), mirror(b.low), mirror(b.high), mirror(b.close)];
  }
  const p = raw.ea.signal; p.side = 'SELL';
  for (const k of ['entry', 'sl', 'target']) p[k] = mirror(p[k]);
  const snapshot = cleanSnapshot(raw, NOW), analysis = sourceAnalysis(snapshot, NOW, {signalSource: 'EA'});
  const input = {...reviewInput(), snapshot, analysis, plan: {...analysis.plan, id: 'SELL_TEST_ONLY'},
    costs: brokerCostStatus(snapshot, [profile(raw)], NOW),
    daily: {status: 'CONTEXT_ONLY', lastClosedAt: NOW - 86400, emaTrend: 'DOWN', donchianBreak: null}};
  const result = reviewPublication(input); assert.equal(result.ready, true);
  assert.equal(result.plan.sl, p.sl); assert.equal(result.plan.entry, raw.bid);
  snapshot.ask = p.sl; assert.equal(reviewPublication(input).reason, 'PRICE_MOVED');
});

test('server publishes only a matching fresh broker plan once; costs and diagnostics remain private', async t => {
  let now = NOW, sends = 0, message;
  const admin = 'TEST_OPERATOR_XXXXXXXXXXXXXXXXXXXXXXXXXXXX';
  const dir = mkdtempSync(join(tmpdir(), 'nabd-publication-'));
  const app = createApplication({dataDir: dir, clock: () => now, dashboardToken: admin,
    config: {publicationEnabled: true, telegramPolicy: 'STRICT', brokerCostProfiles: [profile()]},
    telegramOptions: {token: 'TEST_TOKEN', chatId: 'TEST_CHANNEL', fetcher: fakeTelegram(async (_url, options) => {
      sends++; message = JSON.parse(options.body); return new Response('{"ok":true}');
    })}});
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  t.after(async () => {await app.close(); rmSync(dir, {recursive: true, force: true});});
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const auth = {headers: {Authorization: 'Bearer ' + admin}};
  assert.equal((await fetch(base + '/api/internal/costs')).status, 401);
  assert.equal((await fetch(base + '/api/telegram/status')).status, 401);
  assert.equal((await (await fetch(base + '/api/internal/costs', auth)).json()).status, 'WAITING_BROKER');
  app.ingest(eaFixture(now)); await app.telegram.publish(); assert.equal(sends, 0);
  const raw = eaFixture(++now), end = Math.floor(now / 86400) * 86400;
  // A continuing EA setup keeps its original issue time and closed-bar ID.
  raw.ea.signal = eaFixture(NOW).ea.signal;
  raw.daily_candles = Array.from({length: 1000}, (_, i) => {
    const c = 4000 + i * .1;
    return {time: end - (1000 - i) * 86400, open: c, high: c + 1, low: c - 1, close: c};
  });
  app.ingest(raw);
  const state = app.publicState(); assert.ok(state.currentSignal); assert.equal(state.confidence, null);
  const markets = await (await fetch(base + '/api/market', auth)).json();
  const guestMarkets = await (await fetch(base + '/api/market')).json();
  assert.equal(guestMarkets.markets.XAUUSD.currentSignal, null);
  assert.equal(guestMarkets.membersOnly, true);
  assert.equal(markets.markets.XAUUSD.currentSignal.id, state.currentSignal.id);
  assert.equal(markets.markets.BTCUSD.currentSignal, null);
  assert.equal(state.currentSignal.claimedSuccessRate, null);
  assert.doesNotMatch(JSON.stringify(state), /TEST_ACCOUNT_ONLY|SYNTHETIC TEST ONLY|TEST_TOKEN|verifiedAt/);
  await app.telegram.publish(); await app.telegram.publish(); assert.equal(sends, 1);
  assert.match(message.text, /MT5 · JustMarkets-Demo/); assert.match(message.text, /UTC/);
  assert.match(message.text, /5 دقيقة/); assert.match(message.text, /ليست ضمان ربح/);
  assert.equal(message.chat_id, 'TEST_CHANNEL');
  const status = await (await fetch(base + '/api/telegram/status', auth)).json();
  assert.equal(status.publication.ready, true); assert.equal(status.deliveries[0].state, 'SENT');
  now += 11; await app.telegram.publish(); assert.equal(sends, 1); assert.equal(app.publicState().currentSignal, null);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM commands').get().n, 0);
});
