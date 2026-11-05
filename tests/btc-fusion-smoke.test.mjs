import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeBtcFusion,BTC_FUSION_STRATEGY} from '../strategies/btc-fusion-scalper.mjs';
// Synthetic candle fixtures validate the logic only, not trading performance.
const NOW=1800000000;
function rows(seconds,direction=1,offset=0){
 const end=Math.floor(NOW/seconds)*seconds-seconds;
 return Array.from({length:320},(_,i)=>{
  const trend=seconds===300?i*.62:i*1.8;
  const wiggle=seconds===300?Math.sin(i*.58+offset)*12+Math.sin(i*.13+offset)*18:Math.sin(i*.24+offset)*3;
  const close=70000+direction*(trend+wiggle);
  return {time:end-(319-i)*seconds,open:close-direction*.5,close,high:close+10,low:close-10,tick_volume:100};
 });
}
function snapshot(direction=1){
 const candles={M5:rows(300,direction),M15:rows(900,direction,1),H1:rows(3600,direction),H4:rows(14400,direction,2)};
 const last=candles.M5.at(-1),prev=candles.M5.at(-2);
 if(direction===1){last.open=prev.close-7;last.close=Math.max(...candles.M5.slice(-4,-1).map(c=>c.high))+6;last.high=last.close+3;last.low=Math.min(last.open,last.close)-6;}
 else {last.open=prev.close+7;last.close=Math.min(...candles.M5.slice(-4,-1).map(c=>c.low))-6;last.low=last.close-3;last.high=Math.max(last.open,last.close)+6;}
 return {symbol:'BTCUSD.m',broker:'JustMarkets-Demo',terminal_connected:true,received_at:NOW,quote_at:NOW,
  bid:last.close-.2,ask:last.close+.2,spec:{point:.01,tick_size:.01,digits:2,stops_points:30},
  calendar:{status:'ok',updated_at:NOW,events:[]},candles,ea:{settings:{max_spread_points:2500}}};
}
test('Fusion BUY builds valid broker oriented stop and target',()=>{
 const a=analyzeBtcFusion(snapshot(1),NOW);
 assert.equal(a.strategy,BTC_FUSION_STRATEGY);
 assert.equal(a.decision,'BUY',a.reasons.join(' | '));
 assert.ok(a.score>=75);
 assert.equal(a.plan.reward_risk,3);
 assert.ok(Math.abs(Math.abs(a.plan.tp1-a.plan.entry)-3*a.plan.risk_distance)<=.011);
 assert.ok(a.plan.sl<a.plan.entry&&a.plan.entry<a.plan.tp1&&a.plan.tp1<a.plan.tp2);
 assert.equal(a.plan.suggested_max_hold_seconds,900);
});
test('Fusion SELL builds valid broker oriented stop and target',()=>{
 const a=analyzeBtcFusion(snapshot(-1),NOW);
 assert.equal(a.decision,'SELL',a.reasons.join(' | '));
 assert.equal(a.plan.reward_risk,3);
 assert.ok(Math.abs(Math.abs(a.plan.tp1-a.plan.entry)-3*a.plan.risk_distance)<=.011);
 assert.ok(a.plan.tp2<a.plan.tp1&&a.plan.tp1<a.plan.entry&&a.plan.entry<a.plan.sl);
});
test('Fusion blocks stale quotes/bars, USD news, spread and non BTC',()=>{
 for(const change of [
  x=>{x.quote_at=NOW-60;},
  x=>{x.candles.M5.forEach(c=>c.time-=1200);},
  x=>{x.calendar.events=[{name:'Test USD news',currency:'USD',importance:3,time:NOW+50}];},
  x=>{x.ask=x.bid+200;},x=>{x.symbol='XAUUSD.m';}
 ]){
  const s=snapshot(1);change(s);const a=analyzeBtcFusion(s,NOW);
  assert.equal(a.decision,'WAIT',a.reasons.join(' | '));
  assert.equal(a.plan,null);
 }
});

test('Fusion may trade with neutral M15 near EMA band when H1/H4 and M5 confirm',()=>{
 const s=snapshot(1);
 const bars=s.candles.M15;
 const level=bars.at(-1).close;
 for(const bar of bars.slice(-90)){
   bar.open=level;bar.close=level;bar.high=level+10;bar.low=level-10;
 }
 // End just below the slow EMA so M15 is genuinely neutral, not a weak BUY.
 bars.at(-1).close=level-.2;
 const a=analyzeBtcFusion(s,NOW);
 assert.equal(a.readinessChecks[6].pass,true,a.reasons.join(' | '));
 assert.equal(a.readinessChecks[7].pass,true,a.reasons.join(' | '));
 assert.equal(a.checks.find(c=>c.name==='M15 EMA8/21 direction').pass,false);
 assert.equal(a.decision,'BUY',a.reasons.join(' | '));
});
test('Fusion never forces alignment against a confirmed opposite H1',()=>{
 const s=snapshot(1);
 const h1=s.candles.H1;
 // The direction is deliberately reversed while the M15/M5 remain bullish.
 for(let i=0;i<h1.length;i++){
   const close=71000-i*2;
   h1[i].open=close+.5;h1[i].close=close;h1[i].high=close+10;h1[i].low=close-10;
 }
 const a=analyzeBtcFusion(s,NOW);
 assert.equal(a.decision,'WAIT');
 assert.equal(a.plan,null);
 assert.equal(a.readinessChecks[7].pass,false);
});
