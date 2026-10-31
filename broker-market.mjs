import {createHash} from 'node:crypto';
import {analyze, TF_SECONDS, defaults} from './engine.mjs';
import {analyzeGoldScalp,goldScalpBarFreshness} from './strategies/gold-scalping.mjs';

// Reuse the existing website strategy with the broker's closed OHLC bars.
// Account data and the EA's execution controls never enter the public market.
export function brokerInstrumentMarket(snapshot, now, {goldStrategy = 'EMA_LEGACY'} = {}) {
  const gold = /^XAUUSD(?:[._#][A-Za-z0-9._#-]+)?$/i.test(snapshot?.symbol || '');
  const btc = /^BTCUSD(?:[._#][A-Za-z0-9._#-]+)?$/i.test(snapshot?.symbol || '');
  if (!gold && !btc) return null;
  const canonical = gold ? 'XAUUSD' : 'BTCUSD';
  // BTC analysis uses a broker-derived maximum 10 bps spread; EA also checks its local limit.
  const mid = (snapshot.bid + snapshot.ask) / 2;
  const btcSpreadPoints = Math.floor(mid * .001 / snapshot.spec.point);
  const sourceId = 'MT5:' + createHash('sha256')
    .update(JSON.stringify([snapshot.account_ref, snapshot.broker, snapshot.symbol])).digest('hex').slice(0, 24);
  const source = 'MT5 · ' + snapshot.broker;
  const a = gold && goldStrategy === 'SCALP' ? analyzeGoldScalp(snapshot,now) :
    analyze(snapshot, now, btc ? {maxSpreadPoints: Math.max(1, btcSpreadPoints)} : undefined);
  const incomplete = Object.values(a.frames).some(f => f.direction === 'UNKNOWN');
  // For gold scalp status, use the same closed-candle rules as the scalp
  // analyzer itself. Legacy and BTC retain their original timeframe policy.
  const oldBars = gold && goldStrategy === 'SCALP'
    ? !goldScalpBarFreshness(snapshot,now).fresh
    : Object.entries(TF_SECONDS).some(([tf, step]) => {
      const last = snapshot.candles[tf].at(-1);
      return last && now - (last.time + step) > step + 120;
    });
  const calendarAvailable = snapshot.calendar.status === 'ok' && snapshot.calendar.updated_at > 0
    && now - snapshot.calendar.updated_at <= defaults.calendarTtl;
  const status = a.connection !== 'LIVE' ? 'STALE' : incomplete ? 'WARMING'
    : oldBars ? 'GAP' : !calendarAvailable || a.news_block ? 'NEWS_BLOCK'
    : a.risk === 'BLOCKED' ? 'BLOCKED' : a.plan ? 'READY' : 'SCANNING';
  const plan = a.plan ? {...a.plan, symbol: canonical, broker_symbol: snapshot.symbol,
    source, source_id: sourceId, quote_time: snapshot.quote_at, reference_only: true, sampled: false} : null;
  return {
    symbol: canonical, name: gold ? 'الذهب' : 'بيتكوين', source, source_id: sourceId,
    sourceUrl: null, broker_symbol: snapshot.symbol, broker_mode: true,
    tickSize: snapshot.spec.tick_size, point: snapshot.spec.point, digits: snapshot.spec.digits, quoteTtl: defaults.quoteTtl,
    cadence_seconds: 3, candle_kind: 'BROKER_OHLC', transport: 'MT5 Bridge',
    quote: {price: (snapshot.bid + snapshot.ask) / 2, bid: snapshot.bid, ask: snapshot.ask, time: snapshot.quote_at},
    received_at: snapshot.received_at, checked_at: snapshot.received_at,
    connection: a.connection, candles: snapshot.candles.M5, bars: snapshot.candles,
    revision: snapshot.received_at, history_revision: snapshot.candles.M5.at(-1)?.time || 0,
    default_tf: 'M5', chart_tfs: Object.keys(TF_SECONDS),
    market_hours: gold ? 'جلسات الذهب لدى البروكر؛ إصدار الخطط يحتاج سعرًا حديثًا وشموعًا مغلقة' : 'جلسات بيتكوين لدى البروكر؛ إصدار الخطط يتطلب شموع MT5 حديثة',
    feed_error: null,
    analysis: {strategy: a.strategy, decision: a.decision, status, frames: a.frames,
      checks: a.checks, score: a.score, setup: null, plan,
      reason: a.reasons.join(' ') || 'نبحث عن اكتمال شروط الدخول على شموع البروكر.',
      reference_only: true, calendar_available: calendarAvailable,
      required_bars: 220, observed_bars: snapshot.candles.M5.length,
      entry_tf: 'M5', trend_tfs: ['M15', 'H1', 'H4']}
  };
}

// Maintain gold-only behavior for existing callers; BTC has a separate feed.
export const brokerGoldMarket = (snapshot, now, options = {}) => /^XAUUSD(?:[._#][A-Za-z0-9._#-]+)?$/i.test(snapshot?.symbol || '')
  ? brokerInstrumentMarket(snapshot, now, options) : null;
export const brokerBtcMarket = (snapshot, now) => /^BTCUSD(?:[._#][A-Za-z0-9._#-]+)?$/i.test(snapshot?.symbol || '')
  ? brokerInstrumentMarket(snapshot, now) : null;
