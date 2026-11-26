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

test('prior 20 range excludes the candle being evaluated, allowing real breakouts',()=>{
 const base=bars(21),prior=base.slice(0,-1);
 const high=Math.max(...prior.map(b=>b.high)),low=Math.min(...prior.map(b=>b.low));
 const up=calculateClosedCandleFeatures([...prior,{...base.at(-1),open:high,close:high+3,high:high+4,low:high-1}]);
 assert.equal(up.prior20High,Number(high.toPrecision(8)));assert.ok(up.lastClose>up.prior20High);
 const down=calculateClosedCandleFeatures([...prior,{...base.at(-1),open:low,close:low-3,high:low+1,low:low-4}]);
 assert.equal(down.prior20Low,Number(low.toPrecision(8)));assert.ok(down.lastClose<down.prior20Low);
 assert.equal(calculateClosedCandleFeatures(bars(20)).prior20High,null);
});
