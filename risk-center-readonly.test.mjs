import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {summarizeMarket} from './public/risk-control-center.js';

const src=path=>readFileSync(new URL(path,import.meta.url),'utf8');
test('risk page is read-only with separate gold and BTC cards',()=>{
 const html=src('./public/risk-control-center.html');
 const js=src('./public/risk-control-center.js');
 const server=src('./server.mjs');
 for(const symbol of ['XAUUSD','BTCUSD'])assert.ok(html.includes('data-market="'+symbol+'"'));
 assert.match(server,/['"]\/risk-control['"]\s*:\s*['"]risk-control-center\.html['"]/);
 assert.match(js,/fetch\('\/api\/state'/);
 assert.doesNotMatch(js,/fetch\(['"]\/api\/(?:commands|bridge|auth\/profile)/);
 assert.doesNotMatch(html,/<form\b/i);
});
test('risk monitoring uses independent market source and fails closed on missing data',()=>{
 const now=1000;
 const btc={terminalConnected:true,bridgeReceivedAt:999,connection:'LIVE',lastUpdate:999,
   execution:{risk_percent:0.4}};
 const out=summarizeMarket({controls:{BTCUSD:btc}},'BTCUSD',now);
 assert.equal(out.bridge,'live');assert.equal(out.quote,'live');
 assert.equal(out.risk,'0.40%');
 assert.equal(out.pause,null,'unknown emergency stop must not be shown as OFF');
 const gold=summarizeMarket({controls:{BTCUSD:btc}},'XAUUSD',now);
 assert.equal(gold.bridge,'disabled');
 assert.equal(gold.pause,null);
});
test('stale/future bridge data are not represented as connected',()=>{
 for(const timestamp of [950,1006,null]){
  const out=summarizeMarket({controls:{XAUUSD:{terminalConnected:true,
    bridgeReceivedAt:timestamp,connection:'LIVE',lastUpdate:999}}},'XAUUSD',1000);
  assert.equal(out.bridge,'stale');
 }
});
test('invalid risk percentage is never presented as valid',()=>{
 const state={controls:{XAUUSD:{terminalConnected:false,execution:{risk_percent:NaN}}}};
 assert.equal(summarizeMarket(state,'XAUUSD',1000).risk,null);
});
