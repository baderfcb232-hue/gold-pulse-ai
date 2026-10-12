import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {parseNewsFeed, createNewsFeed} from '../news.mjs';
const NOW = 1791806400;
const source = {id: 'test-only', name: 'TEST SOURCE', url: 'https://news.example/rss', interval: 30};
const rss = (title = 'Gold &amp; dollar') => `<rss><channel><item><title><![CDATA[${title}]]></title><link>https://news.example/story</link><pubDate>${new Date((NOW - 60) * 1000).toUTCString()}</pubDate></item></channel></rss>`;

test('RSS/Atom parsing preserves source times and safely decodes titles without executable markup', () => {
  const [item] = parseNewsFeed(rss('Gold &amp; dollar <img src=x onerror=alert(1)>'), source, NOW);
  assert.equal(item.title, 'Gold & dollar'); assert.equal(item.published_at, NOW - 60); assert.equal(item.category, 'GOLD');
  assert.equal(item.url, 'https://news.example/story');
  assert.throws(() => parseNewsFeed('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///secret">]>' + rss(), source, NOW), /Unsafe/);
  assert.equal(parseNewsFeed(rss().replace('https://news.example/story', 'javascript:alert(1)'), source, NOW).length, 0);
  assert.equal(parseNewsFeed(rss().replace(new Date((NOW - 60) * 1000).toUTCString(), new Date((NOW + 3600) * 1000).toUTCString()), source, NOW).length, 0);
  const atom = `<feed><entry><title>Bitcoin update</title><link href="https://news.example/btc"/><updated>${new Date(NOW * 1000).toISOString()}</updated></entry></feed>`;
  assert.equal(parseNewsFeed(atom, source, NOW)[0].category, 'BTC');
});
test('news dedup keeps original arrival time and conditional 304 does not remove headlines', async () => {
  const db = new DatabaseSync(':memory:'); let now = NOW, call = 0, conditional;
  const fetcher = async (_, options) => {call++; conditional = options.headers;
    return call === 2 ? new Response(null, {status: 304}) : new Response(rss(call === 3 ? 'Updated gold title' : undefined), {headers: {'ETag': 'test-etag', 'Content-Type': 'application/rss+xml'}});};
  const feed = createNewsFeed({db, clock: () => now, fetcher, sources: [source]});
  await feed.refreshAll(); assert.equal(feed.publicState().items.length, 1); assert.equal(feed.publicState().items[0].received_at, NOW);
  now += 30; await feed.refreshAll(); assert.equal(conditional['If-None-Match'], 'test-etag'); assert.equal(feed.publicState().items.length, 1);
  now += 30; await feed.refreshAll(); assert.equal(feed.publicState().items[0].title, 'Updated gold title'); assert.equal(feed.publicState().items[0].received_at, NOW);
  await feed.close(); db.close();
});
test('source caching and rate-limit backoff preserve old headlines and expose fetch status', async () => {
  const db = new DatabaseSync(':memory:'); let now = NOW, call = 0;
  const fetcher = async () => ++call === 1 ? new Response(rss(), {headers: {'Cache-Control': 'max-age=90'}})
    : new Response('limited', {status: 429, headers: {'Retry-After': '120'}});
  const feed = createNewsFeed({db, clock: () => now, fetcher, sources: [source]});
  await feed.refreshAll(); assert.equal(feed.publicState().sources[0].next_check, NOW + 90);
  now += 90; await feed.refreshAll(); const state = feed.publicState();
  assert.equal(state.sources[0].status, 'ERROR'); assert.equal(state.sources[0].next_check, now + 120); assert.equal(state.items.length, 1);
  await feed.close(); db.close();
});
test('RSS TTL keeps a cached source healthy until its scheduled check', async () => {
  const db = new DatabaseSync(':memory:'); let now = NOW;
  const fetcher = async () => new Response(rss().replace('<channel>', '<channel><ttl>15</ttl>'));
  const feed = createNewsFeed({db, clock: () => now, fetcher, sources: [source]});
  await feed.refreshAll(); assert.equal(feed.publicState().sources[0].next_check, NOW + 900);
  now += 400; assert.equal(feed.publicState().sources[0].status, 'LIVE');
  now += 600; assert.equal(feed.publicState().sources[0].status, 'STALE');
  await feed.close(); db.close();
});
