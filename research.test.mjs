import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from './server.mjs';
import {createTelegramPublisher} from './telegram.mjs';
import {runResearch, validateDataset, simulateWindow, summarize, wilson, parseDailyCSV} from './research-engine.mjs';

const epoch = Date.UTC(2015, 0, 1) / 1000;
const costs = {spreadBps: 2, slippageBps: 1, commissionBps: 1, carryBpsPerDay: .1, acknowledged: true};
function dataset(n = 800) {
  return {symbol: 'TEST_ONLY', source: 'synthetic test fixture; not market performance', timeframe: 'D1', costs: {...costs},
    bars: Array.from({length: n}, (_, i) => {const c = 100 + 10 * Math.sin(i / 16);
      return {time: epoch + i * 86400, open: c, high: c + .1, low: c - .1, close: c};})};
}
function gapExample() {
  const data = dataset();
  data.bars = data.bars.map(b => ({...b, open: 100, high: 101, low: 99, close: 100}));
  data.bars[55] = {...data.bars[55], high: 103, close: 102};
  data.bars[56] = {...data.bars[56], open: 104, high: 106, low: 103, close: 105};
  data.bars[57] = {...data.bars[57], open: 90, high: 91, low: 89, close: 90};
  return data;
}

test('requires explicit costs, closed daily candles and valid ordered OHLC', () => {
  const good = dataset(); assert.equal(validateDataset(good).missingDays, 0);
  for (const mutate of [d => delete d.costs.commissionBps, d => d.costs.acknowledged = false,
    d => d.timeframe = 'M1', d => d.bars[1].time = d.bars[0].time,
    d => d.bars[10].high = d.bars[10].low - 1,
    d => d.bars.at(-1).time = Math.floor(Date.now() / 1000), d => d.bars[40].time += 3600]) {
    const copy = structuredClone(good); mutate(copy); assert.throws(() => runResearch(copy));
  }
  const zero = structuredClone(good);
  for (const k of Object.keys(costs).filter(k => k !== 'acknowledged')) zero.costs[k] = 0;
  assert.equal(validateDataset(zero).zeroCostAssumption, true);
});

test('CSV parses MetaTrader tab export without silently reversing or inventing rows', () => {
  const rows = parseDailyCSV('<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\n2020.01.02\t00:00:00\t10\t12\t9\t11');
  assert.deepEqual(rows, [{time: Date.UTC(2020, 0, 2) / 1000, open: 10, high: 12, low: 9, close: 11}]);
  assert.throws(() => parseDailyCSV('DATE,OPEN,HIGH,LOW,CLOSE\n2020.02.30,10,12,9,11'));
  assert.throws(() => parseDailyCSV('DATE,OPEN,HIGH,LOW,CLOSE\n2020.01.02,,12,9,11'));
});

test('decision at close fills next open; a gap stop can lose more than 1R plus costs', () => {
  const data = gapExample(), result = simulateWindow(data, 'DONCHIAN55_20', 55, 59);
  const first = result.ledger[0];
  assert.equal(first.signalTime, data.bars[55].time); assert.equal(first.entryTime, data.bars[56].time);
  assert.equal(first.entry, 104); assert.equal(first.exit, 90); assert.equal(first.reason, 'STOP_GAP');
  assert.ok(first.grossR < -3); assert.ok(first.r < first.grossR); assert.ok(first.costR > 0);
  const noCosts = structuredClone(data);
  for (const k of Object.keys(costs).filter(k => k !== 'acknowledged')) noCosts.costs[k] = 0;
  assert.equal(simulateWindow(noCosts, 'DONCHIAN55_20', 55, 59).ledger[0].r, first.grossR);
});

test('an open boundary trade is closed, charged and counted rather than discarded', () => {
  const data = gapExample(), report = simulateWindow(data, 'DONCHIAN55_20', 55, 57);
  assert.equal(report.trades, 1); assert.equal(report.boundaryExits, 1);
  assert.equal(report.ledger[0].exit, data.bars[56].close); assert.ok(report.ledger[0].costR > 0);
});

test('future bars cannot change decisions, fills or closed trades in an earlier window', () => {
  const original = dataset(1000), changed = structuredClone(original);
  for (const b of changed.bars.slice(600)) for (const k of ['open', 'high', 'low', 'close']) b[k] *= 10;
  for (const id of ['EMA15_150', 'DONCHIAN55_20']) {
    const a = simulateWindow(original, id, 150, 600), b = simulateWindow(changed, id, 150, 600);
    assert.ok(a.trades > 0); assert.deepEqual(a, b);
    assert.ok(a.ledger.every(t => t.signalTime < t.entryTime && t.entryTime <= t.exitTime));
  }
});

test('all outcomes enter the denominator and chronological windows do not overlap', () => {
  const s = summarize([{r: 2, reason: 'RULE_EXIT'}, {r: -3, reason: 'WINDOW_END'}, {r: 0, reason: 'STOP'}]);
  assert.equal(s.winRate, 1 / 3); assert.equal(s.totalR, -1); assert.equal(s.maxDrawdownR, 3);
  assert.equal(s.profitFactor, 2 / 3); assert.equal(s.boundaryExits, 1);
  assert.equal(wilson(0, 0), null); assert.ok(wilson(100, 100)[0] < 1);
  const report = runResearch(dataset(1000));
  assert.equal(report.publicationAllowed, false); assert.equal(report.claimedSuccessRate, null);
  for (const model of report.results) {
    assert.equal(model.assessment, 'UNVALIDATED_SIMULATION');
    assert.ok(model.windows[0].end < model.windows[1].start);
    assert.ok(model.windows[1].end < model.windows[2].start);
  }
});

test('publisher is paused even with valid configuration; it neither polls signals nor sends', async () => {
  const db = new DatabaseSync(':memory:'); let sources = 0, sends = 0;
  const pub = createTelegramPublisher({db, token: 'fixture', chatId: 'fixture', signals: () => {sources++; return [];},
    fetcher: async () => {sends++; throw Error('should never send');}});
  try {await pub.publish(); assert.equal(pub.status().configured, true); assert.equal(pub.status().enabled, false);
    assert.equal(pub.status().mode, 'PAUSED_RESEARCH'); assert.equal(sources, 0); assert.equal(sends, 0);}
  finally {await pub.close(); db.close();}
});

test('deployed routes and initial SSE expose research policy and no executable market plan', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'nabd-research-'));
  const app = createApplication({dataDir: dir});
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  t.after(async () => {await app.close(); rmSync(dir, {recursive: true, force: true});});
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const catalog = await (await fetch(base + '/api/research')).json();
  assert.equal(catalog.researchPolicy.publicationAllowed, false); assert.ok(catalog.catalog.sources.length >= 8);
  assert.equal(catalog.telegram.enabled, false);
  for (const path of ['/api/state', '/api/market']) {
    const state = await (await fetch(base + path)).json(); assert.equal(state.researchPolicy.mode, 'RESEARCH_ONLY');
    for (const market of Object.values(state.markets || {})) {assert.equal(market.currentSignal, null); assert.equal(market.analysis.setup, null);}
  }
  for (const path of ['/research.html', '/research.js', '/research.css', '/research-engine.mjs']) assert.equal((await fetch(base + path)).status, 200);
  const response = await fetch(base + '/api/events'), reader = response.body.getReader();
  const {value} = await reader.read(); const event = new TextDecoder().decode(value); await reader.cancel();
  assert.match(event, /RESEARCH_ONLY/); assert.match(event, /"currentSignal":null/);
});
