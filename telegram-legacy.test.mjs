import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from './server.mjs';
import {NOW, eaFixture, samplePlan, fakeTelegram} from './tests/fixtures.mjs';

test('legacy Telegram restores broker and reference delivery without costs or D1; never creates orders', async t => {
  let now = NOW;
  const sent = [], dir = mkdtempSync(join(tmpdir(), 'nabd-legacy-'));
  const app = createApplication({dataDir: dir, clock: () => now, config: {publicationEnabled: true},
    telegramOptions: {token: 'TEST_ONLY', chatId: 'TEST_CHANNEL', fetcher: fakeTelegram(async (_url, options) => {
      sent.push(JSON.parse(options.body).text); return new Response('{"ok":true}');
    })}});
  t.after(async () => {await app.close(); rmSync(dir, {recursive: true, force: true});});
  app.ingest(eaFixture(now));
  assert.equal(app.publicState().currentSignal, null); // strict broker/order review remains unchanged
  await app.telegram.publish();
  assert.equal(sent.length, 1);
  assert.match(sent[0], /قبل التكاليف/);
  await app.telegram.publish(); assert.equal(sent.length, 1);
  now += 11;
  // Inject only the market feed boundary: the feed itself already enforces quote freshness.
  const btc = {...samplePlan(now), id: 'BTC-reference', symbol: 'BTCUSD', source: 'Coinbase', issued_at: now};
  app.marketFeed.publicState = () => ({markets: {BTCUSD: {currentSignal: btc}}});
  await app.telegram.publish();
  assert.equal(sent.length, 2); assert.match(sent[1], /BTCUSD/);
  await app.telegram.publish(); assert.equal(sent.length, 2);
  btc.id = 'expired'; btc.expires_at = now - 1;
  await app.telegram.publish(); assert.equal(sent.length, 2);
  app.marketFeed.publicState = () => ({markets: {BTCUSD: {currentSignal: null}}});
  await app.telegram.publish(); assert.equal(sent.length, 2);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM commands').get().n, 0);
});
