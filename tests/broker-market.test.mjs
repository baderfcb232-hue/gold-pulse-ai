import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {brokerGoldMarket} from '../broker-market.mjs';
import {analyze, cleanSnapshot} from '../engine.mjs';
import {createApplication} from '../server.mjs';
import {entryFixture, NOW} from './fixtures.mjs';

function monitorQuote(side = 'BUY', now = NOW) {
  const raw = entryFixture(side);
  raw.symbol = 'XAUUSD.m'; raw.quote_at = now;
  raw.calendar.updated_at = now;
  raw.execution.enabled = false; raw.execution.remote_control = false;
  raw.ea = null;
  return raw;
}
async function setup(t, clock = () => NOW) {
  const dir = mkdtempSync(join(tmpdir(), 'nabd-broker-market-'));
  const app = createApplication({dataDir: dir, clock, ingestToken: 'test-ingest-broker-market-xxxxxxxxxxxxxxx'});
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  t.after(async () => {await app.close(); rmSync(dir, {recursive: true, force: true});});
  return {app, base: 'http://127.0.0.1:' + app.server.address().port};
}

test('broker gold uses the existing strategy and exact OHLC levels in monitoring mode', () => {
  for (const side of ['BUY', 'SELL']) {
    const raw = monitorQuote(side), snapshot = cleanSnapshot(raw, NOW);
    const original = analyze(snapshot, NOW), market = brokerGoldMarket(snapshot, NOW);
    assert.equal(market.analysis.status, 'READY'); assert.equal(market.analysis.plan.side, side);
    for (const key of ['entry', 'sl', 'tp1', 'tp2', 'expires_at', 'strategy'])
      assert.equal(market.analysis.plan[key], original.plan[key]);
    assert.equal(market.broker_symbol, 'XAUUSD.m');
    assert.equal(market.default_tf, 'M5'); assert.equal(market.candle_kind, 'BROKER_OHLC');
    assert.equal(market.analysis.plan.quote_time, raw.quote_at);
    assert.equal(market.analysis.plan.reference_only, true);
    assert.equal(market.bars.M5, snapshot.candles.M5);
    const encoded = JSON.stringify(market);
    for (const value of [raw.account_ref, 'balance', 'equity', 'positions', 'execution'])
      assert.equal(encoded.includes(value), false);
  }
});

test('existing bridge payload immediately prepares gold without M1 or public-feed warmup', async t => {
  const {app, base} = await setup(t), raw = monitorQuote();
  assert.equal(app.marketFeed.publicState().markets.XAUUSD.connection, 'NO_DATA');
  app.marketFeed.acceptQuote('XAUUSD', {price: 10000, time: NOW, bid: null, ask: null});
  assert.equal(app.marketFeed.publicState().markets.XAUUSD.analysis.status, 'WARMING');
  const response = await fetch(base + '/api/mt5', {method: 'POST', headers: {
    'Content-Type': 'application/json', Authorization: 'Bearer test-ingest-broker-market-xxxxxxxxxxxxxxx'
  }, body: JSON.stringify(raw)});
  assert.equal(response.status, 200);
  const gold = (await (await fetch(base + '/api/market')).json()).markets.XAUUSD;
  assert.equal(gold.source, 'MT5 · JustMarkets-Demo');
  assert.equal(gold.analysis.status, 'SCANNING'); assert.equal(gold.currentSignal, null);
  assert.equal(gold.analysis.frames.M5.count, 320); assert.equal(gold.quote.bid, raw.bid);
  assert.equal(gold.quote.ask, raw.ask);
  assert.equal(app.marketFeed.history('XAUUSD')[0].entry, analyze(cleanSnapshot(raw, NOW), NOW).plan.entry);
  const chart = await (await fetch(base + '/api/market/candles?symbol=XAUUSD&tf=M5')).json();
  assert.deepEqual(chart.candles, raw.candles.M5);
  assert.equal(chart.source_id, gold.source_id);
  assert.equal((await fetch(base + '/api/market/candles?symbol=XAUUSD&tf=M1')).status, 400);
  for (const tf of ['M15', 'H1', 'H4'])
    assert.equal((await fetch(base + '/api/market/candles?symbol=XAUUSD&tf=' + tf)).status, 200);
  const state = app.publicState();
  assert.equal(state.signalSource, 'MT5_EA'); assert.equal(state.currentSignal, null);
  assert.equal(state.execution.enabled, false); assert.equal(state.execution.remote_control, false);
  assert.equal(app.signalRows().length, 0);
});

test('a fresh Gold API quote cannot revive or resolve a stale or disconnected broker plan', async t => {
  let now = NOW; const {app} = await setup(t, () => now);
  app.ingest(monitorQuote());
  const original = app.marketFeed.history('XAUUSD')[0];
  now += 21;
  app.marketFeed.acceptQuote('XAUUSD', {price: original.tp2 + 1000, time: now});
  const stale = app.marketFeed.publicState().markets.XAUUSD;
  assert.equal(stale.source, original.source); assert.equal(stale.connection, 'STALE');
  assert.equal(stale.currentSignal, null); assert.equal(stale.analysis.setup, null);
  assert.equal(app.marketFeed.history('XAUUSD')[0].status, 'TRACKING');
  const disconnected = monitorQuote('BUY', now); disconnected.terminal_connected = false;
  app.ingest(disconnected);
  assert.equal(app.marketFeed.publicState().markets.XAUUSD.connection, 'DISCONNECTED');
  assert.equal(app.marketFeed.publicState().markets.XAUUSD.currentSignal, null);
  assert.equal(app.marketFeed.history('XAUUSD')[0].status, 'TRACKING');
});

test('switching from sampled gold isolates old plans and freezes new broker levels', async t => {
  let now = NOW; const {app} = await setup(t, () => now);
  const previous = {id: 'sampled-before-mt5', strategy: 'REFERENCE-SCALP-1', source: 'Gold API', symbol: 'XAUUSD',
    side: 'BUY', entry: 100, sl: 90, tp1: 110, tp2: 120, issued_at: NOW - 1,
    quote_time: NOW - 1, expires_at: NOW + 180, status: 'TRACKING'};
  app.db.prepare('INSERT INTO market_signals VALUES(?,?,?)').run(previous.id, previous.issued_at, JSON.stringify(previous));
  app.ingest(monitorQuote());
  let gold = app.marketFeed.publicState().markets.XAUUSD;
  const original = gold.currentSignal; assert.ok(original);
  assert.equal(gold.recentSignals.some(p => p.source === 'Gold API'), false);
  assert.equal(app.marketFeed.history().find(p => p.id === previous.id).status, 'TRACKING');
  now++; const next = monitorQuote('BUY', now); next.bid += .01; next.ask += .01;
  app.ingest(next); gold = app.marketFeed.publicState().markets.XAUUSD;
  assert.equal(gold.currentSignal.id, original.id); assert.equal(gold.currentSignal.entry, original.entry);
  assert.equal(gold.currentSignal.sl, original.sl); assert.equal(gold.currentSignal.tp2, original.tp2);
  assert.equal(app.marketFeed.history().filter(p => p.source_id === original.source_id).length, 1);
  assert.equal(app.marketFeed.history().find(p => p.id === previous.id).status, 'TRACKING');
});

test('a new empty data directory recovers gold analysis from the next existing bridge update', async t => {
  const first = await setup(t), second = await setup(t);
  first.app.ingest(monitorQuote());
  assert.equal(first.app.marketFeed.publicState().markets.XAUUSD.analysis.status, 'READY');
  assert.equal(second.app.marketFeed.history('XAUUSD').length, 0);
  second.app.ingest(monitorQuote());
  const recovered = second.app.marketFeed.publicState().markets.XAUUSD;
  assert.equal(recovered.analysis.status, 'READY'); assert.ok(recovered.currentSignal);
  assert.equal(recovered.analysis.frames.M5.count, 320);
  assert.equal(second.app.publicState().storage.mode, 'ephemeral');
});

test('broker warmup, missing calendar, stale bars and USD events expose the actual blocker', async t => {
  const {app} = await setup(t);
  const empty = monitorQuote(); for (const tf of Object.keys(empty.candles)) empty.candles[tf] = [];
  app.ingest(empty); assert.equal(app.marketFeed.publicState().markets.XAUUSD.analysis.status, 'WARMING');
  assert.equal(app.marketFeed.publicState().markets.XAUUSD.currentSignal, null);
  const missing = monitorQuote(); missing.calendar.status = 'unavailable';
  app.ingest(missing); assert.equal(app.marketFeed.publicState().markets.XAUUSD.analysis.status, 'NEWS_BLOCK');
  const news = monitorQuote(); news.calendar.events = [{id: 'test-news', name: 'TEST USD EVENT',
    currency: 'USD', time: NOW + 600, importance: 3}];
  app.ingest(news); const blocked = app.marketFeed.publicState().markets.XAUUSD;
  assert.equal(blocked.analysis.status, 'NEWS_BLOCK'); assert.match(blocked.analysis.reason, /TEST USD EVENT/);
  assert.equal(blocked.currentSignal, null);
  const old = monitorQuote(); old.candles.M5.forEach(c => {c.time -= 900;});
  app.ingest(old); assert.equal(app.marketFeed.publicState().markets.XAUUSD.analysis.status, 'GAP');
});

test('non-gold MT5 instruments do not replace the gold reference source', () => {
  const raw = monitorQuote(); raw.symbol = 'BTCUSD';
  assert.equal(brokerGoldMarket(cleanSnapshot(raw, NOW), NOW), null);
});

test('health reports market readiness separately from HTTP liveness', async t => {
  let now = NOW; const {app, base} = await setup(t, () => now);
  let health = await (await fetch(base + '/healthz')).json();
  assert.equal(health.ok, true); assert.equal(health.mt5.connection, 'NO_DATA');
  app.ingest(monitorQuote()); health = await (await fetch(base + '/healthz')).json();
  assert.equal(health.mt5.connection, 'LIVE'); assert.equal(health.markets.XAUUSD.analysisStatus, 'READY');
  assert.equal(health.markets.XAUUSD.source, 'MT5 · JustMarkets-Demo');
  now += 30; const response = await fetch(base + '/healthz'); health = await response.json();
  assert.equal(response.status, 200); assert.equal(health.ok, true);
  assert.equal(health.mt5.connection, 'STALE'); assert.equal(health.markets.XAUUSD.connection, 'STALE');
});

test('live gold scalp does not falsely label valid one-bar M5/M15 lag or H1 lag as GAP',()=>{
  const raw=monitorQuote();
  raw.candles.M5.forEach(c=>{c.time-=300;});
  raw.candles.M15.forEach(c=>{c.time-=900;});
  raw.candles.H1.forEach(c=>{c.time-=7200;});
  const s=cleanSnapshot(raw,NOW);
  const market=brokerGoldMarket(s,NOW,{goldStrategy:'SCALP'});
  assert.equal(market.connection,'LIVE');
  assert.notEqual(market.analysis.status,'GAP');
  assert.match(market.analysis.strategy,/GOLD-SCALP/);
  assert.equal(market.analysis.plan?.strategy||market.analysis.strategy,market.analysis.strategy);
  assert.equal(brokerGoldMarket(s,NOW).analysis.status,'GAP',
    'legacy analyzer status is intentionally unchanged');
});
test('scalp market status keeps a real gap in entry or H4 context as GAP',()=>{
  for(const [tf,shift] of [['M5',900],['M15',1800],['H4',28800]]){
    const raw=monitorQuote();
    raw.candles[tf].forEach(c=>{c.time-=shift;});
    const m=brokerGoldMarket(cleanSnapshot(raw,NOW),NOW,{goldStrategy:'SCALP'});
    assert.equal(m.analysis.status,'GAP',tf);
    assert.equal(m.analysis.plan,null);
  }
});
