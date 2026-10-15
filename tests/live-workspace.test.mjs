import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as flush} from 'node:timers/promises';
import {initLiveWorkspace} from '../public/live.js';

// Minimal DOM for testing the actual workspace's API/event lifecycle in Node.
class Element {
  constructor() {this.children = []; this.style = {}; this.dataset = {}; this.classList = {toggle() {}};}
  append(...children) {this.children.push(...children);}
  replaceChildren(...children) {this.children = children;}
  setAttribute(name, value) {this[name] = value;}
  querySelectorAll() {return [];}
  cloneNode() {return new Element();}
  replaceWith() {}
}
const headline = (serverTime, title) => ({serverTime, revision: serverTime, sources: [], items: [{
  title, url: 'https://news.example/story', source_name: 'TEST', published_at: serverTime,
  received_at: serverTime, category: 'ECON'
}]});
const deferred = () => {let resolve; const promise = new Promise(yes => {resolve = yes;}); return {promise, resolve};};
function workspace(t, readNews) {
  let ms = 1791806400000;
  const elements = new Map(), callbacks = new Map(), intervals = [], reads = [];
  const get = id => {if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id);};
  get('headline-filter').value = 'ALL';
  const oldDocument = globalThis.document;
  globalThis.document = {getElementById: get, createElement: () => new Element(), addEventListener() {}};
  t.after(() => {if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;});
  t.mock.method(Date, 'now', () => ms);
  t.mock.method(globalThis, 'setInterval', (callback, delay) => {intervals.push({callback, delay}); return intervals.length;});
  const market = () => ({serverTime: ms / 1000, markets: {XAUUSD: {symbol: 'XAUUSD', name: 'Gold',
    quote: {price: 2000, time: ms / 1000}, quoteTtl: 90, connection: 'LIVE', recentSignals: [],
    analysis: {status: 'SCANNING', checks: [], frames: {}}
  }}});
  const api = async path => {reads.push(path);
    if (path === '/api/market') return market();
    if (path === '/api/news') return readNews(ms / 1000);
    return {signals: []};
  };
  initLiveWorkspace({stream: {addEventListener: (name, callback) => callbacks.set(name, callback)},
    api, time: String, num: String, now: () => ms / 1000, notify() {}});
  return {reads, advance: amount => {ms += amount;}, now: () => ms / 1000,
    news: value => callbacks.get('news')({data: JSON.stringify(value)}),
    market: () => callbacks.get('market')({data: JSON.stringify(market())}),
    poll: () => intervals.find(x => x.delay === 5000).callback(),
    title: () => get('headlines-list').children[0]?.children[1]?.textContent};
}

test('a failed news load retries even while live market events keep arriving', async t => {
  let calls = 0;
  const h = workspace(t, now => {if (++calls === 1) throw Error('news offline'); return headline(now, 'Recovered news');});
  await flush(); assert.equal(calls, 1);
  h.advance(5000); h.market(); h.poll(); await flush();
  assert.equal(calls, 2); assert.equal(h.title(), 'Recovered news');
});

test('silent news events recover over HTTP without interrupting an active market stream', async t => {
  let calls = 0;
  const h = workspace(t, now => headline(now, ++calls === 1 ? 'Initial news' : 'Fresh news'));
  await flush();
  for (let i = 0; i < 16; i++) {h.advance(5000); h.market(); h.poll(); await flush();}
  assert.equal(calls, 2); assert.equal(h.title(), 'Fresh news');
});

test('a late HTTP news response cannot replace a newer event or accept malformed news', async t => {
  const request = deferred(), h = workspace(t, () => request.promise), started = h.now();
  await flush(); h.advance(1000); h.news(headline(h.now(), 'Newest event'));
  request.resolve(headline(started, 'Older HTTP reply')); await flush();
  assert.equal(h.title(), 'Newest event');
  h.news({...headline(h.now() + 1, 'Malformed event'), sources: null});
  h.news({...headline(h.now() + 1, 'Invalid time'), serverTime: null});
  assert.equal(h.title(), 'Newest event');
});
