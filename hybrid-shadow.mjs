// Experimental shadow-only setup. Never connected to signal publication, MT5 dispatch or Telegram.
import {ema, rsi, atr} from './engine.mjs';
export const HYBRID_STRATEGY = 'HYBRID-M1-M5-M15-SHADOW';
const steps = {M1:60,M5:300,M15:900};
function frame(rows) {
  const closes=rows.map(c=>c.close),last=rows.at(-1);
  const fast=ema(closes,8),slow=ema(closes,21),trend=ema(closes,200);
  const side=fast>slow&&last.close>trend?'BUY':fast<slow&&last.close<trend?'SELL':'WAIT';
  return {side,fast,slow,trend,rsi:rsi(closes),atr:atr(rows)};
}
export function hybridShadowAnalysis({candles, bid, ask, now, newsSafe=false, maxSpreadRatio=.15}={}) {
  const wait=(reason)=>({strategy:HYBRID_STRATEGY,reference_only:true,decision:'WAIT',reason});
  if(!Number.isFinite(now)||!(ask>=bid&&bid>0))return wait('INVALID_QUOTE');
  const frames={};
  for(const [tf,seconds] of Object.entries(steps)){
    const rows=candles?.[tf];
    if(!Array.isArray(rows)||rows.length<220)return wait('MISSING_'+tf+'_HISTORY');
    const previous=rows.at(-2),last=rows.at(-1);
    if(!rows.every((r,i)=>Number.isFinite(r.time)&&r.time+seconds<=now&&
      (!i||r.time>rows[i-1].time)&&Number.isFinite(r.open)&&Number.isFinite(r.close)&&
      Number.isFinite(r.high)&&Number.isFinite(r.low)&&r.low>0&&
      r.low<=Math.min(r.open,r.close)&&r.high>=Math.max(r.open,r.close)))return wait('INVALID_'+tf+'_BARS');
    if(now-(last.time+seconds)>seconds+120||last.time-previous.time!==seconds)return wait('STALE_'+tf);
    frames[tf]=frame(rows);
  }
  if(!newsSafe)return wait('NEWS_NOT_VERIFIED');
  const side=frames.M15.side;
  if(side==='WAIT'||frames.M5.side!==side||frames.M1.side!==side)return wait('TREND_NOT_ALIGNED');
  const m1=frames.M1, bars=candles.M1,last=bars.at(-1),previous=bars.at(-2),buy=side==='BUY';
  if(!(m1.atr>0)||ask-bid>m1.atr*maxSpreadRatio)return wait('SPREAD_TOO_WIDE');
  if(!(buy ? m1.rsi>=55&&m1.rsi<=70 : m1.rsi>=30&&m1.rsi<=45))return wait('MOMENTUM_NOT_READY');
  if(!(buy ? last.close>previous.high&&last.close>last.open : last.close<previous.low&&last.close<last.open))
    return wait('NO_M1_CONFIRMATION');
  if(Math.abs(last.close-last.open)<m1.atr*.15)return wait('WEAK_M1_CANDLE');
  const entry=buy?ask:bid, distance=1.2*m1.atr;
  return {strategy:HYBRID_STRATEGY,reference_only:true,decision:side,
    reason:'SHADOW_SETUP_ONLY',bar_time:last.time,
    entry,sl:entry+(buy?-distance:distance),tp1:entry+(buy?1:-1)*distance*1.5,
    risk_distance:distance,expires_at:now+180};
}
