import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createTelegramPublisher, formatSignal} from './telegram.mjs';
test('only new active signals are delivered once', async () => {
  const db = new DatabaseSync(':memory:');
  let now = 100, calls = 0;
  const p = {id:'old',symbol:'XAUUSD',side:'BUY',status:'TRACKING',issued_at:99,expires_at:200,entry:10,sl:9,tp1:11,tp2:12};
  let signals = [p];
  const pub = createTelegramPublisher({db,clock:()=>now,signals:()=>signals,token:'test',chatId:'test',
    fetcher:async()=>{calls++;return {ok:true,json:async()=>({ok:true})};}});
  try {
    await pub.publish(); assert.equal(calls,0);
    now=102; signals=[{...p,id:'new',issued_at:101}];
    await pub.publish(); await pub.publish(); assert.equal(calls,1);
    assert.equal(pub.status().deliveries[0].state,'SENT');
  } finally {await pub.close();db.close();}
});
test('uncertain delivery is not repeated and signal errors are contained', async () => {
  const db = new DatabaseSync(':memory:');
  let calls=0, failSource=false;
  const pub=createTelegramPublisher({db,clock:()=>100,token:'test',chatId:'test',
    signals:()=>{if(failSource)throw Error('private');return [{id:'new',side:'SELL',status:'TRACKING',issued_at:100,expires_at:200}];},
    fetcher:async()=>{calls++;throw Error('private');}});
  try {
    await pub.publish();await pub.publish();assert.equal(calls,1);
    assert.equal(pub.status().deliveries[0].state,'UNCERTAIN');
    failSource=true;await pub.publish();assert.match(pub.status().lastError,/temporarily/);
    assert.match(formatSignal({symbol:'BTCUSD',side:'SELL',entry:null}),/الدخول: —/);
  } finally {await pub.close();db.close();}
});
