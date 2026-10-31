import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cleanSnapshot} from '../engine.mjs';
import {entryFixture,NOW} from './fixtures.mjs';
import {analyzeBtcScalp,BTC_SCALP_STRATEGY} from '../strategies/btc-scalping.mjs';
import {brokerBtcMarket,brokerGoldMarket} from '../broker-market.mjs';
import {websiteTradeDecision} from '../website-entry.mjs';
import {createApplication} from '../server.mjs';
const sample=()=>{const raw=entryFixture();raw.symbol='BTCUSD.m';raw.positions=[];raw.deals=[];
 raw.execution.managed_magic='26092302';raw.execution.website_recommendations=true;
 raw.execution.demo_recommendations=true;return raw;};
test('new BTC scalp is isolated from old BTC and gold strategies',()=>{
 const s=cleanSnapshot(sample(),NOW);
 assert.equal(brokerBtcMarket(s,NOW).analysis.strategy,'EMA-PULLBACK-1');
 assert.equal(brokerBtcMarket(s,NOW,{btcStrategy:'SCALP'}).analysis.strategy,BTC_SCALP_STRATEGY);
 assert.equal(brokerGoldMarket(s,NOW,{goldStrategy:'SCALP'}),null);
 assert.equal(analyzeBtcScalp(s,NOW).strategy,BTC_SCALP_STRATEGY);
});
test('BTC scalp fails closed for old quote, old M5, news, high spread and non BTC symbol',()=>{
 for(const modify of [
  x=>{x.quote_at=NOW-50;},
  x=>{x.candles.M5.forEach(c=>c.time-=1200);},
  x=>{x.calendar.status='unavailable';},
  x=>{x.calendar.events=[{id:'nfp',name:'NFP',currency:'USD',importance:3,time:NOW+60}];},
  x=>{x.ask=x.bid+200;},
  x=>{x.symbol='XAUUSD.m';}
 ]){const raw=sample();modify(raw);const a=analyzeBtcScalp(cleanSnapshot(raw,NOW),NOW);assert.equal(a.plan,null);}
});
test('switch BTC scalp on in read-only mode; gold remains legacy and no BTC auto order approved',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'nabd-btc-scalp-'));
 const app=createApplication({dataDir:dir,clock:()=>NOW,
  config:{btcSignalStrategy:'SCALP',demoRecommendationExecution:true,publicationEnabled:true},
  ingestToken:'btc-scalp-secure-test-xxxxxxxxxxxxx'});
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 app.ingest(sample());
 const btc=app.marketFeed.publicState().markets.BTCUSD;
 assert.equal(btc.analysis.strategy,BTC_SCALP_STRATEGY);
 assert.equal(app.marketFeed.publicState().markets.XAUUSD.analysis.strategy,'REFERENCE-SCALP-1');
 assert.equal(app.marketFeed.publicState().markets.BTCUSD.execution_mode,undefined);
 assert.equal(app.server.listening,false);
});
test('BTC scalp config rejects invalid values',()=>{
 assert.throws(()=>createApplication({config:{btcSignalStrategy:'UNKNOWN'}}),/Invalid NABD_BTC_SIGNAL_STRATEGY/);
 assert.throws(()=>createApplication({config:{btcScalpDemoAutoExecution:'true'}}),/Invalid NABD_BTC_SCALP_DEMO_AUTOTRADE/);
});

test('confirmed closed M5 BTC setup can create a broker-only scalp signal and pass Demo risk approval',()=>{
  const raw=sample();
  raw.execution.website_since=NOW-30;
  raw.execution.manual_lot_supported=true;
  raw.ea={heartbeat_at:NOW,emergency_stop:false,
    settings:{max_spread_points:2500}};
  raw.account={currency:'USD',balance:10000,equity:10000,free_margin:10000,floating:0};
  const snapshot=cleanSnapshot(raw,NOW);
  const market=brokerBtcMarket(snapshot,NOW,{btcStrategy:'SCALP'});
  assert.equal(market.analysis.status,'READY',market.analysis.reason);
  assert.equal(market.analysis.plan.strategy,BTC_SCALP_STRATEGY);
  assert.equal(market.analysis.plan.side,'BUY');
  assert.equal(market.analysis.plan.source,'MT5 · JustMarkets-Demo');
  assert.equal(market.analysis.plan.broker_symbol,'BTCUSD.m');
  const signal={...market.analysis.plan,id:'btc-closed-bar-demo',status:'TRACKING'};
  const verdict=websiteTradeDecision({enabled:true,snapshot,
    market:{...market,currentSignal:signal},
    analysisPlan:market.analysis.plan,costs:{ready:true},
    durable:true,now:NOW,requiredStrategy:BTC_SCALP_STRATEGY});
  assert.equal(verdict.reason,'WEBSITE_READY',verdict.reason);
  assert.equal(verdict.ready,true);
  assert.equal(verdict.plan.side,'BUY');
  assert.equal(verdict.plan.broker_symbol,snapshot.symbol);
  const moved={...snapshot,quote_at:NOW-11};
  assert.equal(websiteTradeDecision({enabled:true,snapshot:moved,
    market:{...market,currentSignal:signal},analysisPlan:market.analysis.plan,
    costs:{ready:true},durable:true,now:NOW,requiredStrategy:BTC_SCALP_STRATEGY}).ready,false);
});
test('new BTC bridge has one-second lightweight ticks and unchanged gold timer',()=>{
  const ea=readFileSync(new URL('../mt5/NABD_Bridge_EA.mq5',import.meta.url),'utf8');
  const bridge=readFileSync(new URL('../mt5/NABD_Bridge.mqh',import.meta.url),'utf8');
  assert.match(ea,/timerSeconds=btcOneSecond\?1:\(int\)MathMax\(3,InpNABDRefreshSeconds\)/);
  assert.match(bridge,/btcOneSecond\?1000:MathMax\(3,InpNABDRefreshSeconds\)\*1000/);
  assert.match(bridge,/\/api\/mt5\/btc-quote/);
  assert.match(bridge,/now-lastBtcFullSend<3000/);
  assert.match(bridge,/if\(!TradingExecutionEnabled\(\)\)/);
});
