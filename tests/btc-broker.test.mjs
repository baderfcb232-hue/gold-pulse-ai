import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {entryFixture, eaFixture, NOW} from './fixtures.mjs';
import {cleanSnapshot} from '../engine.mjs';
import {brokerGoldMarket,brokerBtcMarket} from '../broker-market.mjs';
import {websiteTradeDecision} from '../website-entry.mjs';
import {createApplication} from '../server.mjs';

function btcRaw(){
  const raw=entryFixture();
  raw.symbol='BTCUSD.m';
  raw.execution={...raw.execution,managed_magic:'26092302',main_connected:true,
    demo_recommendations:true,website_recommendations:true,website_since:NOW-10};
  raw.ea={...eaFixture().ea,signal:null,heartbeat_at:NOW,
    settings:{...eaFixture().ea.settings,max_spread_points:2500}};
  raw.positions=[];raw.deals=[];
  raw.account={currency:'USD',balance:10000,equity:10000,free_margin:10000,floating:0};
  return raw;
}
function goldRaw(){
  const raw=entryFixture();raw.symbol='XAUUSD.m';
  raw.execution.managed_magic='26092301';
  raw.positions=[];raw.deals=[];
  return raw;
}
test('BTC broker plans never come from Coinbase and cannot alias gold',()=>{
  const raw=btcRaw(),snap=cleanSnapshot(raw,NOW);
  const btc=brokerBtcMarket(snap,NOW);
  assert.equal(btc.symbol,'BTCUSD');
  assert.equal(btc.broker_symbol,'BTCUSD.m');
  assert.equal(btc.source,'MT5 · JustMarkets-Demo');
  assert.equal(btc.candle_kind,'BROKER_OHLC');
  assert.equal(btc.analysis.plan.symbol,'BTCUSD');
  assert.equal(btc.analysis.plan.broker_symbol,'BTCUSD.m');
  assert.equal(btc.analysis.status,'READY');
  assert.equal(brokerGoldMarket(snap,NOW),null);
  const eth=btcRaw();eth.symbol='ETHBTC';
  assert.equal(brokerBtcMarket(cleanSnapshot(eth,NOW),NOW),null);
  const suffix=btcRaw();suffix.symbol='BTCUSDT';
  assert.equal(brokerBtcMarket(cleanSnapshot(suffix,NOW),NOW),null);
});
test('BTC website Demo approval uses its own frozen source, stop, target and cost gates',()=>{
  const s=cleanSnapshot(btcRaw(),NOW);
  const broker=brokerBtcMarket(s,NOW), plan={...broker.analysis.plan,id:'btc-plan',status:'TRACKING'};
  const params={enabled:true,snapshot:s,market:{...broker,currentSignal:plan},
    analysisPlan:broker.analysis.plan,costs:{ready:true},durable:true,now:NOW};
  const approval=websiteTradeDecision(params);
  assert.equal(approval.ready,true,approval.reason);
  assert.equal(approval.plan.tp,plan.tp1);
  assert.equal(websiteTradeDecision({...params,costs:{ready:false}}).reason,'WAITING_COSTS');
  assert.equal(websiteTradeDecision({...params,market:{...broker,currentSignal:{...plan,source:'Coinbase'}}}).reason,'WEBSITE_SOURCE_MISMATCH');
  assert.equal(websiteTradeDecision({...params,market:{...broker,currentSignal:{...plan,broker_symbol:'XAUUSD.m'}}}).reason,'WEBSITE_SOURCE_MISMATCH');
  assert.equal(websiteTradeDecision({...params,snapshot:{...s,execution:{...s.execution,demo:false}}}).reason,'NOT_JUSTMARKETS_DEMO');
});
test('gold and BTC bridges store distinct snapshots and broker candles',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'nabd-btc-broker-'));
  const app=createApplication({dataDir:dir,clock:()=>NOW,
    ingestToken:'btc-bridge-test-ingest-xxxxxxxxxxxxxxxx'});
  t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  const post=async raw=>fetch(base+'/api/mt5',{method:'POST',
    headers:{Authorization:'Bearer btc-bridge-test-ingest-xxxxxxxxxxxxxxxx','Content-Type':'application/json'},
    body:JSON.stringify(raw)});
  assert.equal((await post(goldRaw())).status,200);
  const goldBefore=app.marketFeed.publicState().markets.XAUUSD;
  assert.equal((await post(btcRaw())).status,200);
  const markets=app.marketFeed.publicState().markets;
  assert.equal(markets.BTCUSD.source,'MT5 · JustMarkets-Demo');
  assert.equal(markets.BTCUSD.broker_symbol,'BTCUSD.m');
  assert.equal(markets.XAUUSD.source_id,goldBefore.source_id);
  assert.equal(markets.XAUUSD.broker_symbol,'XAUUSD.m');
  assert.equal(app.marketFeed.history('BTCUSD')[0].symbol,'BTCUSD');
  const btcCandles=await (await fetch(base+'/api/market/candles?symbol=BTCUSD&tf=M5')).json();
  assert.equal(btcCandles.source_id,markets.BTCUSD.source_id);
  assert.deepEqual(btcCandles.candles,btcRaw().candles.M5);
  const mistaken=btcRaw();mistaken.symbol='BTCUSD-other';
  assert.equal((await post(mistaken)).status,400);
});
