import {ema, rsi, atr} from './engine.mjs';

export const SCALP_STRATEGY = 'REFERENCE-SCALP-1';
export const MARKET_TF = {M1: 60, M5: 300, M15: 900};

// Aggregate observations only. Missing intervals are never filled with made-up prices.
export function aggregateCandles(rows, seconds, now, {closedOnly = true} = {}) {
  const groups = new Map();
  for (const c of rows) {
    const time = Math.floor(c.time / seconds) * seconds;
    if (closedOnly && time + seconds > now) continue;
    let g = groups.get(time);
    if (!g) {g = {time, open: c.open, high: c.high, low: c.low, close: c.close,
      count: 0, sampled: false}; groups.set(time, g);}
    g.high = Math.max(g.high, c.high); g.low = Math.min(g.low, c.low);
    g.close = c.close; g.count++; g.sampled ||= Boolean(c.sampled);
  }
  return [...groups.values()].filter(c => !closedOnly || c.count === seconds / 60)
    .map(({count, ...c}) => c);
}

function frame(rows) {
  if (rows.length < 21) return {count: rows.length, direction: 'UNKNOWN'};
  const closes = rows.map(c => c.close), fast = ema(closes, 9), slow = ema(closes, 21);
  return {count: rows.length, direction: fast > slow && closes.at(-1) > slow ? 'BUY'
    : fast < slow && closes.at(-1) < slow ? 'SELL' : 'NEUTRAL', ema9: fast, ema21: slow,
    rsi14: rsi(closes), atr14: atr(rows), closed_at: rows.at(-1).time};
}
const round = (v, tick) => Math.round(v / tick) * tick;

export function scalpAnalysis(market, now, calendar = null) {
  const rows = market.candles.filter(c => c.time + 60 <= now);
  const five = aggregateCandles(rows, 300, now), fifteen = aggregateCandles(rows, 900, now);
  const frames = {M1: frame(rows), M5: frame(five), M15: frame(fifteen)};
  const result = {strategy: SCALP_STRATEGY, decision: 'WAIT', status: 'SCANNING',
    frames, checks: [], score: 0, setup: null, plan: null, reason: '',
    reference_only: true, calendar_available: calendar?.status === 'ok' && now - calendar.updated_at <= 900,
    required_minutes: 110, observed_minutes: rows.length};
  if (!market.quote) return {...result, status: 'NO_DATA', reason: 'بانتظار أول سعر من المصدر.'};
  if (now - market.quote.time > market.quoteTtl || now - market.received_at > market.quoteTtl)
    return {...result, status: 'STALE', reason: 'السعر متأخر؛ التحليل السابق والشارت محفوظان، وإصدار فرص جديدة متوقف.'};
  if (rows.length < 35 || five.length < 21)
    return {...result, status: 'WARMING', reason: 'يجري تجميع شموع حقيقية للتحليل. الذهب المجاني يبدأ سجلّه من أول تشغيل؛ يمكن متابعة بيتكوين فور تحميل تاريخه.'};
  const recent = rows.slice(-35);
  if (recent.some((c, i) => i && c.time - recent[i - 1].time !== 60) ||
      five.slice(-21).some((c, i, all) => i && c.time - all[i - 1].time !== 300) ||
      now - (rows.at(-1).time + 60) > 90 || now - (five.at(-1).time + 300) > 360)
    return {...result, status: 'GAP', reason: 'هناك فجوة أو تأخر في الشموع؛ ننتظر بيانات متصلة قبل إصدار فرصة.'};
  const m1 = frames.M1, m5 = frames.M5, last = rows.at(-1), prev = rows.at(-2);
  const side = m1.direction === m5.direction && ['BUY', 'SELL'].includes(m1.direction) ? m1.direction : null;
  const buy = side === 'BUY', vol = m1.atr14;
  const recentNews = calendar?.status === 'ok' && now - calendar.updated_at <= 900
    ? calendar.events.filter(x => x.currency === 'USD' && x.importance === 3 && Math.abs(x.time - now) <= 1800) : [];
  const newsSafe = market.symbol !== 'XAUUSD' || recentNews.length === 0;
  const momentum = Boolean(side && (buy ? m1.rsi14 >= 48 && m1.rsi14 <= 72 : m1.rsi14 >= 28 && m1.rsi14 <= 52));
  const spread = market.quote.ask && market.quote.bid ? market.quote.ask - market.quote.bid : null;
  const spreadSafe = spread == null || (vol > 0 && spread <= vol * .15);
  const confirmation = Boolean(side && (buy ? last.close > prev.high && last.close > last.open
    : last.close < prev.low && last.close < last.open) && Math.abs(last.close - last.open) >= vol * .15);
  const near = vol > 0 && Math.abs(market.quote.price - last.close) <= vol * .65;
  const tests = [['اتجاه الدقيقة و5 دقائق متوافق', Boolean(side)], ['زخم RSI مناسب', momentum],
    ['تأكيد بشمعة دقيقة مغلقة', confirmation], ['السعر قريب من منطقة الدخول', near],
    [spread == null ? 'السبريد غير متاح؛ طابقه في البروكر' : 'السبريد المرجعي مناسب', spread == null ? null : spreadSafe],
    [result.calendar_available ? 'لا يوجد حدث دولار مرتفع قريب في التقويم المتاح' : 'التقويم غير متاح؛ راجع مواعيد البيانات',
      market.symbol === 'BTCUSD' ? true : result.calendar_available ? newsSafe : null]];
  result.checks = tests.map(([name, pass]) => ({name, pass}));
  result.score = Math.round(tests.filter(x => x[1]).length / tests.length * 100);
  if (!side || !(vol > 0)) return {...result, reason: 'نبحث عن اتجاه متوافق على الدقيقة و5 دقائق.'};
  const tick = market.tickSize, swing = rows.slice(-6);
  const trigger = round(buy ? last.high + tick : last.low - tick, tick);
  const entry = confirmation && near ? (buy ? market.quote.ask ?? market.quote.price : market.quote.bid ?? market.quote.price) : trigger;
  const sl = round(buy ? Math.min(Math.min(...swing.map(c => c.low)) - vol * .15, entry - vol)
    : Math.max(Math.max(...swing.map(c => c.high)) + vol * .15, entry + vol), tick);
  const risk = Math.abs(entry - sl);
  if (risk > vol * 3 || risk <= tick || sl <= 0)
    return {...result, reason: 'وقف الخسارة بعيد عن نطاق المضاربة؛ ننتظر تكوينًا أوضح.'};
  const plan = {strategy: SCALP_STRATEGY, source: market.source, symbol: market.symbol, side,
    entry: round(entry, tick), sl, tp1: round(entry + (buy ? 1 : -1) * risk, tick),
    tp2: round(entry + (buy ? 1 : -1) * risk * 1.5, tick), risk_distance: risk,
    bar_time: last.time, issued_at: now, quote_time: market.quote.time, expires_at: now + 180,
    reference_only: true, sampled: Boolean(last.sampled), status: 'TRACKING'};
  const ready = momentum && spreadSafe && confirmation && near && newsSafe;
  result.setup = {...plan, status: 'WATCH', expires_at: last.time + 180};
  if (ready) return {...result, decision: side, status: 'READY', plan,
    reason: 'تحقق الاتجاه والزخم وتأكيد شمعة مغلقة على المصدر المرجعي. طابق سعر الدخول والسبريد لدى بروكرك.'};
  return {...result, status: newsSafe ? 'WATCH' : 'NEWS_BLOCK',
    reason: newsSafe ? 'فرصة مراقبة مشروطة؛ انتظر تأكيد الشمعة والزخم وقرب السعر قبل الدخول.' : 'الدخول متوقف حول حدث دولار مرتفع الأهمية.'};
}

export function trackReferencePlan(plan, quote, now, ttl) {
  if (plan.status !== 'TRACKING') return null;
  // Expiry is checked first: a late quote cannot retrospectively manufacture a fill.
  if (now >= plan.expires_at) return {status: 'EXPIRED', resolved_at: now};
  if (!quote || now - quote.time > ttl || quote.time <= plan.quote_time || quote.time <= plan.last_tracked_at) return null;
  const price = plan.side === 'BUY' ? quote.bid ?? quote.price : quote.ask ?? quote.price;
  const hitStop = plan.side === 'BUY' ? price <= plan.sl : price >= plan.sl;
  const hitTarget = plan.side === 'BUY' ? price >= plan.tp2 : price <= plan.tp2;
  const hitFirst = plan.side === 'BUY' ? price >= plan.tp1 : price <= plan.tp1;
  return {last_tracked_at: quote.time, ...(hitStop || hitTarget ? {status: hitStop ? 'SL' : 'TP2',
    exit: price, resolved_at: now} : {}), ...(hitFirst ? {tp1_hit: true} : {})};
}
