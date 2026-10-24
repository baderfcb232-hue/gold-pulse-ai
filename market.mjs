import {scalpAnalysis, aggregateCandles, MARKET_TF, trackReferencePlan} from './scalp.mjs';
import {readFeed, cacheSeconds, retrySeconds} from './feed-http.mjs';
import {brokerGoldMarket, brokerBtcMarket} from './broker-market.mjs';

export const MARKET_CONFIG = Object.freeze({
  XAUUSD: {symbol: 'XAUUSD', name: 'الذهب', source: 'Gold API', sourceUrl: 'https://gold-api.com/docs',
    tickSize: .01, quoteTtl: 90, cadence_seconds: 30, candle_kind: 'SAMPLED_REFERENCE', market_hours: 'جلسات الذهب؛ لا توجد أسعار جديدة أثناء إغلاق المصدر'},
  BTCUSD: {symbol: 'BTCUSD', name: 'بيتكوين', source: 'Coinbase · BTC-USD', sourceUrl: 'https://exchange.coinbase.com/trade/BTC-USD',
    tickSize: .01, quoteTtl: 20, cadence_seconds: 1, candle_kind: 'EXCHANGE_AND_OBSERVATIONS', market_hours: 'سوق العملات الرقمية على مدار الأسبوع'}
});
const validPrice = x => typeof x === 'number' && Number.isFinite(x) && x > 0;
const epoch = v => Date.parse(v) / 1000;

export function parseGoldQuote(raw, now) {
  const time = epoch(raw.updatedAt);
  if (raw.symbol !== 'XAU' || (raw.currency && raw.currency !== 'USD') || !validPrice(raw.price) || !(time > 0 && time <= now + 5))
    throw new Error('Invalid gold quote');
  return {price: raw.price, time, bid: null, ask: null};
}
export function parseCoinbaseQuote(raw, now) {
  const price = Number(raw.price), bid = Number(raw.best_bid ?? raw.bid), ask = Number(raw.best_ask ?? raw.ask), time = epoch(raw.time);
  if (!validPrice(price) || !validPrice(bid) || !validPrice(ask) || ask < bid || !(time > 0 && time <= now + 5))
    throw new Error('Invalid Coinbase quote');
  return {price, bid, ask, time};
}
export function parseCoinbaseCandles(raw, now) {
  if (!Array.isArray(raw) || raw.length > 350) throw new Error('Invalid candle response');
  const seen = new Set();
  return raw.map(c => {
    if (!Array.isArray(c) || !Number.isInteger(c[0]) || c[0] <= 0 || c[0] % 60 ||
      !c.slice(1, 5).every(validPrice) || c[1] > Math.min(c[3], c[4]) || c[2] < Math.max(c[3], c[4]) || seen.has(c[0]))
      throw new Error('Invalid candle');
    seen.add(c[0]); return {time: c[0], low: c[1], high: c[2], open: c[3], close: c[4], sampled: false};
  }).filter(c => c.time + 60 <= now).sort((a, b) => a.time - b.time);
}

export function createMarketFeed({db, clock = () => Date.now() / 1000, fetcher = fetch,
  WebSocketImpl = globalThis.WebSocket, calendar = () => null, brokerSnapshot = () => null, brokerSnapshotBTC = () => null, onChange = () => {}}) {
  db.exec(`CREATE TABLE IF NOT EXISTS market_cache (symbol TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS market_signals (id TEXT PRIMARY KEY, issued_at REAL NOT NULL, data TEXT NOT NULL);`);
  const markets = {};
  for (const [symbol, config] of Object.entries(MARKET_CONFIG)) {
    let saved = {};
    try {saved = JSON.parse(db.prepare('SELECT data FROM market_cache WHERE symbol=?').get(symbol)?.data || '{}');} catch {}
    markets[symbol] = {...config, quote: saved.quote || null, received_at: saved.received_at || 0,
      candles: saved.candles || [], revision: 0, checked_at: null, transport: 'REST', feed_error: null};
  }
  const controller = new AbortController(), pending = new Set(), busy = new Set();
  let stopped = false, running = false, timer, socket, socketHeartbeat = 0, socketMessage = 0, socketOpened = 0;
  let revision = 0, nextGold = 0, nextBtc = 0, nextHistory = 0, nextSocket = 0, socketFailures = 0;
  let historyFailures = 0, goldFailures = 0, btcFailures = 0;
  const history = symbol => db.prepare('SELECT data FROM market_signals ORDER BY issued_at DESC LIMIT 400').all()
    .map(x => JSON.parse(x.data)).filter(p => !symbol || p.symbol === symbol).slice(0, 100);
  const marketFor = symbol => symbol === 'XAUUSD'
    ? brokerGoldMarket(brokerSnapshot(), clock()) || markets[symbol]
    : symbol === 'BTCUSD' ? brokerBtcMarket(brokerSnapshotBTC(), clock()) || markets[symbol] : markets[symbol];
  const sameSource = (plan, market) => (plan.source_id || 'REFERENCE') === (market.source_id || 'REFERENCE');
  const persist = symbol => {const m = markets[symbol]; db.prepare('INSERT INTO market_cache VALUES(?,?) ON CONFLICT(symbol) DO UPDATE SET data=excluded.data')
    .run(symbol, JSON.stringify({quote: m.quote, received_at: m.received_at, candles: m.candles.slice(-1500)}));};
  function savePlan(plan) {db.prepare('UPDATE market_signals SET data=? WHERE id=?').run(JSON.stringify(plan), plan.id);}
  function updatePlans(symbol) {
    const m = marketFor(symbol), now = clock();
    for (const p of history(symbol).filter(p => p.status === 'TRACKING' && sameSource(p, m))) {
      const fresh = now - m.received_at <= m.quoteTtl && (!m.broker_mode || m.connection === 'LIVE');
      const change = trackReferencePlan(p, fresh ? m.quote : null, now, m.quoteTtl);
      if (change) savePlan({...p, ...change});
    }
    const a = m.broker_mode ? m.analysis : scalpAnalysis(m, now, calendar()); m.analysis = a;
    if (a.plan && !history(symbol).some(p => p.status === 'TRACKING' && sameSource(p, m))) {
      const p = a.plan, id = `${p.strategy}:${symbol}:${p.source_id ? p.source_id + ':' : ''}${p.bar_time}:${p.side}`;
      db.prepare('INSERT OR IGNORE INTO market_signals VALUES(?,?,?)').run(id, p.issued_at, JSON.stringify({...p, id}));
      db.prepare('DELETE FROM market_signals WHERE id NOT IN (SELECT id FROM market_signals ORDER BY issued_at DESC LIMIT 400)').run();
    }
  }
  function acceptQuote(symbol, quote) {
    if (stopped) return false;
    const m = markets[symbol];
    if (!m || !validPrice(quote.price) || !(quote.time > 0 && quote.time <= clock() + 5) || quote.time < (m.quote?.time || 0)) return false;
    const isNew = quote.time > (m.quote?.time || 0);
    m.received_at = clock(); m.quote = quote; m.feed_error = null;
    if (isNew) {
      const time = Math.floor(quote.time / 60) * 60, last = m.candles.at(-1);
      if (last && last.time === time) {
        last.high = Math.max(last.high, quote.price); last.low = Math.min(last.low, quote.price); last.close = quote.price;
      } else if (!last || time > last.time) {
        m.candles.push({time, open: quote.price, high: quote.price, low: quote.price, close: quote.price, sampled: true});
        m.candles = m.candles.slice(-1500); persist(symbol);
      }
      m.revision++; revision++;
      if (!m.last_analysis_at || clock() - m.last_analysis_at >= 1 || last?.time !== time) {
        m.last_analysis_at = clock(); updatePlans(symbol);
      }
    }
    return true;
  }
  function acceptHistory(raw) {
    const incoming = parseCoinbaseCandles(raw, clock()), m = markets.BTCUSD;
    const merged = new Map(m.candles.map(c => [c.time, c]));
    for (const c of incoming) merged.set(c.time, c);
    m.candles = [...merged.values()].sort((a, b) => a.time - b.time).slice(-1500);
    m.history_revision = (m.history_revision || 0) + 1;
    m.revision++; revision++; persist('BTCUSD'); updatePlans('BTCUSD');
  }
  function publicMarket(symbol) {
    const m = marketFor(symbol), now = clock();
    let a = m.analysis || scalpAnalysis(m, now, calendar());
    const age = m.quote ? Math.max(0, now - m.quote.time) : null;
    const fresh = m.quote && age <= m.quoteTtl && now - m.received_at <= m.quoteTtl
      && (!m.broker_mode || m.connection === 'LIVE');
    if (!fresh && m.quote) a = {...a, decision: 'WAIT', status: 'STALE', plan: null, setup: null,
      reason: 'السعر متأخر أو المصدر مغلق؛ الشارت محفوظ وإصدار فرص جديدة متوقف.'};
    const plans = history(symbol).filter(p => sameSource(p, m));
    const active = plans.find(p => p.status === 'TRACKING' && p.expires_at > now) || null;
    if (a.plan && !active && plans.some(p => p.bar_time === a.plan.bar_time && p.side === a.plan.side))
      a = {...a, decision: 'WAIT', status: 'SCANNING', setup: null, reason: 'انتهت متابعة هذا التكوين؛ ننتظر تأكيدًا من شمعة جديدة.'};
    const available = fresh && !['NEWS_BLOCK', 'WARMING', 'GAP', 'BLOCKED'].includes(a.status);
    if (!available) a = {...a, setup: null};
    const defaultTf = m.default_tf || 'M1', step = MARKET_TF[defaultTf];
    const recentRows = m.candles.filter(c => c.time + step <= now), last = recentRows.at(-1)?.close;
    return {symbol, name: m.name, source: m.source, sourceUrl: m.sourceUrl, quote: m.quote,
      source_id: m.source_id || 'REFERENCE', broker_symbol: m.broker_symbol || null,
      default_tf: defaultTf, chart_tfs: m.chart_tfs || ['M1', 'M5', 'M15'],
      revision: m.revision, received_at: m.received_at || null, checked_at: m.checked_at,
      connection: m.broker_mode ? m.connection : !m.quote ? 'NO_DATA' : fresh ? 'LIVE' : 'STALE', quoteAge: age,
      quoteTtl: m.quoteTtl, cadence_seconds: m.cadence_seconds, candle_kind: m.candle_kind,
      history_revision: m.history_revision || 0,
      chart_tail: m.broker_mode ? Object.fromEntries(m.chart_tfs.map(tf => [tf, m.bars[tf].slice(-2)]))
        : {M1: m.candles.slice(-2), M5: aggregateCandles(m.candles, 300, now, {closedOnly: false}).slice(-2),
        M15: aggregateCandles(m.candles, 900, now, {closedOnly: false}).slice(-2)},
      market_hours: m.market_hours, transport: m.transport, feed_error: m.feed_error,
      minute_count: recentRows.length * step / 60, last_bar: recentRows.at(-1)?.time || null,
      change_from_last_close: last && m.quote ? (m.quote.price / last - 1) * 100 : null,
      analysis: {...a, plan: undefined}, currentSignal: available ? active : null,
      suspendedSignal: !available && active ? active.id : null,
      recentSignals: plans.slice(0, 8)};
  }
  const publicState = () => ({revision, serverTime: clock(), refresh_seconds: 1,
    markets: Object.fromEntries(Object.keys(markets).map(s => [s, publicMarket(s)]))});
  const candles = (symbol, tf) => {
    const m = marketFor(symbol); if (!m || !MARKET_TF[tf]) return null;
    if (m.broker_mode) return m.bars[tf] ? {symbol, tf, source: m.source, source_id: m.source_id,
      broker_symbol: m.broker_symbol, reference_only: true, candle_kind: m.candle_kind,
      candles: m.bars[tf].slice(-320)} : null;
    if (!['M1', 'M5', 'M15'].includes(tf)) return null;
    return {symbol, tf, source: m.source, reference_only: true, candle_kind: m.candle_kind,
      candles: tf === 'M1' ? m.candles.slice(-320) : aggregateCandles(m.candles, MARKET_TF[tf], clock(), {closedOnly: false}).slice(-320)};
  };
  function job(name, fn) {
    if (busy.has(name) || stopped) return;
    busy.add(name);
    const task = (async () => {try {await fn();} catch {} finally {busy.delete(name);}})();
    pending.add(task); task.finally(() => pending.delete(task));
  }
  async function gold() {
    const m = markets.XAUUSD; nextGold = clock() + 30;
    try {
      const {response, body} = await readFeed(fetcher, 'https://api.gold-api.com/price/XAU', {signal: controller.signal, maxBytes: 20000});
      if (stopped) return;
      if (!response.ok) {nextGold = clock() + retrySeconds(response, 30 * 2 ** Math.min(++goldFailures, 6)); throw new Error();}
      acceptQuote('XAUUSD', parseGoldQuote(JSON.parse(body), clock())); goldFailures = 0;
      nextGold = clock() + cacheSeconds(response, 30); m.checked_at = clock();
    } catch {if (!stopped) {m.feed_error = 'تعذر جلب سعر الذهب؛ نحتفظ بآخر سعر ووقته.'; nextGold = Math.max(nextGold, clock() + 30);}}
  }
  async function btc() {
    const m = markets.BTCUSD; nextBtc = clock() + 1;
    try {
      const {response, body} = await readFeed(fetcher, 'https://api.exchange.coinbase.com/products/BTC-USD/ticker', {signal: controller.signal, maxBytes: 20000});
      if (stopped) return;
      if (!response.ok) {nextBtc = clock() + retrySeconds(response, 2 ** Math.min(++btcFailures, 6)); throw new Error();}
      acceptQuote('BTCUSD', parseCoinbaseQuote(JSON.parse(body), clock())); btcFailures = 0;
      nextBtc = clock() + cacheSeconds(response, 1); m.checked_at = clock();
    } catch {if (!stopped) {m.feed_error = 'بث بيتكوين متأخر؛ تجري محاولة إعادة الاتصال.'; nextBtc = Math.max(nextBtc, clock() + 5);}}
  }
  async function bootstrap() {
    nextHistory = clock() + 300;
    const end = Math.floor(clock() / 60) * 60;
    const url = new URL('https://api.exchange.coinbase.com/products/BTC-USD/candles');
    url.search = new URLSearchParams({granularity: '60', start: new Date((end - 299 * 60) * 1000).toISOString(), end: new Date(end * 1000).toISOString()});
    try {
      const {response, body} = await readFeed(fetcher, url.href, {signal: controller.signal});
      if (stopped) return;
      if (!response.ok) {nextHistory = clock() + retrySeconds(response, 30 * 2 ** Math.min(++historyFailures, 6)); throw new Error();}
      acceptHistory(JSON.parse(body)); historyFailures = 0;
      nextHistory = clock() + cacheSeconds(response, 300);
    } catch {if (!stopped) nextHistory = Math.max(clock() + 30, nextHistory);}
  }
  function connect() {
    if (!WebSocketImpl || stopped) return;
    try {
      const ws = new WebSocketImpl('wss://ws-feed.exchange.coinbase.com'); socket = ws; socketOpened = clock();
      ws.addEventListener('open', () => {if (stopped) return ws.close(); ws.send(JSON.stringify({type: 'subscribe', product_ids: ['BTC-USD'], channels: ['ticker', 'heartbeat']}));});
      ws.addEventListener('message', event => {
        if (stopped || socket !== ws || typeof event.data !== 'string' || event.data.length > 100000) return;
        try {
          const m = JSON.parse(event.data);
          if (m.product_id !== 'BTC-USD') return;
          if (m.type === 'heartbeat') {socketHeartbeat = clock(); socketFailures = 0;}
          if (m.type === 'ticker') {
            if (acceptQuote('BTCUSD', parseCoinbaseQuote(m, clock()))) {
              socketMessage = clock(); markets.BTCUSD.transport = 'WebSocket'; markets.BTCUSD.checked_at = clock();
            }
          }
        } catch {}
      });
      ws.addEventListener('error', () => ws.close());
      ws.addEventListener('close', () => {if (socket !== ws) return; socket = null; socketHeartbeat = 0;
        nextSocket = clock() + Math.min(60, 2 ** Math.min(++socketFailures, 6)); markets.BTCUSD.transport = 'REST';});
    } catch {socket = null; nextSocket = clock() + 15;}
  }
  function tick() {
    if (stopped) return;
    const now = clock();
    if (!brokerGoldMarket(brokerSnapshot(), now) && now >= nextGold) job('gold', gold);
    if (!socket || now - socketMessage > 15) {markets.BTCUSD.transport = 'REST'; if (now >= nextBtc) job('btc', btc);}
    if (now >= nextHistory) job('history', bootstrap);
    if (socket && now - Math.max(socketHeartbeat, socketOpened) > 20) socket.close();
    if (!socket && now >= nextSocket) connect();
    for (const symbol of Object.keys(markets)) {
      const active = history(symbol).find(p => p.status === 'TRACKING');
      if (active && active.expires_at <= now) savePlan({...active, status: 'EXPIRED', resolved_at: now});
    }
    onChange();
  }
  return {publicState, candles, history, acceptQuote, acceptHistory,
    start() {if (running || stopped) return; running = true; tick(); timer = setInterval(tick, 1000); timer.unref();},
    async close() {stopped = true; clearInterval(timer); controller.abort();
      if (socket) {try {socket.close();} catch {}} await Promise.allSettled([...pending]);
      for (const s of Object.keys(markets)) persist(s);},
    recalculate() {for (const s of Object.keys(markets)) updatePlans(s);}
  };
}
