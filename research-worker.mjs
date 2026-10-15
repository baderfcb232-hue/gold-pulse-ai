import {readFeed, retrySeconds} from './feed-http.mjs';
import {runResearch, analyzeDailyContext} from './research-engine.mjs';

const DAY = 86400;
export function parseDailyCandles(raw, start, end, now) {
  if (!Array.isArray(raw) || raw.length > 350) throw Error('Invalid daily response');
  const seen = new Set();
  return raw.map(row => {
    if (!Array.isArray(row) || !Number.isSafeInteger(row[0]) || row[0] % DAY || seen.has(row[0]) ||
      !row.slice(1, 5).every(v => typeof v === 'number' && Number.isFinite(v) && v > 0) ||
      row[1] > Math.min(row[3], row[4]) || row[2] < Math.max(row[3], row[4])) throw Error('Invalid daily candle');
    seen.add(row[0]); return {time: row[0], low: row[1], high: row[2], open: row[3], close: row[4]};
  }).filter(b => b.time >= start && b.time < end && b.time + DAY <= now).sort((a, b) => a.time - b.time);
}

// No order API or publisher is reachable from this worker.
export function createResearchWorker({db, clock = () => Date.now() / 1000, fetcher = fetch,
  brokerSnapshot = () => null, candidates = () => [], costs = {}, onUpdate = () => {}}) {
  if (!costs || typeof costs !== 'object' || Array.isArray(costs)) costs = {};
  db.exec('CREATE TABLE IF NOT EXISTS internal_research (symbol TEXT PRIMARY KEY, data TEXT NOT NULL)');
  const records = {};
  for (const row of db.prepare('SELECT symbol,data FROM internal_research').all()) {
    try {records[row.symbol] = JSON.parse(row.data);} catch {}
  }
  let closed = false, started = false, timer, pending = null, nextFetch = 0, candidateReviews = [];
  const controller = new AbortController();
  const persist = symbol => db.prepare('INSERT INTO internal_research VALUES(?,?) ON CONFLICT(symbol) DO UPDATE SET data=excluded.data')
    .run(symbol, JSON.stringify(records[symbol]));
  function evaluate(symbol, data) {
    const context = analyzeDailyContext(data, clock());
    const costKey = /^BTC/i.test(data.symbol) ? 'BTCUSD' : 'XAUUSD';
    let backtest = {status: 'WAITING_COSTS', publicationAllowed: false};
    if (data.bars.length < 800) backtest.status = 'WAITING_HISTORY';
    else if (costs[costKey]) {
      try {backtest = {status: 'SIMULATION_ONLY', report: runResearch({...data, costs: costs[costKey]}, clock())};}
      catch {backtest = {status: 'INVALID_COSTS_OR_HISTORY', publicationAllowed: false};}
    }
    records[symbol] = {...data, evaluatedAt: clock(), context, backtest, error: null, publicationAllowed: false};
    persist(symbol);
    try {onUpdate({symbol: data.symbol, candles: data.bars.length, status: context.status});} catch {}
  }
  function acceptBrokerDaily(snapshot = brokerSnapshot()) {
    if (!snapshot?.daily_candles?.length) return;
    const symbol = snapshot.symbol, source = `MT5 · ${snapshot.broker}`;
    const key = 'MT5:' + symbol, old = records[key], bars = snapshot.daily_candles;
    if (old?.source === source && old?.bars?.length === bars.length && old.bars.at(-1)?.time === bars.at(-1).time &&
      old.bars.at(-1)?.close === bars.at(-1).close) return;
    try {evaluate(key, {symbol, source, timeframe: 'D1', bars});}
    catch {records[key] = {symbol, source, timeframe: 'D1', error: 'INVALID_OR_INSUFFICIENT_DAILY_HISTORY', publicationAllowed: false}; persist(key);}
  }
  function reviewCandidates() {
    let plans;
    try {plans = candidates(); if (!Array.isArray(plans)) plans = [];} catch {plans = [];}
    candidateReviews = plans.filter(Boolean).slice(0, 10).map(p => {
      const broker = p.source === 'MT5_EA' || String(p.source || '').startsWith('MT5');
      const record = broker ? records['MT5:' + (p.broker_symbol || p.symbol)]
        : String(p.source || '').includes('Coinbase') ? records.BTCUSD : null;
      const context = record?.context, direction = p.side === 'BUY' ? 'UP' : p.side === 'SELL' ? 'DOWN' : null;
      const reason = !direction ? 'INVALID_DIRECTION' : !context ? 'WAITING_MATCHED_DAILY_SOURCE'
        : clock() - context.lastClosedAt > 3 * DAY ? 'STALE_DAILY_SOURCE'
        : context.emaTrend !== direction || (context.donchianBreak && context.donchianBreak !== direction) ? 'DAILY_CONTEXT_OPPOSES'
        : record.backtest?.status !== 'SIMULATION_ONLY' ? 'WAITING_COSTS_OR_VALIDATION' : 'PAPER_REVIEW_ONLY';
      return {id: p.id || null, symbol: p.symbol, reviewedAt: clock(), reason, publicationAllowed: false};
    });
  }
  async function refresh() {
    if (closed || pending) return pending;
    pending = (async () => {
      acceptBrokerDaily();
      if (clock() < nextFetch) return;
      nextFetch = clock() + 3600;
      const end = Math.floor(clock() / DAY) * DAY;
      const cached = records.BTCUSD?.bars || [], start = cached.length >= 800 ? end - 3 * DAY : end - 1200 * DAY;
      const merged = new Map(cached.map(b => [b.time, b]));
      try {
        for (let from = start; from < end; from += 299 * DAY) {
          if (closed) return;
          const to = Math.min(end, from + 299 * DAY);
          const url = new URL('https://api.exchange.coinbase.com/products/BTC-USD/candles');
          url.search = new URLSearchParams({granularity: String(DAY), start: new Date(from * 1000).toISOString(), end: new Date(to * 1000).toISOString()});
          const {response, body} = await readFeed(fetcher, url.toString(), {signal: controller.signal});
          if (!response.ok) {nextFetch = clock() + Math.max(300, retrySeconds(response)); throw Error('Daily feed unavailable');}
          for (const b of parseDailyCandles(JSON.parse(body), from, to, clock())) merged.set(b.time, b);
        }
        const bars = [...merged.values()].filter(b => b.time < end).sort((a, b) => a.time - b.time).slice(-1200);
        if (bars.some((b, i) => i && b.time - bars[i - 1].time !== DAY)) throw Error('Daily history gap');
        evaluate('BTCUSD', {symbol: 'BTCUSD', source: 'Coinbase · BTC-USD · reference', timeframe: 'D1', bars});
      } catch {
        if (!closed) {records.BTCUSD = {...records.BTCUSD, error: 'DAILY_FEED_UNAVAILABLE', checkedAt: clock(), publicationAllowed: false}; persist('BTCUSD');}
      }
    })().finally(() => {reviewCandidates(); pending = null;});
    return pending;
  }
  function status() {
    const markets = Object.fromEntries(Object.entries(records).map(([symbol, r]) => [symbol, {
      source: r.source, candles: r.bars?.length || 0, evaluatedAt: r.evaluatedAt || null, error: r.error,
      context: r.context ? {...r.context, status: clock() - r.context.lastClosedAt > 3 * DAY ? 'STALE' : r.context.status} : null,
      backtest: r.backtest, publicationAllowed: false}]));
    if (!Object.keys(markets).some(s => /XAU|GOLD/i.test(s))) markets.XAUUSD = {status: 'WAITING_BROKER_D1', publicationAllowed: false};
    return {mode: 'INTERNAL_ONLY', running: started && !closed, markets, candidateReviews, publicationAllowed: false};
  }
  return {refresh, acceptBrokerDaily, reviewCandidates, status,
    start() {if (started || closed) return; started = true; refresh().catch(() => {}); timer = setInterval(() => {refresh().catch(() => {});}, 60000); timer.unref();},
    async close() {closed = true; clearInterval(timer); controller.abort(); if (pending) await pending;}};
}
