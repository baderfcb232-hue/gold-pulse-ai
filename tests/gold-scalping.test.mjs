import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {analyzeGoldScalp,GOLD_SCALP_STRATEGY} from '../strategies/gold-scalping.mjs';
import {analyze,cleanSnapshot,STRATEGY} from '../engine.mjs';
import {brokerGoldMarket} from '../broker-market.mjs';
import {createApplication} from '../server.mjs';
import {entryFixture,NOW} from './fixtures.mjs';
function sample(side='BUY'){
  const x=entryFixture(side);x.symbol='XAUUSD.m';
  x.execution.website_recommendations=true;x.execution.demo_recommendations=true;
  return x;
}
test('strict analysis and scalp analysis remain separated and legacy remains available',()=>{
  for(const side of ['BUY','SELL']){
    const snapshot=cleanSnapshot(sample(side),NOW);
    const legacy=analyze(snapshot,NOW);
    const scalp=analyzeGoldScalp(snapshot,NOW);
    assert.equal(legacy.strategy,STRATEGY);
    assert.equal(scalp.strategy,GOLD_SCALP_STRATEGY);
    assert.equal(brokerGoldMarket(snapshot,NOW).analysis.strategy,STRATEGY);
    assert.equal(brokerGoldMarket(snapshot,NOW,{goldStrategy:'SCALP'}).analysis.strategy,GOLD_SCALP_STRATEGY);
    if(scalp.plan){
      assert.equal(scalp.plan.side,side);
      assert.ok(scalp.plan.expires_at-snapshot.received_at<=300);
      assert.equal(scalp.plan.timeframe,'M5');
      assert.equal(scalp.plan.status,'TRACKING');
    }
  }
});
test('closed source, stale candle, news, spread and invalid calendar never issue scalp plans',()=>{
  const stale=sample();stale.quote_at=NOW-50;
  assert.equal(analyzeGoldScalp(cleanSnapshot(stale,NOW),NOW).plan,null);
  const old=sample();old.candles.M5.forEach(c=>c.time-=900);
  assert.equal(analyzeGoldScalp(cleanSnapshot(old,NOW),NOW).plan,null);
  const calendar=sample();calendar.calendar.status='unavailable';
  assert.equal(analyzeGoldScalp(cleanSnapshot(calendar,NOW),NOW).plan,null);
  const news=sample();news.calendar.events=[{id:'test',name:'NFP',currency:'USD',time:NOW+600,importance:3}];
  assert.equal(analyzeGoldScalp(cleanSnapshot(news,NOW),NOW).plan,null);
  const spread=sample();spread.ask=spread.bid+.5;
  assert.equal(analyzeGoldScalp(cleanSnapshot(spread,NOW),NOW).plan,null);
});
test('scalp rollout is signals-only; live MT5 gold execution cannot be dispatched',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'nabd-scalp-'));
  const app=createApplication({dataDir:dir,clock:()=>NOW,
    config:{goldSignalStrategy:'SCALP',demoRecommendationExecution:true,publicationEnabled:true},
    ingestToken:'gold-scalp-safety-xxxxxxxxxxxxxxxxx'});
  t.after(async()=>{await app.close();rmSync(dir,{force:true,recursive:true});});
  const raw=sample();raw.ea=null;
  app.ingest(raw);
  const state=app.publicState(),m=app.marketFeed.publicState().markets.XAUUSD;
  assert.equal(m.analysis.strategy,GOLD_SCALP_STRATEGY);
  assert.equal(state.websiteExecution.ready,false);
  assert.equal(state.websiteExecution.reason,'SCALP_RECOMMENDATIONS_ONLY');
  assert.equal(state.demoExecution.ready,false);
  assert.equal(state.currentSignal?.strategy,m.currentSignal?.strategy||null);
});
test('roll back flag restores the old strategy at same source and preserves stored signals',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'nabd-legacy-'));
  const app=createApplication({dataDir:dir,clock:()=>NOW,
    config:{goldSignalStrategy:'EMA_LEGACY'},ingestToken:'legacy-test-xxxxxxxxxxxxxxxxxxxxxxxxx'});
  t.after(async()=>{await app.close();rmSync(dir,{force:true,recursive:true});});
  app.ingest(sample());
  const m=app.marketFeed.publicState().markets.XAUUSD;
  assert.equal(m.analysis.strategy,STRATEGY);
  assert.equal(m.currentSignal?.strategy,STRATEGY);
});
