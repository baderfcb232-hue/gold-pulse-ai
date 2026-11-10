import test from 'node:test';
import assert from 'node:assert/strict';
import {HybridScheduler} from './hybrid-scheduler.mjs';
const T=1731000000;
function input(now=T,symbol='XAUUSD'){
 const bars={};
 for(const [tf,d] of Object.entries({M5:300,M15:900,H1:3600,H4:14400})){
  const t=Math.floor((now-10)/d)*d-d;
  bars[tf]=[t-d,t].map(time=>({time,open:100,high:102,low:99,close:101}));
 }
 return {symbol,now,quote:{bid:100,ask:100.1,time:now},bars,atrM5:4,news:[]};
}
test('first M5 close eligible, no execution',()=>{
 const r=new HybridScheduler().consider(input());assert.equal(r.callAI,true);
 assert.equal(r.tradingEnabled,false);assert.equal(r.reason,'M5_CLOSED');
});
test('ticks do not spam AI requests',()=>{
 const s=new HybridScheduler();s.consider(input());
 assert.equal(s.consider(input(T+1)).callAI,false);
});
test('stale quotes rejected',()=>{
 const s=input();s.quote.time-=30;
 assert.equal(new HybridScheduler().consider(s).reason,'INVALID_OR_STALE_QUOTE');
});
test('unfinished bars rejected',()=>{
 const s=input();s.bars.M5.at(-1).time=s.now;
 assert.equal(new HybridScheduler().consider(s).reason,'INVALID_M5');
});
test('only gold and BTC accepted',()=>{
 assert.equal(new HybridScheduler().consider(input(T,'EURUSD')).reason,'UNSUPPORTED_SYMBOL');
});
test('missing timeframe rejected',()=>{
 const s=input();delete s.bars.H4;
 assert.equal(new HybridScheduler().consider(s).reason,'MISSING_H4');
});
test('valid high impact news can trigger review',()=>{
 const x=new HybridScheduler();x.consider(input());
 const s=input(T+100);s.news=[{id:'CPI',symbol:'ALL',publishedAt:s.now,verified:true,highImpact:true}];
 assert.equal(x.consider(s).reason,'HIGH_IMPACT_NEWS');
});
test('unverified news cannot independently trigger',()=>{
 const x=new HybridScheduler();x.consider(input());
 const s=input(T+100);s.news=[{id:'rumour',symbol:'ALL',publishedAt:s.now,verified:false,highImpact:true}];
 assert.notEqual(x.consider(s).reason,'HIGH_IMPACT_NEWS');
});
test('daily budget enforced',()=>{
 const x=new HybridScheduler({dailyLimit:1});x.consider(input());
 assert.equal(x.consider(input(T+300)).reason,'DAILY_BUDGET_EXHAUSTED');
});
test('separate budgets per symbol',()=>{
 const x=new HybridScheduler({perSymbolLimit:1});
 assert.equal(x.consider(input()).callAI,true);
 assert.equal(x.consider(input(T,'BTCUSD')).callAI,true);
});
test('report exposes no trading endpoints',()=>{
 const s=new HybridScheduler().report();assert.equal(s.tradingEnabled,false);
 assert.equal(s.marketAdapter,'not_connected');assert.equal(s.analysisMode,'shadow_only');
});