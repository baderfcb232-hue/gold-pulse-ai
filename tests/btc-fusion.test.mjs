import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanSnapshot} from '../engine.mjs';
import {entryFixture,NOW} from './fixtures.mjs';
import {analyzeBtcScalp,BTC_SCALP_STRATEGY} from '../strategies/btc-scalping.mjs';
import {analyzeBtcFusion,BTC_FUSION_STRATEGY} from '../strategies/btc-fusion-scalper.mjs';
import {brokerBtcMarket,brokerGoldMarket} from '../broker-market.mjs';
import {createApplication} from '../server.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function source() {
 const raw=entryFixture();
 raw.symbol='BTCUSD.m';raw.positions=[];raw.deals=[];
 raw.calendar={status:'ok',updated_at:NOW,events:[]};
 raw.execution={...raw.execution,managed_magic:'26092302',website_recommendations:true,
   demo_recommendations:true,main_connected:true};
 raw.ea={heartbeat_at:NOW,emergency_stop:false,settings:{max_spread_points:2500}};
 return raw;
}
test('Fusion selected and legacy BTC and gold unchanged',()=>{
 const snap=cleanSnapshot(source(),NOW);
 assert.equal(analyzeBtcFusion(snap,NOW).strategy,BTC_FUSION_STRATEGY);
 assert.equal(brokerBtcMarket(snap,NOW,{btcStrategy:'FUSION'}).analysis.strategy,BTC_FUSION_STRATEGY);
 assert.equal(brokerBtcMarket(snap,NOW,{btcStrategy:'SCALP'}).analysis.strategy,BTC_SCALP_STRATEGY);
 assert.equal(brokerBtcMarket(snap,NOW,{btcStrategy:'EMA_LEGACY'}).analysis.strategy,'EMA-PULLBACK-1');
 assert.equal(brokerGoldMarket(snap,NOW),null);
 assert.equal(analyzeBtcScalp(snap,NOW).strategy,BTC_SCALP_STRATEGY);
});
test('Fusion blocks stale quotes, bars, high-impact news, spread, non-BTC',()=>{
 for (const change of [
  x=>{x.quote_at=NOW-60;}, x=>{x.candles.M5.forEach(c=>c.time-=1200);},
  x=>{x.calendar.status='unavailable';},
  x=>{x.calendar.events=[{currency:'USD',importance:3,name:'Test NFP',time:NOW+60}];},
  x=>{x.ask=x.bid+200;},x=>{x.symbol='XAUUSD.m';}
 ]) {
  const raw=source();change(raw);
  const r=analyzeBtcFusion(cleanSnapshot(raw,NOW),NOW);
  assert.equal(r.plan,null,r.reasons.join('|'));
  assert.equal(r.decision,'WAIT');
 }
});
test('Fusion is read-only without explicit Demo execution permission',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'nabd-btc-fusion-'));
 const app=createApplication({dataDir:dir,clock:()=>NOW,config:{
   btcSignalStrategy:'FUSION',btcFusionDemoAutoExecution:false}});
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 app.ingest(source());
 assert.equal(app.marketFeed.publicState().markets.BTCUSD.analysis.strategy,BTC_FUSION_STRATEGY);
});
test('invalid Fusion execution option fails validation',()=>{
 assert.throws(()=>createApplication({config:{btcFusionDemoAutoExecution:'true'}}),/Invalid NABD_BTC_FUSION_DEMO_AUTOTRADE/);
});

// The live dashboard must show why a BTC Fusion scan is waiting, not a blank score.
test('BTC Fusion timeframe conflict exposes nine evaluated checks but cannot open a plan',()=>{
  const raw=source();
  for(const tf of ['H1','H4']) for(const bar of raw.candles[tf]) {
    bar.open=4096;bar.close=4096;bar.high=4096.3;bar.low=4095.7;
  }
  const snapshot=cleanSnapshot(raw,NOW);
  const analysis=analyzeBtcFusion(snapshot,NOW);
  assert.match(analysis.reasons[0],/M15 conflicts with H1 and H4/);
  assert.equal(analysis.plan,null);
  assert.equal(analysis.decision,'WAIT');
  assert.equal(analysis.readinessChecks.length,8);
  assert.equal(analysis.readinessChecks[7].pass,false);
  assert.equal(analysis.checks.length,9);
  assert.ok(Number.isFinite(analysis.score));
  assert.equal(analysis.checks.find(c=>c.name==='H1 context').pass,false);
  assert.equal(analysis.checks.find(c=>c.name==='H4 context').pass,false);
  const displayed=brokerBtcMarket(snapshot,NOW,{btcStrategy:'FUSION'}).analysis;
  assert.deepEqual(displayed.checks,analysis.checks);
  assert.deepEqual(displayed.readinessChecks,analysis.readinessChecks);
  assert.equal(displayed.plan,null);
});
test('BTC Fusion displays failed early prerequisite and leaves later gates pending',()=>{
  const raw=source();raw.quote_at=NOW-60;
  const analysis=analyzeBtcFusion(cleanSnapshot(raw,NOW),NOW);
  assert.equal(analysis.plan,null);
  assert.equal(analysis.score,null);
  assert.equal(analysis.readinessChecks[0].pass,false);
  assert.ok(analysis.readinessChecks.slice(1).every(c=>c.pass===null));
});
