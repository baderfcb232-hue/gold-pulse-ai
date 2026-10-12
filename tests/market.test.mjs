import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {scalpAnalysis, aggregateCandles, trackReferencePlan} from '../scalp.mjs';
import {createMarketFeed, parseGoldQuote, parseCoinbaseQuote, parseCoinbaseCandles} from '../market.mjs';
import {createApplication} from '../server.mjs';

const NOW = 1791806400;
function fixture(side = 'BUY') {
  const direction = side === 'BUY' ? 1 : -1;
  const candles = Array.from({length: 240}, (_, i) => {const close = 4000 + direction * (i * .02 + Math.sin(i * .6) * .15);
    return {time: NOW - 240 * 60 + i * 60, open: close - .01 * direction, high: close + .16, low: close - .16, close};});
  const prev = candles.at(-2), last = candles.at(-1);
  last.open = prev.close; last.close = direction === 1 ? prev.high + .02 : prev.low - .02;
  last.high = Math.max(last.close, last.open) + .015; last.low = Math.min(last.close, last.open) - .015;
  return {symbol: 'BTCUSD', source: 'TEST_ONLY', tickSize: .01, quoteTtl: 20, received_at: NOW, candles,
    quote: {price: last.close, bid: last.close - .005, ask: last.close + .005, time: NOW}};
}
const rawCandles = m => m.candles.map(c => [c.time, c.low, c.high, c.open, c.close, 1]);

test('reference parsers validate source time, currency, bid/ask and real candle geometry', () => {
  const q = parseGoldQuote({symbol: 'XAU', currency: 'USD', price: 4100, updatedAt: new Date(NOW * 1000).toISOString()}, NOW);
  assert.equal(q.bid, null); assert.equal(q.ask, null);
  assert.throws(() => parseGoldQuote({symbol: 'XAU', currency: 'EUR', price: 4000, updatedAt: new Date(NOW * 1000).toISOString()}, NOW));
  assert.throws(() => parseCoinbaseQuote({price: '4000', bid: '4010', ask: '4000', time: new Date(NOW * 1000).toISOString()}, NOW));
  assert.throws(() => parseGoldQuote({symbol: 'XAU', price: 4100, updatedAt: new Date((NOW + 60) * 1000).toISOString()}, NOW));
  assert.throws(() => parseCoinbaseCandles([[NOW - 60, 4001, 3999, 4000, 4000]], NOW));
  const parsed = parseCoinbaseCandles([...rawCandles(fixture()), [NOW, 4000, 4001, 4000, 4001]], NOW);
  assert.equal(parsed.length, 240); assert.equal(parsed.at(-1).time, NOW - 60);
});
test('candle aggregation leaves gaps empty and never counts an incomplete M5 as closed', () => {
  const m = fixture(); assert.equal(aggregateCandles(m.candles, 300, NOW).length, 48);
  m.candles.splice(237, 1); const aggregated = aggregateCandles(m.candles, 300, NOW);
  assert.equal(aggregated.length, 47); assert.equal(aggregated.at(-1).time, NOW - 600);
  assert.equal(aggregateCandles([{time: NOW, open: 1, high: 1, low: 1, close: 1}], 300, NOW).length, 0);
});
test('scalping confirms both sides with oriented stops, 1R/1.5R targets and three-minute validity', () => {
  for (const side of ['BUY', 'SELL']) {
    const a = scalpAnalysis(fixture(side), NOW), p = a.plan;
    assert.equal(a.status, 'READY'); assert.equal(p.side, side); assert.equal(p.reference_only, true);
    assert.equal(p.expires_at - p.issued_at, 180);
    assert.ok(side === 'BUY' ? p.sl < p.entry && p.entry < p.tp1 && p.tp1 < p.tp2 : p.sl > p.entry && p.entry > p.tp1 && p.tp1 > p.tp2);
    assert.ok(Math.abs(Math.abs(p.tp2 - p.entry) / p.risk_distance - 1.5) < .03);
  }
});
test('stale quotes, warmup, candle gaps, chase entries, spread and USD news prevent confirmed scalps', () => {
  let m = fixture(); assert.equal(scalpAnalysis({...m, quote: null}, NOW).status, 'NO_DATA');
  assert.equal(scalpAnalysis({...m, received_at: NOW - 30}, NOW).status, 'STALE');
  assert.equal(scalpAnalysis({...m, quote: {...m.quote, time: NOW - 30}}, NOW).plan, null);
  assert.equal(scalpAnalysis({...m, candles: m.candles.slice(-20)}, NOW).status, 'WARMING');
  m = fixture(); m.candles.splice(-6, 1); assert.equal(scalpAnalysis(m, NOW).status, 'GAP');
  m = fixture(); m.quote.price += 5; assert.equal(scalpAnalysis(m, NOW).plan, null);
  m = fixture(); m.quote.ask += 1; assert.equal(scalpAnalysis(m, NOW).plan, null);
  m = {...fixture(), symbol: 'XAUUSD'};
  const calendar = {status: 'ok', updated_at: NOW, events: [{currency: 'USD', importance: 3, time: NOW + 600}]};
  assert.equal(scalpAnalysis(m, NOW, calendar).status, 'NEWS_BLOCK');
  assert.equal(scalpAnalysis(m, NOW, calendar).plan, null);
  assert.equal(scalpAnalysis(m, NOW).calendar_available, false);
});
test('virtual reference tracking uses exit quotes and expires before crediting a late price', () => {
  const p = scalpAnalysis(fixture(), NOW).plan;
  assert.equal(trackReferencePlan(p, {price: p.tp2, bid: p.tp2 - .01, time: NOW + 1}, NOW + 1, 20).status, undefined);
  assert.equal(trackReferencePlan(p, {price: p.tp2, bid: p.tp2, time: NOW + 1}, NOW + 1, 20).status, 'TP2');
  assert.equal(trackReferencePlan(p, {price: p.tp2, time: p.expires_at}, p.expires_at, 20).status, 'EXPIRED');
  assert.equal(trackReferencePlan(p, {price: p.tp2, time: NOW - 30}, NOW + 1, 20), null);
  assert.equal(trackReferencePlan(p, {price: p.tp2, time: NOW}, NOW + 1, 20), null);
});
test('market history persists frozen levels, rejects replay and remains separate from broker telemetry', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'nabd-market-')); let now = NOW;
  const app = createApplication({dataDir: dir, clock: () => now});
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  t.after(async () => {await app.close(); rmSync(dir, {recursive: true, force: true});});
  const feed = app.marketFeed, m = fixture(); feed.acceptHistory(rawCandles(m)); feed.acceptQuote('BTCUSD', m.quote);
  const p = feed.history('BTCUSD')[0]; assert.ok(p);
  now++; feed.acceptQuote('BTCUSD', {...m.quote, time: now, price: m.quote.price + .01});
  assert.equal(feed.history('BTCUSD').length, 1); assert.equal(feed.history('BTCUSD')[0].entry, p.entry);
  assert.equal(feed.acceptQuote('BTCUSD', {...m.quote, time: NOW - 1}), false);
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const broker = await (await fetch(base + '/api/state')).json(); assert.equal(broker.bid, null); assert.equal(broker.connection, 'NO_DATA');
  const market = await (await fetch(base + '/api/market')).json(); assert.equal(market.markets.BTCUSD.connection, 'LIVE'); assert.equal(market.markets.XAUUSD.quote, null);
  assert.equal((await fetch(base + '/api/market/candles?symbol=BTCUSD&tf=M1')).status, 200);
  assert.equal((await fetch(base + '/api/market/candles?symbol=WRONG')).status, 400);
  assert.equal((await fetch(base + '/live.js')).status, 200);
  now += 21; assert.equal(feed.publicState().markets.BTCUSD.currentSignal, null);
  assert.equal(feed.publicState().markets.BTCUSD.analysis.setup, null);
  const res = await fetch(base + '/api/events'), reader = res.body.getReader();
  const {value} = await reader.read(); const events = new TextDecoder().decode(value);
  assert.match(events, /event: market/); assert.match(events, /event: news/); await reader.cancel();
});
test('reference cache survives a restart without making old quotes live', async () => {
  const db = new DatabaseSync(':memory:'); let now = NOW;
  const first = createMarketFeed({db, clock: () => now}); first.acceptHistory(rawCandles(fixture())); first.acceptQuote('BTCUSD', fixture().quote); const p = first.history()[0];
  await first.close(); now += 90;
  const second = createMarketFeed({db, clock: () => now});
  assert.equal(second.history()[0].entry, p.entry); assert.equal(second.publicState().markets.BTCUSD.connection, 'STALE');
  assert.ok(second.candles('BTCUSD', 'M1').candles.length > 200); assert.equal(second.publicState().markets.BTCUSD.currentSignal, null);
  await second.close(); db.close();
});
test('stopping the feed aborts in-flight HTTP requests and closes its public socket', async () => {
  const db = new DatabaseSync(':memory:'); let closed = false;
  const fetcher = (_, options) => new Promise((resolve, reject) => {options.signal.addEventListener('abort', () => reject(new Error('aborted')), {once: true});});
  class Socket {addEventListener() {} close() {closed = true;} }
  const feed = createMarketFeed({db, clock: () => NOW, fetcher, WebSocketImpl: Socket}); feed.start();
  await feed.close(); assert.equal(closed, true); db.close();
});
