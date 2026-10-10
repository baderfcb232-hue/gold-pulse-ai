import {TF_SECONDS} from '../engine.mjs';
export const NOW = 1791511200;
export function fixture(now = NOW) {
  const candles = {};
  for (const [tf, step] of Object.entries(TF_SECONDS)) {
    const end = Math.floor(now / step) * step - step;
    candles[tf] = Array.from({length: 320}, (_, i) => ({time: end - (319 - i) * step,
      open: 4000 + i * .025, close: 4000 + i * .025 + .01,
      high: 4000 + i * .025 + .35, low: 4000 + i * .025 - .35, tick_volume: 100}));
  }
  return {symbol: 'XAUUSD', account_ref: 'TEST_ACCOUNT_ONLY', broker: 'JustMarkets-Demo',
    terminal_connected: true, bid: 4008.0, ask: 4008.03, quote_at: now,
    spec: {digits: 3, point: .001, tick_size: .001, tick_value_loss: .1, tick_value_profit: .1,
      volume_min: .01, volume_step: .01, volume_max: 50, stops_points: 20, margin_per_lot: 500, currency: 'USD'},
    candles, calendar: {status: 'ok', updated_at: now, events: []},
    execution: {enabled: true, remote_control: true, demo: true, paused: false, managed_magic: '26092301',
      small_profit_target: 1, risk_percent: .5, news_filter: true, max_daily_loss_percent: 2},
    account: {currency: 'USD',balance: 1234.56,equity: 1240.56,free_margin: 1200.56,floating: 6},
    positions: [{ticket: '901',side:'BUY',volume:.01,entry:4006,sl:4004,tp:4010,profit:6,swap:0,opened_at:now-120}],
    deals: [{ticket:'900',position_id:'901',time:now-120,side:'BUY',entry_type:'IN',volume:.01,price:4006,profit:0,commission:-.1,swap:0,fee:0}]};
}
export function samplePlan(now = NOW) {return {id:'test-plan',strategy:'TEST',symbol:'XAUUSD',side:'BUY',
  issued_at:now-1,expires_at:now+900,bar_time:now-300,entry:4008,sl:4006,tp1:4011,tp2:4013,risk_distance:2,
  status:'TRACKING',tracking:'VIRTUAL',tp1_hit:false,score:100,reason:'TEST FIXTURE'};}
export function entryFixture(side = 'BUY') {
  const raw=fixture(),rows=raw.candles.M5;
  rows.forEach((c,i)=>{const v=4000+i*.018+Math.sin(i*.32+1.4)*.8;c.open=v-.02;c.close=v+.02;c.high=v+.13;c.low=v-.13;});
  const prev=rows.at(-2),last=rows.at(-1);last.open=prev.close-.15;last.close=prev.high+.1;last.high=last.close+.05;last.low=Math.min(last.open,prev.low)-.02;
  raw.bid=last.close;raw.ask=last.close+.03;
  if(side==='SELL'){
    for(const bars of Object.values(raw.candles))for(const c of bars){[c.open,c.close,c.high,c.low]=[8000-c.open,8000-c.close,8000-c.low,8000-c.high];}
    raw.bid=8000-last.close-.03;raw.ask=raw.bid+.03;
    // last now contains the mirrored price, so derive quotes from that transformed candle.
    raw.bid=raw.candles.M5.at(-1).close-.03;raw.ask=raw.bid+.03;
  }
  return raw;
}
export function eaFixture(now = NOW, side = 'BUY') {
  const raw=fixture(now);
  raw.execution.main_connected=true;
  const buy=side==='BUY',entry=buy?raw.ask:raw.bid;
  raw.ea={heartbeat_at:now,checked_at:now,emergency_stop:false,
    settings:{ema_fast:50,ema_slow:200,bias_seconds:900,entry_seconds:300,max_spread_points:80,
      reward_risk:2,news_before_minutes:30,news_after_minutes:30},
    signal:{side,issued_at:now,bar_time:now-300,entry,sl:entry+(buy?-2:2),target:entry+(buy?4:-4),rsi:buy?58:42,atr:1}};
  return raw;
}
