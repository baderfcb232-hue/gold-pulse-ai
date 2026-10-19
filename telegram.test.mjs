import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createTelegramPublisher, formatSignal} from './telegram.mjs';
import {fakeTelegram} from './tests/fixtures.mjs';
test('only new active signals are delivered once', async () => {
  const db = new DatabaseSync(':memory:');
  let now = 100, calls = 0;
  const p = {id:'old',symbol:'XAUUSD',side:'BUY',status:'TRACKING',issued_at:99,expires_at:200,entry:10,sl:9,tp1:11,tp2:12};
  let signals = [p];
  const pub = createTelegramPublisher({db,clock:()=>now,signals:()=>signals,token:'test',chatId:'test',enabled:true,
    fetcher:fakeTelegram(async()=>{calls++;return {ok:true,json:async()=>({ok:true})};})});
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
  const pub=createTelegramPublisher({db,clock:()=>100,token:'test',chatId:'test',enabled:true,
    signals:()=>{if(failSource)throw Error('private');return [{id:'new',side:'SELL',status:'TRACKING',issued_at:100,expires_at:200}];},
    fetcher:fakeTelegram(async()=>{calls++;throw Error('private');})});
  try {
    await pub.publish();await pub.publish();assert.equal(calls,1);
    assert.equal(pub.status().deliveries[0].state,'UNCERTAIN');
    failSource=true;await pub.publish();assert.match(pub.status().lastError,/temporarily/);
    assert.match(formatSignal({symbol:'BTCUSD',side:'SELL',entry:null}),/الدخول: —/);
  } finally {await pub.close();db.close();}
});

test('publisher rejects missing, future and nonfinite issue/expiry times before claiming delivery', async () => {
  const db = new DatabaseSync(':memory:'); let sends = 0;
  const valid = {id: 'TEST', side: 'BUY', status: 'TRACKING', issued_at: 100, expires_at: 200};
  const invalid = [{issued_at: undefined}, {issued_at: NaN}, {issued_at: 106}, {expires_at: Infinity}];
  const pub = createTelegramPublisher({db, clock: () => 100, enabled: true, token: 'TEST', chatId: 'TEST',
    signals: () => invalid.map((x, i) => ({...valid, ...x, id: 'INVALID_' + i})),
    fetcher: fakeTelegram(async () => {sends++; return new Response('{"ok":true}');})});
  try {await pub.publish(); assert.equal(sends, 0); assert.deepEqual(pub.status().deliveries, []);}
  finally {await pub.close(); db.close();}
});

test('missing channel posting permission blocks signal polling and retries the check with bounded cadence', async () => {
  const db = new DatabaseSync(':memory:'); let now = 100, checks = 0, sources = 0;
  const transport = fakeTelegram(async () => {throw Error('Must not send');});
  const pub = createTelegramPublisher({db, clock: () => now, enabled: true, token: 'TEST', chatId: 'TEST',
    signals: () => {sources++; return [];}, fetcher: async (url, options) => {
      checks++;
      if (String(url).endsWith('/getChatMember')) return new Response(JSON.stringify({ok: true,
        result: {status: 'administrator', user: {id: 123}, can_post_messages: false}}));
      return transport(url, options);
    }});
  try {
    await pub.publish(); assert.equal(checks, 3); assert.equal(sources, 0);
    assert.equal(pub.status().verification.state, 'FAILED'); assert.equal(pub.status().mode, 'WAITING_VERIFICATION');
    await pub.publish(); assert.equal(checks, 3);
    now += 301; await pub.publish(); assert.equal(checks, 6); assert.equal(sources, 0);
    assert.deepEqual(pub.status().deliveries, []);
  } finally {await pub.close(); db.close();}
});

test('operational alerts debounce faults, persist claims and send one recovery without private details', async () => {
  const db=new DatabaseSync(':memory:');let now=100,faults=['BRIDGE'],messages=[];
  const options={db,clock:()=>now,enabled:true,token:'TEST',chatId:'TEST',signals:()=>[],health:()=>faults,
    fetcher:fakeTelegram(async (_url,options)=>{messages.push(JSON.parse(options.body).text);return new Response('{"ok":true}');})};
  let pub=createTelegramPublisher(options);
  try {
    await pub.publish();now=399;await pub.publish();assert.equal(messages.length,0);
    now=400;await pub.publish();await pub.publish();assert.equal(messages.length,1);
    assert.match(messages[0],/تنبيه تشغيل/);assert.doesNotMatch(messages[0],/TEST|توصية جديدة/);
    await pub.close();pub=createTelegramPublisher(options);now=800;await pub.publish();assert.equal(messages.length,1);
    faults=[];await pub.publish();await pub.publish();assert.equal(messages.length,2);assert.match(messages[1],/عاد وصول/);
    faults=['BRIDGE'];await pub.publish();now=1000;await pub.publish();assert.equal(messages.length,2);
  } finally {await pub.close();db.close();}
});

test('uncertain operational alerts are not retried or followed by an unconfirmed recovery', async () => {
  const db=new DatabaseSync(':memory:');let now=100,faults=['STORAGE'],sends=0;
  const pub=createTelegramPublisher({db,clock:()=>now,enabled:true,token:'TEST',chatId:'TEST',signals:()=>[],health:()=>faults,
    fetcher:fakeTelegram(async()=>{sends++;throw Error('PRIVATE');})});
  try {await pub.publish();now=500;await pub.publish();now=5000;await pub.publish();assert.equal(sends,1);
    faults=[];await pub.publish();assert.equal(sends,1);
  } finally {await pub.close();db.close();}
});

test('explicit diagnostic sends labelled text once, confirms its message ID and stays outside signal history', async () => {
  const db = new DatabaseSync(':memory:'); let sends = 0, message;
  const options = {db, clock: () => 100, enabled: true, token: 'TEST', chatId: '@FixtureChannel',
    signals: () => [], testId: 'diagnostic-1', testChannel: '@FixtureChannel', testText: 'تحية من نبض $$$$$$',
    fetcher: fakeTelegram(async (_url, request) => {
      sends++; message = JSON.parse(request.body);
      return new Response(JSON.stringify({ok: true, result: {message_id: 42}}));
    })};
  let pub = createTelegramPublisher(options);
  try {
    await pub.publish(); await pub.publish();
    assert.equal(sends, 1); assert.equal(message.chat_id, '@FixtureChannel');
    assert.match(message.text, /تحية من نبض \$\$\$\$\$\$/);
    assert.match(message.text, /رسالة اختبار اتصال/); assert.match(message.text, /ليست توصية تداول/);
    assert.doesNotMatch(message.text, /الدخول:|وقف الخسارة:|الهدف الأول:/);
    assert.equal(pub.status().testDelivery.state, 'SENT'); assert.equal(pub.status().testDelivery.message_id, 42);
    assert.deepEqual(pub.status().deliveries, []);
    await pub.close(); pub = createTelegramPublisher(options); await pub.publish(); assert.equal(sends, 1);
  } finally {await pub.close(); db.close();}
});

test('diagnostic requires the verified recipient and posting permission', async () => {
  for (const denied of [false, true]) {
    const db = new DatabaseSync(':memory:'); let sends = 0;
    const transport = fakeTelegram(async () => {sends++; return new Response('{"ok":true,"result":{"message_id":1}}');});
    const pub = createTelegramPublisher({db, clock: () => 100, enabled: true, token: 'TEST', chatId: '@FixtureChannel',
      signals: () => [], testId: 'recipient-test', testChannel: denied ? '@FixtureChannel' : '@DifferentChannel', testText: 'مرحبا',
      fetcher: async (url, options) => denied && String(url).endsWith('/getChatMember')
        ? new Response('{"ok":true,"result":{"status":"member","user":{"id":123}}}') : transport(url, options)});
    try {await pub.publish(); assert.equal(sends, 0);
      assert.equal(pub.status().testDelivery?.state ?? null, denied ? null : 'REJECTED_CHANNEL');}
    finally {await pub.close(); db.close();}
  }
});

test('uncertain diagnostic is never retried, including after publisher restart', async () => {
  const db = new DatabaseSync(':memory:'); let sends = 0;
  const options = {db, clock: () => 100, enabled: true, token: 'TEST', chatId: '@FixtureChannel', signals: () => [],
    testId: 'uncertain-test', testChannel: '@FixtureChannel', testText: 'مرحبا',
    fetcher: fakeTelegram(async () => {sends++; throw Error('PRIVATE');})};
  let pub = createTelegramPublisher(options);
  try {await pub.publish(); await pub.publish(); assert.equal(pub.status().testDelivery.state, 'UNCERTAIN');
    await pub.close(); pub = createTelegramPublisher(options); await pub.publish(); assert.equal(sends, 1);}
  finally {await pub.close(); db.close();}
});
