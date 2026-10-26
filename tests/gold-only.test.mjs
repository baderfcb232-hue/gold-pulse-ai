import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createApplication} from '../server.mjs';
import {createMarketFeed} from '../market.mjs';
import {cleanSnapshot} from '../engine.mjs';
import {entryFixture,eaFixture,NOW,fakeTelegram} from './fixtures.mjs';
const INGEST='gold-only-test-ingest-xxxxxxxxxxxxxxxxxx';
function raw(symbol='XAUUSD.m') {
  const r=entryFixture();r.symbol=symbol;r.ea=eaFixture().ea;r.ea.signal=null;
  r.execution={...r.execution,main_connected:true,demo_recommendations:true,website_recommendations:true,website_since:NOW-10};
  r.positions=[];r.deals=[];return r;
}
test('gold-only mode ignores conflicting BTC sources, fences dispatch and preserves the exact gold snapshot',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'nabd-gold-only-'));
  const stored=new DatabaseSync(join(dir,'nabd.sqlite'));
  stored.exec('CREATE TABLE btc_snapshot(id INTEGER PRIMARY KEY,data TEXT NOT NULL)');
  const previous=raw('BTCUSD.m');previous.account_ref='HISTORICAL_BTC';
  stored.prepare('INSERT INTO btc_snapshot VALUES(1,?)').run(JSON.stringify(cleanSnapshot(previous,NOW)));stored.close();
  const sent=[];
  const app=createApplication({dataDir:dir,clock:()=>NOW,ingestToken:INGEST,config:{goldOnly:true,publicationEnabled:true},
    telegramOptions:{token:'TEST_ONLY',chatId:'TEST_CHANNEL',fetcher:fakeTelegram(async(_url,options)=>{
      sent.push(JSON.parse(options.body).text);return new Response('{"ok":true}');
    })}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+app.server.address().port;
  const post=(path,data,token=INGEST)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(data)});
  assert.equal((await post('/api/mt5',raw())).status,200);
  const before=app.publicState(),btc=raw('BTCUSD.m');btc.account_ref='FOREIGN_BTC';
  const ignored=await (await post('/api/mt5',btc)).json();
  assert.equal(ignored.status,'ignored');assert.equal(ignored.reason,'GOLD_ONLY');
  assert.equal((await post('/api/mt5',btc,'incorrect')).status,401);
  assert.equal(app.publicState().revision,before.revision);assert.equal(app.publicState().bid,before.bid);
  assert.equal(app.publicState().symbol,'XAUUSD.m');assert.equal(app.publicState().goldOnly,true);
  assert.equal(app.marketFeed.publicState().markets.BTCUSD,undefined);
  assert.deepEqual(app.marketFeed.history('BTCUSD'),[]);
  assert.equal(await (await post('/api/bridge/website-recommendation',{symbol:'BTCUSD.m'})).text(),'');
  assert.equal(app.publicState().websiteBridge.connection,'NOT_OBSERVED');
  assert.equal(app.db.prepare('SELECT count(*) n FROM btc_snapshot').get().n,1,'historical data is preserved, never rebound');
  await app.telegram.publish();assert.equal(sent.length,1);assert.match(sent[0],/XAUUSD/);assert.doesNotMatch(sent[0],/BTCUSD/);
  const health=await (await fetch(base+'/healthz')).json();
  assert.equal(health.publication.ready,true);assert.equal(health.publication.reason,'READY');
});
test('disabled BTC cannot start REST, history or WebSocket connections or accept reference prices',async()=>{
  const db=new DatabaseSync(':memory:');let requests=0,sockets=0;
  const feed=createMarketFeed({db,clock:()=>NOW,enabledSymbols:['XAUUSD'],brokerSnapshot:()=>cleanSnapshot(raw(),NOW),
    fetcher:async()=>{requests++;throw Error('Unexpected external request');},WebSocketImpl:class{constructor(){sockets++;}}});
  assert.equal(feed.acceptQuote('BTCUSD',{price:4000,time:NOW}),false);
  assert.equal(feed.acceptHistory([]),false);
  feed.start();await feed.close();
  assert.equal(requests,0);assert.equal(sockets,0);db.close();
});
