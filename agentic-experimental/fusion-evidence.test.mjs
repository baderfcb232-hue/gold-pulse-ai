import test from 'node:test';
import assert from 'node:assert/strict';
import {frameEvidence,buildFusionEvidence,rollingVwap} from './fusion-evidence.mjs';
const bars=(n,step=1)=>Array.from({length:n},(_,i)=>{const close=100+i*step;return {time:1700000000+i*300,open:close-step/2,high:close+0.2,low:close-Math.abs(step)-0.2,close};});
test('prior channel excludes decision candle and detects closed breakout',()=>{
 const a=bars(60);const f=frameEvidence(a);
 assert.equal(f.turtle20.closeBreak,'ABOVE');assert.equal(f.turtle55.closeBreak,'ABOVE');
 assert.equal(f.turtle20.high,158.2);assert.equal(f.status,'RESEARCH_EVIDENCE_ONLY');
 assert.ok(Number.isFinite(f.macd.histogram));assert.equal(f.vwap,null);
});
test('short or invalid history does not invent indicators',()=>{
 assert.equal(frameEvidence(bars(10)).status,'INSUFFICIENT_HISTORY');
 const f=frameEvidence(bars(25));assert.equal(f.turtle55,null);assert.equal(f.macd,null);
 const invalid=bars(60);invalid[1].time=invalid[0].time;
 assert.equal(frameEvidence(invalid).status,'INVALID_CANDLES');
});
test('all timeframes are advisory and no production Fusion is claimed',()=>{
 const a=bars(60);const r=buildFusionEvidence({candlesM5:a,candlesM15:a,candlesH1:a,candlesH4:a});
 assert.equal(r.advisoryOnly,true);assert.equal(r.fullProductionFusion,false);
 assert.deepEqual(Object.keys(r.frames),['M5','M15','H1','H4']);
});

test('Supertrend is available from closed OHLC and volume remains unavailable',()=>{
 const f=frameEvidence(bars(100));assert.equal(f.supertrend.direction,'UP');
 assert.equal(f.supertrend.period,10);assert.equal(f.supertrend.multiplier,3);
 assert.ok(f.supertrend.line<f.trend.ema200||f.trend.ema200===null||Number.isFinite(f.supertrend.line));
 assert.equal(f.vwap,null);
});

test('VWAP weights typical prices and does not mix real and tick volumes',()=>{
 const a=bars(25).map(b=>({...b,tickVolume:2,realVolume:0}));
 const v=rollingVwap(a);assert.equal(v.vwap.volumeSource,'BROKER_TICK_ACTIVITY_PROXY');
 const tail=a.slice(-20);const expected=tail.reduce((sum,b)=>sum+(b.high+b.low+b.close)/3,0)/20;
 assert.ok(Math.abs(v.vwap.value-expected)<0.0001);
 const real=a.map((b,i)=>({...b,realVolume:i+1}));assert.equal(rollingVwap(real).vwap.volumeSource,'BROKER_REPORTED_REAL_VOLUME');
 real.at(-1).realVolume=0;assert.equal(rollingVwap(real).vwap.volumeSource,'BROKER_TICK_ACTIVITY_PROXY');
 delete real.at(-1).tickVolume;assert.equal(rollingVwap(real).vwap,null);
});

import {regimeFrame,adaptiveEvidence} from './adaptive-regime.mjs';
test('adaptive evidence refuses future and stale candles',()=>{
 const a=bars(60).map((b,i)=>({...b,time:1700000100+i*300}));
 const end=a.at(-1).time+300;
 assert.equal(regimeFrame(a,300,end).status,'AVAILABLE');
 assert.equal(regimeFrame(a,300,end-1).status,'INVALID_OR_UNCLOSED');
 assert.equal(regimeFrame(a,300,end+901).status,'STALE');
 assert.equal(regimeFrame(a,300,end).trend,'UP');
 assert.equal(adaptiveEvidence({timestamp:end,candlesM5:a}).candidate,'WAIT');
});
test('adaptive evidence recognizes range without claiming order book liquidity',()=>{
 const a=bars(60,0).map((b,i)=>({...b,time:1700000100+i*300,open:100,close:100,high:101,low:99}));
 const r=regimeFrame(a,300,a.at(-1).time+300);
 assert.equal(r.trend,'RANGE_OR_MIXED');assert.equal(r.breakout,'NONE');
 assert.equal(r.liquidityNote,'OHLC_SWEEP_PROXY_NOT_ORDER_BOOK');
});
