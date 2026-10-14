import {createHash} from 'node:crypto';
import {analyze, TF_SECONDS, defaults} from './engine.mjs';

// Reuse the existing website strategy with the broker's closed OHLC bars.
// Account data and the EA's execution controls never enter the public market.
export function brokerGoldMarket(snapshot, now) {
  if (!snapshot || !/^XAUUSD(?:[._#]?[A-Za-z0-9._#-]+)?$/i.test(snapshot.symbol)) return null;
  const sourceId = 'MT5:' + createHash('sha256')
    .update(JSON.stringify([snapshot.account_ref, snapshot.broker, snapshot.symbol])).digest('hex').slice(0, 24);
  const source = 'MT5 · ' + snapshot.broker;
  const a = analyze(snapshot, now);
  const incomplete = Object.values(a.frames).some(f => f.direction === 'UNKNOWN');
  const oldBars = Object.entries(TF_SECONDS).some(([tf, step]) => {
    const last = snapshot.candles[tf].at(-1);
    return last && now - (last.time + step) > step + 120;
  });
  const calendarAvailable = snapshot.calendar.status === 'ok' && snapshot.calendar.updated_at > 0
    && now - snapshot.calendar.updated_at <= defaults.calendarTtl;
  const status = a.connection !== 'LIVE' ? 'STALE' : incomplete ? 'WARMING'
    : oldBars ? 'GAP' : !calendarAvailable || a.news_block ? 'NEWS_BLOCK'
    : a.risk === 'BLOCKED' ? 'BLOCKED' : a.plan ? 'READY' : 'SCANNING';
  const plan = a.plan ? {...a.plan, symbol: 'XAUUSD', broker_symbol: snapshot.symbol,
    source, source_id: sourceId, quote_time: snapshot.quote_at, reference_only: true, sampled: false} : null;
  return {
    symbol: 'XAUUSD', name: 'الذهب', source, source_id: sourceId,
    sourceUrl: null, broker_symbol: snapshot.symbol, broker_mode: true,
    tickSize: snapshot.spec.tick_size, quoteTtl: defaults.quoteTtl,
    cadence_seconds: 3, candle_kind: 'BROKER_OHLC', transport: 'MT5 Bridge',
    quote: {price: (snapshot.bid + snapshot.ask) / 2, bid: snapshot.bid, ask: snapshot.ask, time: snapshot.quote_at},
    received_at: snapshot.received_at, checked_at: snapshot.received_at,
    connection: a.connection, candles: snapshot.candles.M5, bars: snapshot.candles,
    revision: snapshot.received_at, history_revision: snapshot.candles.M5.at(-1)?.time || 0,
    default_tf: 'M5', chart_tfs: Object.keys(TF_SECONDS),
    market_hours: 'جلسات الذهب لدى البروكر؛ إصدار الخطط يحتاج سعرًا حديثًا وشموعًا مغلقة',
    feed_error: null,
    analysis: {strategy: a.strategy, decision: a.decision, status, frames: a.frames,
      checks: a.checks, score: a.score, setup: null, plan,
      reason: a.reasons.join(' ') || 'نبحث عن اكتمال شروط الدخول على شموع البروكر.',
      reference_only: true, calendar_available: calendarAvailable,
      required_bars: 220, observed_bars: snapshot.candles.M5.length,
      entry_tf: 'M5', trend_tfs: ['M15', 'H1', 'H4']}
  };
}
