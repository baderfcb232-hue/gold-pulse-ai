import {analyze, ema, rsi, atr, defaults, TF_SECONDS} from '../engine.mjs';

// BTCUSD.m-only closed-bar research and recommendations. No orders or price synthesis.
// Do not force M15/H1 agreement: H1 remains context while H4 guards countertrends.
export const BTC_SCALP_STRATEGY = 'NABD-BTC-SCALP-M5M15-V1';
const roundLevel = (value, spec, mode = 'nearest') => {
  const fn = mode === 'up' ? Math.ceil : mode === 'down' ? Math.floor : Math.round;
  return Number((fn(value / spec.tick_size) * spec.tick_size).toFixed(spec.digits));
};
export function btcScalpBarFreshness(snapshot, now) {
  const age = tf => {
    const candle = snapshot?.candles?.[tf]?.at(-1);
    return Number.isFinite(candle?.time) ? now - candle.time - TF_SECONDS[tf] : Infinity;
  };
  const ages = {M5: age('M5'), M15: age('M15'), H4: age('H4')};
  const staleEntry = ages.M5 > TF_SECONDS.M5 + 120 || ages.M15 > TF_SECONDS.M15 + 120;
  const staleContext = ages.H4 > TF_SECONDS.H4 + 120;
  return {fresh: !staleEntry && !staleContext, staleEntry, staleContext, ages};
}

export function analyzeBtcScalp(snapshot, now = Date.now() / 1000) {
  const mid = snapshot ? (snapshot.bid + snapshot.ask) / 2 : 0;
  const point = snapshot?.spec?.point;
  const spreadCeiling = Number.isFinite(point) && point > 0 && Number.isFinite(mid) && mid > 0
    ? Math.max(1, Math.floor(mid * .001 / point)) : 0; // 10bps, not a gold spread constant
  const legacy = analyze(snapshot, now, {...defaults, maxSpreadPoints: spreadCeiling});
  const state = {...legacy, strategy: BTC_SCALP_STRATEGY, decision: 'WAIT',
    plan: null, checks: [], score: null, risk: 'CAUTION', reasons: []};
  if (!snapshot || !/^BTCUSD(?:[._#][A-Za-z0-9._#-]+)?$/i.test(snapshot.symbol || ''))
    return {...state, risk: 'BLOCKED', reasons: ['مطلوب مصدر BTCUSD من MT5 فقط.']};
  if (legacy.connection !== 'LIVE')
    return {...state, risk: 'BLOCKED', reasons: legacy.reasons};
  const frames = legacy.frames;
  if (['M5', 'M15', 'H4'].some(tf => frames[tf]?.count < 220 || frames[tf]?.direction === 'UNKNOWN'))
    return {...state, reasons: ['نحتاج 220 شمعة مغلقة على M5 وM15 وH4.']};
  const fresh = btcScalpBarFreshness(snapshot, now);
  if (!fresh.fresh) return {...state, reasons: [fresh.staleEntry ?
    'شموع BTC M5 أو M15 قديمة؛ انتظار تحديث MT5.' :
    'شموع BTC H4 قديمة؛ انتظار سياق حديث.']};
  const spread = snapshot.ask - snapshot.bid;
  const spreadPoints = spread / point;
  if (!Number.isFinite(spreadPoints) || spreadPoints < 0 || spreadPoints > spreadCeiling)
    return {...state, risk:'BLOCKED', reasons: ['سبريد BTC تجاوز 10 نقاط أساس من متوسط السعر.']};
  const cal = snapshot.calendar;
  if (cal?.status !== 'ok' || !cal.updated_at || now - cal.updated_at > defaults.calendarTtl)
    return {...state, risk:'BLOCKED', reasons:['التقويم الاقتصادي غير متاح؛ منع إصدار توصية BTC.']};
  const news = cal.events.find(e => e.currency === 'USD' && e.importance === 3 &&
    e.time - defaults.newsBefore <= now && e.time + defaults.newsAfter >= now);
  if (news) return {...state, risk:'BLOCKED', news_block:news,
    reasons: ['خبر دولار عالي الأهمية يمنع دخول BTC: ' + news.name]};

  const m5 = snapshot.candles.M5, m15 = snapshot.candles.M15;
  const closes5 = m5.map(c => c.close), closes15 = m15.map(c => c.close);
  const last = m5.at(-1), prev = m5.at(-2);
  const e5fast = ema(closes5, 8), e5slow = ema(closes5, 21);
  const e15fast = ema(closes15, 8), e15slow = ema(closes15, 21);
  const v = atr(m5, 14), strength = rsi(closes5, 14);
  if (!(v > 0) || !Number.isFinite(strength))
    return {...state, reasons:['ATR أو RSI للبيتكوين غير صالح.']};
  // Direction uses M15 EMA8/21 only. H1 never blocks otherwise valid M5/M15 setups.
  const side = e15fast > e15slow && m15.at(-1).close > e15slow ? 'BUY' :
    e15fast < e15slow && m15.at(-1).close < e15slow ? 'SELL' : null;
  if (!side) return {...state, reasons:['ننتظر اتجاه EMA8/21 واضح على M15 للبيتكوين.']};
  const buy = side === 'BUY', oppositeH4 = frames.H4.direction === (buy ? 'SELL' : 'BUY');
  const trendM5 = buy ? e5fast > e5slow && last.close > e5fast : e5fast < e5slow && last.close < e5fast;
  const recent = m5.slice(-4, -1);
  const boundary = buy ? Math.max(...recent.map(c => c.high)) : Math.min(...recent.map(c => c.low));
  const breakConfirmed = buy ? last.close > (oppositeH4 ? boundary : prev.high) :
    last.close < (oppositeH4 ? boundary : prev.low);
  const candleConfirmed = (buy ? last.close > last.open : last.close < last.open) &&
    breakConfirmed && Math.abs(last.close - last.open) >= v * (oppositeH4 ? .22 : .15);
  const momentum = buy ? strength >= (oppositeH4 ? 57 : 51) && strength <= 76 :
    strength <= (oppositeH4 ? 43 : 49) && strength >= 24;
  const price = buy ? snapshot.ask : snapshot.bid;
  const notChasing = Math.abs(price - last.close) <= v * .6;
  // BTC-specific spread-to-volatility gate; server and EA also enforce broker costs.
  const costs = spread <= v * .2 && spreadPoints <= spreadCeiling;
  const checks = [
    {name:'EMA8/21 للبيتكوين M15 يحدد الاتجاه', pass:true, weight:20},
    {name:'EMA8/21 للبيتكوين M5 يؤكد الاتجاه', pass:trendM5, weight:20},
    {name:'اختراق وإغلاق M5 مؤكد', pass:candleConfirmed, weight:25},
    {name:'RSI14 للبيتكوين مناسب', pass:momentum, weight:15},
    {name:'السعر قريب من شمعة الدخول', pass:notChasing, weight:10},
    {name:'سبريد BTC يتناسب مع ATR', pass:costs, weight:10}
  ];
  const score = checks.reduce((acc,c) => acc + (c.pass ? c.weight : 0), 0);
  const result = {...state, checks, score, risk: oppositeH4 ? 'CAUTION' : 'ASSESSED',
    reasons: checks.filter(c => !c.pass).map(c => c.name)};
  if (checks.some(c => !c.pass)) return result;
  const entry = roundLevel(price, snapshot.spec);
  const swing = buy ? Math.min(...m5.slice(-5).map(c => c.low)) :
    Math.max(...m5.slice(-5).map(c => c.high));
  const tick = snapshot.spec.tick_size;
  const minStop = snapshot.spec.stops_points * point + tick;
  const distance = Math.max(v * .9, buy ? entry - swing + v * .15 : swing - entry + v * .15,
    minStop + spread);
  if (distance > v * 2.8) return {...result,risk:'CAUTION',
    reasons:['وقف BTC بعيد جدًا مقارنة بـ ATR؛ انتظار شمعة أخرى.']};
  const sl = roundLevel(entry + (buy ? -distance : distance), snapshot.spec, buy ? 'down' : 'up');
  const riskDistance = Math.abs(entry - sl);
  if (!(riskDistance > tick && sl > 0)) return {...result,
    reasons:['مستويات وقف خسارة BTC غير صالحة.']};
  const sign = buy ? 1 : -1;
  const tp1 = roundLevel(entry + sign * riskDistance, snapshot.spec);
  const tp2 = roundLevel(entry + sign * riskDistance * 1.5, snapshot.spec);
  if (!(buy ? sl < entry && entry < tp1 && tp1 < tp2 : tp2 < tp1 && tp1 < entry && entry < sl))
    return {...result,reasons:['مستويات أهداف BTC لم تجتز الفحص.']};
  const plan = {strategy: BTC_SCALP_STRATEGY, symbol:snapshot.symbol, side,
    bar_time:last.time, issued_at:Math.floor(now), expires_at:Math.floor(now + 180),
    timeframe:'M5', entry, sl, tp1, tp2, risk_distance:riskDistance,
    score, reason:'سكالبينغ BTC EMA8/21 + اختراق M5 مغلق'+
      (oppositeH4 ? ' (عكس اتجاه H4؛ تأكيد أشد)' : ''),
    status:'TRACKING',tracking:'VIRTUAL',tp1_hit:false};
  return {...result, decision:side, plan, reasons:[plan.reason]};
}
