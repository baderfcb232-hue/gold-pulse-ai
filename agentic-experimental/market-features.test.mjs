import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateClosedCandleFeatures,multiTimeframeFeatures} from './market-features.mjs';
const bars=n=>Array.from({length:n},(_,i)=>({time:1800000000-(n-i)*300,
 open:100+i*0.2,high:101+i*0.2,low:99+i*0.2,close:100.4+i*0.2}));
test('closed Demo chart yields deterministic 8/21 EMA, RSI and ATR',()=>{
 const a=calculateClosedCandleFeatures(bars(100));
 assert.equal(a.status,'INDICATORS_AVAILABLE');
 assert.equal(a.emaDirection,'UP');
 assert.ok(a.ema8>a.ema21);
 assert.ok(a.rsi14>=0&&a.rsi14<=100);
 assert.ok(a.atr14>0);
 assert.equal(a.ema200,null);
 assert.equal(a.ema200Verified,false);
});
test('two-bar snapshots cannot falsely claim EMA200, RSI14 or full structure',()=>{
 const a=calculateClosedCandleFeatures(bars(2));
 assert.equal(a.status,'INSUFFICIENT_HISTORY');
 assert.equal(a.ema21,null);assert.equal(a.rsi14,null);
 assert.equal(a.prior20High,null);
});
test('EMA200 is calculated only when 200 closed candles are present',()=>{
 const a=calculateClosedCandleFeatures(bars(200));
 assert.equal(a.ema200Verified,true);
});
test('invalid or reordered bars cannot supply indicator evidence',()=>{
 const a=bars(25);
 assert.equal(calculateClosedCandleFeatures([a[1],a[0]]).status,'INVALID_CANDLES');
 assert.equal(calculateClosedCandleFeatures([{...a[0],low:999}]).status,'INVALID_CANDLES');
});
test('research features cover M5 M15 H1 H4 individually',()=>{
 const s={candlesM5:bars(30),candlesM15:bars(40),
 candlesH1:bars(60),candlesH4:bars(2)};
 const a=multiTimeframeFeatures(s);
 assert.deepEqual(Object.keys(a),['M5','M15','H1','H4']);
 assert.equal(a.H4.status,'INSUFFICIENT_HISTORY');
});
