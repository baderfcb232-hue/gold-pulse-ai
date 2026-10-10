// Deterministic analysis. Scores count conditions; they are not success probabilities.
export const STRATEGY = 'EMA-PULLBACK-1';
export const EA_STRATEGY = 'JUSTMARKETS-EA';
export const TF_SECONDS = {M5: 300, M15: 900, H1: 3600, H4: 14400};
export const defaults = Object.freeze({maxSpreadPoints: 80, quoteTtl: 20,
  calendarTtl: 900, newsBefore: 1800, newsAfter: 1800,
  signalTtl: 900, reward1: 1.5, reward2: 2.5});

export function number(v, label, {min = -Infinity, max = Infinity} = {}) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
    throw new Error(`Invalid ${label}`);
  return v;
}
export function text(v, max = 200) { return String(v ?? '').slice(0, max); }
function cleanEA(raw, now, symbol) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const timestamp = (value, label) => !value ? null : number(value, label, {min: 1, max: now + 5});
  const settings = {};
  for (const key of ['ema_fast','ema_slow','bias_seconds','entry_seconds','max_spread_points',
    'reward_risk','news_before_minutes','news_after_minutes'])
    settings[key] = number(raw.settings?.[key] ?? 0, 'EA ' + key, {min: 0, max: 86400});
  let signal = null;
  const s = raw.signal;
  if (s) {
    const issued = number(s.issued_at, 'EA signal time', {min: 1, max: now + 5});
    if (issued + defaults.signalTtl > now) {
      if (!['BUY','SELL'].includes(s.side)) throw new Error('Invalid EA signal side');
      const entry = number(s.entry, 'EA entry', {min: 0.000001});
      const sl = number(s.sl, 'EA stop', {min: 0.000001});
      const target = number(s.target, 'EA target', {min: 0.000001});
      if (s.side === 'BUY' ? !(sl < entry && entry < target) : !(target < entry && entry < sl))
        throw new Error('Invalid EA signal level orientation');
      signal = {strategy: EA_STRATEGY, source: 'MT5_EA', symbol, side: s.side,
        bar_time: number(s.bar_time, 'EA signal candle', {min: 1, max: issued}),
        issued_at: issued, expires_at: issued + defaults.signalTtl,
        entry, sl, tp1: null, tp2: target, risk_distance: Math.abs(entry - sl),
        score: null, reason: 'خطة الدخول والستوب والهدف كما أصدرها البوت في MT5',
        rsi14: number(s.rsi, 'EA RSI', {min: 0, max: 100}), atr14: number(s.atr, 'EA ATR', {min: 0}),
        tracking: 'VIRTUAL', status: 'TRACKING', tp1_hit: false};
    }
  }
  return {heartbeat_at: timestamp(raw.heartbeat_at, 'EA heartbeat'),
    checked_at: timestamp(raw.checked_at, 'EA check time'), emergency_stop: raw.emergency_stop === true,
    settings, signal};
}
export function cleanSnapshot(raw, now = Date.now() / 1000) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid snapshot');
  const symbol = text(raw.symbol, 40);
  if (!/^[a-zA-Z0-9._#-]{1,40}$/.test(symbol)) throw new Error('Invalid symbol');
  const bid = number(raw.bid, 'bid', {min: 0.000001});
  const ask = number(raw.ask, 'ask', {min: bid});
  const quoteTime = number(raw.quote_at, 'quote_at', {min: now - 86400, max: now + 5});
  const spec = raw.spec ?? {};
  const digits = number(spec.digits, 'digits', {min: 0, max: 8});
  if (!Number.isInteger(digits)) throw new Error('Invalid digits');
  const point = number(spec.point, 'point', {min: 1e-8});
  const tickSize = number(spec.tick_size, 'tick size', {min: 1e-8});
  const specValue = key => number(spec[key] ?? 0, key, {min: 0});
  const candles = {};
  for (const [tf, step] of Object.entries(TF_SECONDS)) {
    const rows = raw.candles?.[tf];
    if (!Array.isArray(rows) || rows.length > 600) throw new Error(`Invalid candles ${tf}`);
    let previous = 0;
    candles[tf] = rows.map(c => {
      const time = number(c.time, 'candle time', {min: 1, max: now});
      if (time <= previous || time + step > now + 2) throw new Error(`Unclosed or unordered ${tf} candle`);
      previous = time;
      const open = number(c.open, 'open', {min: 0.000001});
      const close = number(c.close, 'close', {min: 0.000001});
      const low = number(c.low, 'low', {min: 0.000001, max: Math.min(open, close)});
      const high = number(c.high, 'high', {min: Math.max(open, close, low)});
      return {time, open, high, low, close,
        tick_volume: number(c.tick_volume ?? 0, 'tick volume', {min: 0})};
    });
  }
  const calendar = raw.calendar ?? {};
  const events = Array.isArray(calendar.events) ? calendar.events.slice(0, 200).map(e => ({
    id: text(e.id, 80), name: text(e.name, 250), currency: text(e.currency, 5),
    time: number(e.time, 'event time', {min: 1, max: now + 30 * 86400}),
    importance: number(e.importance, 'importance', {min: 0, max: 3}),
    actual: e.actual == null ? null : number(e.actual, 'actual'),
    forecast: e.forecast == null ? null : number(e.forecast, 'forecast'),
    previous: e.previous == null ? null : number(e.previous, 'previous'),
    unit: text(e.unit, 30), source: 'MetaTrader economic calendar'
  })) : [];
  const updated = typeof calendar.updated_at === 'number' && Number.isFinite(calendar.updated_at)
    && calendar.updated_at <= now + 5 ? calendar.updated_at : null;
  const accountRef = text(raw.account_ref, 100);
  if (!accountRef) throw new Error('An account reference is required to isolate the data source');
  return {symbol, account_ref: accountRef, broker: text(raw.broker, 100), bid, ask, quote_at: quoteTime,
    received_at: now, terminal_connected: raw.terminal_connected === true,
    spec: {digits, point, tick_size: tickSize,
      tick_value_loss: specValue('tick_value_loss'), tick_value_profit: specValue('tick_value_profit'),
      volume_min: specValue('volume_min'), volume_max: specValue('volume_max'),
      volume_step: specValue('volume_step'), stops_points: specValue('stops_points'),
      margin_per_lot: specValue('margin_per_lot'),
      currency: text(spec.currency, 10)},
    ea: cleanEA(raw.ea, now, symbol),
    candles, calendar: {status: calendar.status === 'ok' ? 'ok' : 'unavailable',
      updated_at: updated, events: events.sort((a, b) => a.time - b.time)},
    execution: {enabled: raw.execution?.enabled === true, main_connected: raw.execution?.main_connected === true,
      remote_control: raw.execution?.remote_control === true,
      demo: raw.execution?.demo === true, paused: raw.execution?.paused === true,
      managed_magic: text(raw.execution?.managed_magic, 30),
      small_profit_target: Number(raw.execution?.small_profit_target) || null,
      max_daily_loss_percent: Number(raw.execution?.max_daily_loss_percent) || null,
      risk_percent: Number(raw.execution?.risk_percent) || null,
      news_filter: raw.execution?.news_filter === true},
    account: raw.account && typeof raw.account === 'object' ? {
      currency: text(raw.account.currency, 10),
      balance: number(raw.account.balance, 'balance'), equity: number(raw.account.equity, 'equity'),
      free_margin: number(raw.account.free_margin, 'free margin'),
      floating: number(raw.account.floating, 'floating')
    } : null,
    positions: Array.isArray(raw.positions) ? raw.positions.slice(0, 200).map(p => ({
      ticket: text(p.ticket, 25), side: p.side === 'BUY' ? 'BUY' : 'SELL',
      volume: number(p.volume, 'position volume', {min: 0}),
      entry: number(p.entry, 'position entry', {min: 0}),
      sl: number(p.sl ?? 0, 'position sl', {min: 0}), tp: number(p.tp ?? 0, 'position tp', {min: 0}),
      profit: number(p.profit, 'position profit'), swap: number(p.swap ?? 0, 'swap'),
      opened_at: number(p.opened_at, 'opened at', {min: 1})
    })) : [],
    deals: Array.isArray(raw.deals) ? raw.deals.slice(0, 1000).map(d => ({
      ticket: text(d.ticket, 25), position_id: text(d.position_id, 25),
      time: number(d.time, 'deal time', {min: 1, max: now + 5}),
      side: d.side === 'BUY' ? 'BUY' : 'SELL', entry_type: text(d.entry_type, 12),
      volume: number(d.volume, 'deal volume', {min: 0}), price: number(d.price, 'deal price', {min: 0}),
      profit: number(d.profit, 'profit'), commission: number(d.commission, 'commission'),
      swap: number(d.swap, 'deal swap'), fee: number(d.fee, 'fee')
    })) : []};
}

export function ema(values, period) {
  if (values.length < period) return null;
  let v = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const alpha = 2 / (period + 1);
  for (const x of values.slice(period)) v = x * alpha + v * (1 - alpha);
  return v;
}
export function rsi(values, period = 14) {
  if (values.length <= period) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1]; gain += Math.max(d, 0); loss += Math.max(-d, 0);
  }
  gain /= period; loss /= period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  return loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
}
export function atr(rows, period = 14) {
  if (rows.length <= period) return null;
  const ranges = rows.slice(1).map((c, i) => Math.max(c.high - c.low,
    Math.abs(c.high - rows[i].close), Math.abs(c.low - rows[i].close)));
  let v = ranges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (const x of ranges.slice(period)) v = (v * (period - 1) + x) / period;
  return v;
}
function frame(rows) {
  if (rows.length < 220) return {direction: 'UNKNOWN', count: rows.length};
  const closes = rows.map(c => c.close), last = rows.at(-1);
  const fast = ema(closes, 8), slow = ema(closes, 21), trend = ema(closes, 200);
  const direction = fast > slow && last.close > trend ? 'BUY'
    : fast < slow && last.close < trend ? 'SELL' : 'NEUTRAL';
  return {direction, count: rows.length, ema8: fast, ema21: slow, ema200: trend,
    rsi14: rsi(closes), atr14: atr(rows), close: last.close, closed_at: last.time};
}

// Candle zone: last opposite candle preceding a confirmed break of a 5-bar high/low.
// It does not represent verified institutional orders or centralized market depth.
export function candleZones(rows) {
  const out = {demand: null, supply: null};
  for (let i = Math.max(6, rows.length - 60); i < rows.length; i++) {
    const prior = rows.slice(i - 5, i), c = rows[i];
    for (const side of ['BUY', 'SELL']) {
      const breaks = side === 'BUY' ? c.close > Math.max(...prior.map(x => x.high))
        : c.close < Math.min(...prior.map(x => x.low));
      if (!breaks) continue;
      const opposite = prior.slice().reverse().find(x => side === 'BUY' ? x.close < x.open : x.close > x.open);
      if (!opposite) continue;
      const invalid = rows.slice(i + 1).some(x => side === 'BUY' ? x.close < opposite.low : x.close > opposite.high);
      if (!invalid) out[side === 'BUY' ? 'demand' : 'supply'] = {
        low: opposite.low, high: opposite.high, formed_at: c.time, method: 'five-bar-break'};
    }
  }
  return out;
}
function alignPrice(p, spec, direction = 'nearest') {
  const round = direction === 'down' ? Math.floor : direction === 'up' ? Math.ceil : Math.round;
  return Number((round(p / spec.tick_size) * spec.tick_size).toFixed(spec.digits));
}

export function analyze(snapshot, now = Date.now() / 1000, settings = defaults) {
  const cfg = {...defaults, ...settings};
  const empty = {strategy: STRATEGY, decision: 'WAIT', score: null, risk: 'UNKNOWN',
    reasons: [], checks: [], frames: {}, zones: {demand: null, supply: null}, plan: null};
  if (!snapshot) return {...empty, connection: 'NO_DATA', quote_age: null,
    reasons: ['لم تصل بيانات الأسعار من MT5 بعد.']};
  const age = Math.max(0, now - snapshot.quote_at), heartbeat = now - snapshot.received_at;
  const connection = !snapshot.terminal_connected ? 'DISCONNECTED'
    : age > cfg.quoteTtl || heartbeat > cfg.quoteTtl ? 'STALE'
    : age > 10 || heartbeat > 10 ? 'DELAYED' : 'LIVE';
  const frames = Object.fromEntries(Object.keys(TF_SECONDS).map(tf => [tf, frame(snapshot.candles[tf])]));
  const result = {...empty, connection, quote_age: Math.ceil(age), frames,
    zones: candleZones(snapshot.candles.M5)};
  if (connection !== 'LIVE') return {...result, reasons: ['البيانات متأخرة أو الاتصال منقطع؛ إصدار الإشارات متوقف.']};
  if (Object.values(frames).some(f => f.direction === 'UNKNOWN'))
    return {...result, reasons: ['نحتاج 220 شمعة مغلقة على كل فريم لاكتمال التحليل.']};
  if (Object.entries(TF_SECONDS).some(([tf, step]) => now - (snapshot.candles[tf].at(-1).time + step) > step + 120))
    return {...result, reasons: ['بيانات الشموع قديمة؛ انتظار تحديث الفريمات.']};
  const spreadPoints = (snapshot.ask - snapshot.bid) / snapshot.spec.point;
  if (spreadPoints > cfg.maxSpreadPoints) return {...result, risk: 'BLOCKED',
    reasons: [`السبريد ${Math.round(spreadPoints)} نقطة يتجاوز الحد ${cfg.maxSpreadPoints}.`]};
  const cal = snapshot.calendar;
  if (cal.status !== 'ok' || !cal.updated_at || now - cal.updated_at > cfg.calendarTtl)
    return {...result, reasons: ['التقويم الاقتصادي غير متاح أو قديم؛ فلتر الأخبار يمنع إشارة جديدة.']};
  const news = cal.events.find(e => e.currency === 'USD' && e.importance === 3
    && e.time - cfg.newsBefore <= now && e.time + cfg.newsAfter >= now);
  if (news) return {...result, risk: 'BLOCKED', news_block: news,
    reasons: [`الدخول متوقف حول خبر مرتفع الأهمية: ${news.name}`]};
  const f = frames.M5, rows = snapshot.candles.M5, last = rows.at(-1), prev = rows.at(-2);
  const side = frames.M15.direction === frames.H1.direction ? frames.H1.direction : 'NEUTRAL';
  if (!['BUY', 'SELL'].includes(side)) return {...result, risk: 'CAUTION',
    reasons: ['اتجاه فريم 15 دقيقة والساعة غير متوافق.']};
  const buy = side === 'BUY', v = f.atr14;
  if (!(v > 0)) return {...result, reasons: ['التذبذب غير قابل للحساب.']};
  const checks = [
    {name: 'توافق فريم 15 دقيقة والساعة', pass: true, weight: 25},
    {name: 'الفريم الأكبر لا يعاكس الاتجاه', pass: frames.H4.direction !== (buy ? 'SELL' : 'BUY'), weight: 15},
    {name: 'اتجاه 5 دقائق يؤكد الدخول', pass: f.direction === side, weight: 15},
    {name: 'الزخم ضمن نطاق الاستراتيجية', pass: buy ? f.rsi14 >= 50 && f.rsi14 <= 70 : f.rsi14 >= 30 && f.rsi14 <= 50, weight: 15},
    {name: 'إعادة اختبار المتوسط ثم إغلاق تأكيدي', pass: buy
      ? Math.min(last.low, prev.low) <= f.ema21 + v * 0.45 && last.close > f.ema21 && last.close > prev.high
      : Math.max(last.high, prev.high) >= f.ema21 - v * 0.45 && last.close < f.ema21 && last.close < prev.low, weight: 20},
    {name: 'جسم شمعة واضح دون مطاردة السعر', pass: Math.abs(last.close - last.open) >= v * .1
      && Math.abs((buy ? snapshot.ask : snapshot.bid) - last.close) <= v * .5, weight: 10}
  ];
  const score = checks.reduce((n, c) => n + (c.pass ? c.weight : 0), 0);
  const checked = {...result, checks, score, risk: 'ASSESSED', reasons: checks.filter(c => !c.pass).map(c => c.name)};
  if (checks.some(c => !c.pass)) return checked;
  const entry = alignPrice(buy ? snapshot.ask : snapshot.bid, snapshot.spec);
  const swing = buy ? Math.min(...rows.slice(-6).map(c => c.low)) : Math.max(...rows.slice(-6).map(c => c.high));
  const minimum = Math.max(v, snapshot.spec.stops_points * snapshot.spec.point + snapshot.spec.tick_size,
    snapshot.ask - snapshot.bid + snapshot.spec.tick_size);
  const distance = Math.max(minimum, buy ? entry - swing + v * .2 : swing - entry + v * .2);
  if (distance > v * 3) return {...checked, risk: 'CAUTION', reasons: ['مسافة الستوب أكبر من حد الاستراتيجية.']};
  const sl = alignPrice(entry + (buy ? -distance : distance), snapshot.spec, buy ? 'down' : 'up');
  const riskDistance = Math.abs(entry - sl), sign = buy ? 1 : -1;
  const plan = {strategy: STRATEGY, side, symbol: snapshot.symbol,
    bar_time: last.time, issued_at: Math.floor(now), expires_at: Math.floor(now + cfg.signalTtl),
    entry, sl, tp1: alignPrice(entry + sign * riskDistance * cfg.reward1, snapshot.spec),
    tp2: alignPrice(entry + sign * riskDistance * cfg.reward2, snapshot.spec),
    risk_distance: riskDistance, score, reason: 'توافق الاتجاه + إعادة اختبار EMA21 + شمعة تأكيد',
    tracking: 'VIRTUAL', tp1_hit: false, status: 'TRACKING'};
  return {...checked, decision: side, reasons: [plan.reason], plan};
}

// EA mode uses the locally generated plan unchanged. Website analysis stays available as context.
export function sourceAnalysis(snapshot, now = Date.now() / 1000, settings = {}) {
  const market = analyze(snapshot, now, settings);
  if (settings.signalSource === 'DASHBOARD')
    return {...market, source: 'DASHBOARD', source_ready: market.connection === 'LIVE'};
  const result = {...market, source: 'MT5_EA', strategy: EA_STRATEGY,
    source_ready: false, decision: 'WAIT', plan: null, score: null, checks: [], risk: 'UNKNOWN'};
  if (market.connection !== 'LIVE') return result;
  const ea = snapshot.ea, heartbeatAge = ea?.heartbeat_at == null ? Infinity : now - ea.heartbeat_at;
  if (!snapshot.execution.main_connected || heartbeatAge > 5 || heartbeatAge < -5)
    return {...result, reasons: ['الأسعار وصلت؛ ننتظر حالة البوت التجاري من الجسر على المنصة نفسها.']};
  const ready = {...result, source_ready: true};
  if (ea.emergency_stop || snapshot.execution.paused)
    return {...ready, risk: 'BLOCKED', reasons: [ea.emergency_stop ? 'إيقاف الطوارئ المحلي فعّال في MT5.' : 'دخول صفقات جديدة موقوف من إعدادات الربط.']};
  const signal = ea.signal;
  if (!signal || signal.expires_at <= now)
    return {...ready, risk: 'CAUTION', reasons: ['البوت متصل؛ ينتظر اكتمال شروطه المحلية لإصدار خطة جديدة.']};
  if (snapshot.quote_at < signal.issued_at - 5)
    return {...ready, reasons: ['ننتظر سعرًا حديثًا بعد صدور خطة البوت.']};
  return {...ready, decision: signal.side, risk: 'ASSESSED', reasons: [signal.reason], plan: signal};
}

// Quote-based tracking: never invent fills or infer order execution from a signal.
export function trackPlan(plan, snapshot, now = Date.now() / 1000) {
  if (plan.status !== 'TRACKING') return null;
  if (now >= plan.expires_at) return {status: 'EXPIRED', ended_at: plan.expires_at, exit: null, r: null};
  if (!snapshot || now - snapshot.quote_at > defaults.quoteTtl || !snapshot.terminal_connected) return null;
  if (snapshot.symbol !== plan.symbol || snapshot.quote_at <= plan.issued_at) return null;
  const buy = plan.side === 'BUY', price = buy ? snapshot.bid : snapshot.ask;
  if (buy ? price <= plan.sl : price >= plan.sl) return {status: 'SL', ended_at: now, exit: price, r: (buy ? price - plan.entry : plan.entry - price) / plan.risk_distance};
  if (buy ? price >= plan.tp2 : price <= plan.tp2) return {status: 'TP2', tp1_hit: Number.isFinite(plan.tp1), ended_at: now, exit: price,
    r: (buy ? price - plan.entry : plan.entry - price) / plan.risk_distance};
  if (Number.isFinite(plan.tp1) && !plan.tp1_hit && (buy ? price >= plan.tp1 : price <= plan.tp1)) return {tp1_hit: true, tp1_at: now};
  return null;
}

export function positionSize({equity, riskPercent, entry, sl, spec, commissionPerLot = 0, freeMargin = Infinity}) {
  for (const [k, val] of Object.entries({equity, riskPercent, entry, sl, commissionPerLot})) number(val, k, {min: 0});
  if (!(riskPercent > 0 && riskPercent <= 100 && entry > 0 && sl > 0 && entry !== sl)) throw new Error('Invalid risk inputs');
  if (![spec.tick_size, spec.tick_value_loss, spec.volume_min, spec.volume_step, spec.volume_max].every(x => x > 0))
    throw new Error('مواصفات العقد وقيمة النقطة من البروكر مطلوبة للحساب.');
  const budget = equity * riskPercent / 100;
  const perLot = Math.abs(entry - sl) / spec.tick_size * spec.tick_value_loss + commissionPerLot;
  const volume = Number((Math.floor(Math.min(budget / perLot, spec.volume_max) / spec.volume_step + 1e-9) * spec.volume_step).toFixed(8));
  if (volume < spec.volume_min) return {budget, volume: 0, loss: null, margin: null, reason: 'الحد الأدنى للوت يتجاوز ميزانية المخاطرة.'};
  const margin = spec.margin_per_lot > 0 ? volume * spec.margin_per_lot : null;
  if (Number.isFinite(freeMargin) && margin !== null && margin > freeMargin)
    return {budget, volume: 0, loss: null, margin, reason: 'الهامش المتاح غير كافٍ.'};
  return {budget, volume, loss: perLot * volume, margin,
    reason: margin === null ? 'تقدير؛ الهامش غير متاح ويجب تأكيده في MT5.' : 'تقدير حسب آخر مواصفات وصلتنا؛ التنفيذ يعاد التحقق منه في MT5.'};
}
