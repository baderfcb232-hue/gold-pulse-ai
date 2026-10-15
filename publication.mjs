import {defaults, TF_SECONDS} from './engine.mjs';

export const publicationReasons = Object.freeze({
  PAUSED: 'إرسال التوصيات متوقف من إعدادات الخادم.',
  WAITING_BROKER: 'ننتظر اتصالًا حيًا بالبروكر وحالة البوت.',
  WAITING_SETUP: 'ننتظر خطة جديدة مكتملة من مصدر التداول.',
  WAITING_COSTS: 'تكاليف هذا الحساب والرمز لم تُؤكّد بعد، أو تجاوزها السبريد الحالي.',
  WAITING_HISTORY: 'ننتظر شموع البروكر المغلقة وتحديث التحليل اليومي.',
  NEWS_BLOCK: 'التقويم الاقتصادي غير متاح أو توجد أخبار مرتفعة الأهمية.',
  CONTEXT_OPPOSES: 'اتجاه الفريمات لا يؤكد خطة الدخول.',
  PRICE_MOVED: 'السعر ابتعد عن دخول الخطة؛ ننتظر تكوينًا جديدًا.',
  COST_TOO_HIGH: 'التكلفة المقدّرة مرتفعة بالنسبة لمسافة الستوب والهدف.',
  READY: 'اكتملت شروط نشر التوصية؛ النتيجة غير مضمونة.'
});

// This explicit operator switch permits messages only. Neither this module nor
// the daily simulations can create or change a broker order.
export function reviewPublication({enabled, snapshot: s, analysis: a, plan: p, costs, daily, now, config = {}}) {
  const wait = reason => ({ready: false, reason, plan: null});
  if (enabled !== true) return wait('PAUSED');
  if (!s || a?.connection !== 'LIVE' || !a.source_ready) return wait('WAITING_BROKER');
  if (!p?.id || p.symbol !== s.symbol || p.status !== 'TRACKING' || !['BUY', 'SELL'].includes(p.side) ||
    !Number.isFinite(p.issued_at) || now - p.issued_at < -5 || now - p.issued_at > 90 || !(p.expires_at > now) ||
    !a.plan || a.plan.bar_time !== p.bar_time || a.plan.side !== p.side || a.plan.entry !== p.entry ||
    a.plan.sl !== p.sl || a.plan.tp2 !== p.tp2) return wait('WAITING_SETUP');
  if (!costs?.ready) return wait('WAITING_COSTS');
  if (Object.entries(TF_SECONDS).some(([tf, step]) => !a.frames?.[tf] || a.frames[tf].direction === 'UNKNOWN' ||
    !s.candles[tf]?.length || now - (s.candles[tf].at(-1).time + step) > step + 120) ||
    !daily || daily.status !== 'CONTEXT_ONLY' || now - daily.lastClosedAt > 3 * 86400)
    return wait('WAITING_HISTORY');
  const cfg = {...defaults, ...config}, cal = s.calendar;
  if (cal?.status !== 'ok' || !cal.updated_at || now - cal.updated_at > cfg.calendarTtl ||
    cal.events.some(e => e.currency === 'USD' && e.importance === 3 &&
      e.time - cfg.newsBefore <= now && e.time + cfg.newsAfter >= now)) return wait('NEWS_BLOCK');
  const direction = p.side === 'BUY' ? 'UP' : 'DOWN', opposite = p.side === 'BUY' ? 'SELL' : 'BUY';
  if (daily.emaTrend !== direction || (daily.donchianBreak && daily.donchianBreak !== direction) ||
    a.frames.M5.direction !== p.side || a.frames.M15.direction !== p.side ||
    a.frames.H1.direction !== p.side || a.frames.H4.direction === opposite) return wait('CONTEXT_OPPOSES');
  const risk = Math.abs(p.entry - p.sl), target = p.tp1 ?? p.tp2;
  const reward = p.side === 'BUY' ? target - p.entry : p.entry - target;
  const price = p.side === 'BUY' ? s.ask : s.bid;
  if (![p.entry, p.sl, target, price, risk, reward].every(Number.isFinite) || !(risk > 0 && reward > 0) ||
    (p.side === 'BUY' ? p.sl >= p.entry : p.sl <= p.entry)) return wait('WAITING_SETUP');
  if (Math.abs(price - p.entry) > risk * .15 || (p.side === 'BUY' ? s.bid <= p.sl || s.bid >= target : s.ask >= p.sl || s.ask <= target))
    return wait('PRICE_MOVED');
  const c = costs.costs;
  const costPrice = p.entry * (Math.max(c.spreadBps, costs.observedSpreadBps) +
    2 * (c.slippageBps + c.commissionBps) + c.carryBpsPerDay) / 10000;
  if (!Number.isFinite(costPrice) || costPrice > risk * .25 || (reward - costPrice) / (risk + costPrice) < 1)
    return wait('COST_TOO_HIGH');
  const seconds = s.ea?.settings?.entry_seconds;
  const timeframe = p.source === 'MT5_EA' && seconds > 0 ? `${seconds / 60} دقيقة` : 'M5';
  return {ready: true, reason: 'READY', costRiskRatio: costPrice / risk,
    plan: {...p, source: `MT5 · ${s.broker}`, timeframe, broker_symbol: s.symbol,
      costMeaning: 'ACKNOWLEDGED_SCENARIO', claimedSuccessRate: null}};
}
