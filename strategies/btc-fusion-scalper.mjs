// NABD BTC FUSION SCALPER V2 — broker-fed closed-candle strategy, no direct order dispatch.
import {analyze, ema, rsi, atr, defaults, TF_SECONDS} from '../engine.mjs';
export const BTC_FUSION_STRATEGY = 'NABD-BTC-FUSION-M5M15-V2';
const sideOf = (fast, slow, close) => fast > slow && close > slow ? 'BUY' : fast < slow && close < slow ? 'SELL' : 'WAIT';
const align = (value, spec, rounding = 'nearest') => {
  const op = rounding === 'down' ? Math.floor : rounding === 'up' ? Math.ceil : Math.round;
  return Number((op(value / spec.tick_size) * spec.tick_size).toFixed(spec.digits));
};
function adxWilder(bars, period = 14) {
  if (!Array.isArray(bars) || bars.length < 2 * period + 2) return NaN;
  let tr = 0, plus = 0, minus = 0; const dx = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1], cur = bars[i];
    const up = cur.high - prev.high, down = prev.low - cur.low;
    const trueRange = Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close));
    const plusDM = up > down && up > 0 ? up : 0;
    const minusDM = down > up && down > 0 ? down : 0;
    if (i <= period) {
      tr += trueRange; plus += plusDM; minus += minusDM;
      if (i < period) continue;
    } else {
      tr = tr - tr / period + trueRange; plus = plus - plus / period + plusDM; minus = minus - minus / period + minusDM;
    }
    const pdi = tr > 0 ? plus / tr * 100 : 0;
    const mdi = tr > 0 ? minus / tr * 100 : 0;
    dx.push(pdi + mdi > 0 ? 100 * Math.abs(pdi - mdi) / (pdi + mdi) : 0);
  }
  if (dx.length < period) return NaN;
  let adx = dx.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (const value of dx.slice(period)) adx = ((period - 1) * adx + value) / period;
  return adx;
}
function candlesReady(snapshot, now) {
  for (const [tf, seconds] of Object.entries(TF_SECONDS)) {
    const bars = snapshot?.candles?.[tf];
    if (!Array.isArray(bars) || bars.length < 220) return false;
    const last = bars.at(-1);
    if (!Number.isFinite(last?.time) || last.time + seconds > now + 5 ||
        now - (last.time + seconds) > seconds + 120) return false;
    for (let i = bars.length - 2; i >= bars.length - 4; i--)
      if (!Number.isFinite(bars[i]?.time) || bars[i + 1].time - bars[i].time !== seconds) return false;
  }
  return true;
}
export function analyzeBtcFusion(snapshot, now = Date.now() / 1000) {
  const legacy = analyze(snapshot, now, {...defaults, maxSpreadPoints: 100000000});
  // Diagnostic-only prerequisites: pending steps are never counted as passed.
  // These do not alter trading gates, risk caps, or order dispatch.
  const readinessChecks = [
    'وصول سعر بيتكوين حديث من MT5',
    'توفر 220 شمعة مغلقة حديثة لكل فريم',
    'صلاحية التقويم الاقتصادي',
    'خارج نافذة منع الأخبار عالية التأثير',
    'صحة سعر ومواصفات عقد الوسيط',
    'السبريد ضمن حدود الوسيط وATR',
    'اتجاه M15 واضح أو حيادي قريب من المتوسطات مع تأكيد H1',
    'عدم تعارض الفريمات العليا مع اتجاه الدخول'
  ].map(name => ({name, pass: null}));
  const mark = (index, pass) => (readinessChecks[index].pass = Boolean(pass));
  const base = {...legacy, strategy: BTC_FUSION_STRATEGY, decision: 'WAIT', plan: null,
    checks: [], readinessChecks, score: null, risk: 'CAUTION', reasons: []};
  const wait = (reason, risk = 'CAUTION', extras = {}) => ({...base, risk, reasons: [reason], ...extras});
  if (!snapshot || !/^BTCUSD(?:[._#][A-Za-z0-9._#-]+)?$/i.test(snapshot.symbol || ''))
    return wait('FUSION: BTCUSD broker MT5 data required.', 'BLOCKED');
  if (!mark(0, legacy.connection === 'LIVE')) return wait('FUSION: stale or disconnected broker quotes.', 'BLOCKED');
  if (!mark(1, candlesReady(snapshot, now))) return wait('FUSION: need 220 recent closed consecutive M5/M15/H1/H4 bars.', 'BLOCKED');
  const calendar = snapshot.calendar;
  if (!mark(2, calendar?.status === 'ok' && Number.isFinite(calendar.updated_at) &&
      now - calendar.updated_at <= defaults.calendarTtl && Array.isArray(calendar.events)))
    return wait('FUSION: economic calendar missing or stale.', 'BLOCKED');
  const news = calendar.events.find(e => e.currency === 'USD' && e.importance === 3 &&
    e.time - defaults.newsBefore <= now && now <= e.time + defaults.newsAfter);
  if (!mark(3, !news)) return wait('FUSION: USD high-impact news window: ' + news.name, 'BLOCKED', {news_block: news});
  const {M5: m5, M15: m15, H1: h1, H4: h4} = snapshot.candles;
  const point = snapshot.spec?.point, tick = snapshot.spec?.tick_size, spread = snapshot.ask - snapshot.bid;
  if (!mark(4, snapshot.bid > 0 && snapshot.ask >= snapshot.bid && point > 0 && tick > 0))
    return wait('FUSION: invalid broker quote/spec.', 'BLOCKED');
  const mid = (snapshot.ask + snapshot.bid) / 2;
  const spreadCap = Math.max(1, Math.floor(mid * .001 / point));
  const localCap = snapshot.ea?.settings?.max_spread_points;
  const allowedPoints = Number.isFinite(localCap) && localCap > 0 ? Math.min(localCap, spreadCap) : spreadCap;
  const close5 = m5.map(x => x.close), close15 = m15.map(x => x.close);
  const last = m5.at(-1), prev = m5.at(-2), vol = atr(m5, 14), momentum = rsi(close5, 14);
  if (!(vol > 0) || !Number.isFinite(momentum)) return wait('FUSION: invalid ATR/RSI.', 'BLOCKED');
  const spreadOk = spread / point <= allowedPoints && spread <= vol * .18;
  if (!mark(5, spreadOk)) return wait('FUSION: excessive broker spread relative to ATR.', 'BLOCKED');
  const m15Fast = ema(close15, 8), m15Slow = ema(close15, 21);
  const m15Side = sideOf(m15Fast, m15Slow, m15.at(-1).close);
  const h1Side = sideOf(ema(h1.map(x => x.close), 50), ema(h1.map(x => x.close), 200), h1.at(-1).close);
  const h4Closes = h4.map(x => x.close);
  const h4Raw = sideOf(ema(h4Closes, 8), ema(h4Closes, 21), h4.at(-1).close);
  const h4Side = h4Raw === 'BUY' && h4.at(-1).close > ema(h4Closes, 200) ? 'BUY' :
    h4Raw === 'SELL' && h4.at(-1).close < ema(h4Closes, 200) ? 'SELL' : 'WAIT';
  // Hierarchical confirmation: H1 gives context; neutral M15 may defer to H1
  // only near its EMA band. An explicitly opposite M15 or H4 is never coerced.
  const vol15 = atr(m15, 14);
  const neutralM15NearBand = m15Side === 'WAIT' && vol15 > 0 &&
    Math.abs(m15Fast - m15Slow) <= vol15 * .25 &&
    Math.abs(m15.at(-1).close - m15Slow) <= vol15 * .7;
  const side = m15Side !== 'WAIT' ? m15Side :
    neutralM15NearBand && h1Side !== 'WAIT' ? h1Side : 'WAIT';
  if (!mark(6, side !== 'WAIT'))
    return wait('FUSION: M15 neutral without a safe H1-confirmed EMA-band setup.');
  const buy = side === 'BUY', sign = buy ? 1 : -1;
  const ema5Fast = ema(close5, 8), ema5Slow = ema(close5, 21);
  const trendM5 = buy ? ema5Fast > ema5Slow && last.close > ema5Fast : ema5Fast < ema5Slow && last.close < ema5Fast;
  const goodRsi = buy ? momentum >= 51 && momentum <= 74 : momentum <= 49 && momentum >= 26;
  // Prefer H1, tolerate neutral H4, reject confirmed opposite higher context.
  const higherTimeframeAligned = mark(7,
    (h1Side === side || h1Side === 'WAIT' && h4Side === side && m15Side === side) &&
    (h1Side === 'WAIT' || h1Side === side) &&
    (h4Side === 'WAIT' || h4Side === side));
  const prior3 = m5.slice(-4, -1), prior6 = m5.slice(-7, -1);
  const upper = Math.max(...prior3.map(x => x.high)), lower = Math.min(...prior3.map(x => x.low));
  const swingHigh = Math.max(...prior6.map(x => x.high)), swingLow = Math.min(...prior6.map(x => x.low));
  const strongBody = Math.abs(last.close - last.open) >= vol * (h4Side !== side ? .22 : .15);
  const candle = buy ? last.close > last.open : last.close < last.open;
  const breakout = candle && strongBody && (buy ? last.close > upper : last.close < lower);
  const sweep = candle && strongBody && (buy ?
    last.low < swingLow && last.close > swingLow && last.close > prev.close :
    last.high > swingHigh && last.close < swingHigh && last.close < prev.close);
  const adx = adxWilder(m5, 14), adxTrend = Number.isFinite(adx) && adx >= 20;
  const price = buy ? snapshot.ask : snapshot.bid;
  const near = Math.abs(price - last.close) <= vol * .5;
  const checks = [
    {name:'M15 EMA8/21 direction', pass:m15Side === side, weight:15},
    {name:'M5 EMA8/21 agreement', pass:trendM5, weight:18},
    {name:'M5 closed-bar breakout or liquidity sweep', pass:breakout || sweep, weight:12},
    {name:'H1 context', pass:h1Side === side, weight:8},
    {name:'H4 context', pass:h4Side === side, weight:5},
    {name:'RSI14 momentum', pass:goodRsi, weight:12},
    {name:'ADX trend or sweep', pass:adxTrend || sweep, weight:10},
    {name:'Spread fits ATR', pass:spreadOk, weight:12},
    {name:'Entry near closed M5 candle', pass:near, weight:8}
  ];
  const score = checks.reduce((sum, c) => sum + (c.pass ? c.weight : 0), 0);
  const assessed = {...base, checks, score, risk:'ASSESSED', reasons:checks.filter(c => !c.pass).map(c => c.name)};
  if (!higherTimeframeAligned)
    return {...assessed, risk:'CAUTION', reasons:['FUSION: explicit H1/H4 direction conflict; waiting for confirmed alignment.']};
  if (!trendM5 || !goodRsi || !(breakout || sweep) || !near || score < 75)
    return {...assessed, reasons: ['FUSION: entry gates incomplete or score below 75.', ...assessed.reasons]};
  const entry = align(price, snapshot.spec);
  const low = Math.min(...m5.slice(-5).map(x => x.low)), high = Math.max(...m5.slice(-5).map(x => x.high));
  const distance = Math.max(vol * .8, buy ? entry - low + vol * .15 : high - entry + vol * .15,
    (snapshot.spec.stops_points ?? 0) * point + tick + spread);
  if (distance > vol * 2.7) return {...assessed, reasons:['FUSION: stop distance too large vs ATR.']};
  const sl = align(entry - sign * distance, snapshot.spec, buy ? 'down' : 'up');
  const riskDistance = Math.abs(entry - sl);
  const tp1 = align(entry + sign * riskDistance * 1.5, snapshot.spec);
  const tp2 = align(entry + sign * riskDistance * 2, snapshot.spec);
  const orientation = buy ? sl < entry && entry < tp1 && tp1 < tp2 : tp2 < tp1 && tp1 < entry && entry < sl;
  if (!(sl > 0 && riskDistance > tick && orientation))
    return {...assessed, reasons:['FUSION: invalid stop/target orientation.']};
  const plan = {strategy:BTC_FUSION_STRATEGY, symbol:snapshot.symbol, side,
    bar_time:last.time, issued_at:Math.floor(now), expires_at:Math.floor(now + 180),
    timeframe:'M5', entry, sl, tp1, tp2, risk_distance:riskDistance,
    score, mode:sweep ? 'LIQUIDITY_SWEEP' : 'EMA_BREAKOUT', adx14:adx,
    suggested_max_hold_seconds:900,
    reason:'BTC FUSION: EMA8/21+RSI14+ATR14+'+(sweep?'liquidity sweep':'breakout')+'+H1/H4 hierarchy; 5-15m scalp',
    status:'TRACKING', tracking:'VIRTUAL', tp1_hit:false};
  return {...assessed, decision:side, plan, reasons:[plan.reason]};
}
