import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cleanSnapshot} from '../engine.mjs';
import {entryFixture,NOW} from './fixtures.mjs';
import {analyzeBtcScalp,BTC_SCALP_STRATEGY} from '../strategies/btc-scalping.mjs';
import {brokerBtcMarket,brokerGoldMarket} from '../broker-market.mjs';
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
 const {plan,...decision}=app.marketFeed.publicState().markets.BTCUSD?.execution||{};
 assert.equal(app.server.listening,false);
 assert.equal(decision?.ready,true===false);
});
test('BTC scalp config rejects invalid values',()=>{
 assert.throws(()=>createApplication({config:{btcSignalStrategy:'UNKNOWN'}}),/Invalid NABD_BTC_SIGNAL_STRATEGY/);
 assert.throws(()=>createApplication({config:{btcScalpDemoAutoExecution:'true'}}),/Invalid NABD_BTC_SCALP_DEMO_AUTOTRADE/);
});
