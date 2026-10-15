import {createHash} from 'node:crypto';
import {readFeed, cacheSeconds, retrySeconds} from './feed-http.mjs';

export const NEWS_SOURCES = Object.freeze([
  {id: 'bbc-business', name: 'BBC · اقتصاد', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', interval: 30},
  {id: 'bbc-arabic', name: 'BBC عربي', url: 'https://feeds.bbci.co.uk/arabic/rss.xml', interval: 30},
  {id: 'ecb', name: 'البنك المركزي الأوروبي', url: 'https://www.ecb.europa.eu/rss/press.html', interval: 60},
  {id: 'fed', name: 'الاحتياطي الفيدرالي', url: 'https://www.federalreserve.gov/feeds/press_all.xml', interval: 60}
]);

function decode(value) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ').replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => {
      const c = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
      return c > 0 && c <= 0x10ffff && !(c >= 0xd800 && c <= 0xdfff) ? String.fromCodePoint(c) : '';
    }).replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n) => ({amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '})[n])
    .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}
const field = (xml, tag) => xml.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '>', 'i'))?.[1] || '';
export function newsCategory(title) {
  return /\b(?:bitcoin|crypto(?:currency|currencies)?|ethereum)\b|ب[يِ]تكوين|عملات رقمية/i.test(title) ? 'BTC'
    : /\b(?:gold|bullion|silver|oil|wars?|warfare|interest rates?|inflation|federal reserve)\b|ذهب|فضة|نفط|حرب|تضخم|فائدة|الفيدرالي/i.test(title) ? 'GOLD' : 'ECON';
}
export function parseNewsFeed(xml, source, now) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > 1_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error('Unsafe or oversized news feed');
  if (!/<rss\b|<feed\b/i.test(xml)) throw new Error('Invalid news feed');
  const blocks = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].slice(0, 100);
  const items = [], seen = new Set();
  for (const [, , block] of blocks) {
    const title = decode(field(block, 'title')).slice(0, 300);
    const link = decode(field(block, 'link')) || block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1];
    const published = Date.parse(decode(field(block, 'pubDate') || field(block, 'published') || field(block, 'updated'))) / 1000;
    if (!title || !link || !(published > 0 && published <= now + 300)) continue;
    let url; try {url = new URL(link, source.url); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;} catch {continue;}
    const id = createHash('sha256').update(source.id + '|' + url.href).digest('hex');
    if (seen.has(id)) continue; seen.add(id);
    items.push({id, source: source.id, source_name: source.name, title, url: url.href,
      published_at: published, category: ['fed', 'ecb'].includes(source.id) ? 'GOLD'
        : source.id === 'bbc-arabic' && newsCategory(title) === 'ECON' ? 'WORLD' : newsCategory(title)});
  }
  return items.sort((a, b) => b.published_at - a.published_at);
}

export function createNewsFeed({db, clock = () => Date.now() / 1000, fetcher = fetch, onChange = () => {}, sources = NEWS_SOURCES}) {
  db.exec(`CREATE TABLE IF NOT EXISTS headlines (id TEXT PRIMARY KEY, published_at REAL NOT NULL, data TEXT NOT NULL);`);
  const state = sources.map(s => ({...s, status: 'PENDING', checked_at: null, last_success: null,
    next_check: 0, etag: null, modified: null, failures: 0, items: 0}));
  const controller = new AbortController(), pending = new Set();
  let revision = 0, timer, stopped = false, running = false;
  const rows = () => db.prepare('SELECT data FROM headlines ORDER BY published_at DESC LIMIT 150').all().map(r => JSON.parse(r.data));
  function publicState() {
    const now = clock();
    return {revision, serverTime: now, display_refresh_seconds: 1, items: rows(),
      sources: state.map(s => ({id: s.id, name: s.name, url: s.url, poll_seconds: s.interval,
        status: s.last_success && now > s.next_check + 30 ? 'STALE' : s.status,
        checked_at: s.checked_at, last_success: s.last_success, next_check: s.next_check || null, items: s.items})),
      note: 'تتجدد الواجهة كل ثانية. فحص RSS كل 30–60 ثانية أو حسب مهلة المصدر؛ وقت نشر الخبر قد يسبق وصوله. تصنيف الموضوع تقريبي، وليس توقعًا لتأثيره على السعر.'};
  }
  async function refresh(s) {
    s.busy = true; s.next_check = clock() + s.interval;
    try {
      const headers = {...(s.etag ? {'If-None-Match': s.etag} : {}), ...(s.modified ? {'If-Modified-Since': s.modified} : {})};
      const {response, body} = await readFeed(fetcher, s.url, {headers, signal: controller.signal});
      if (stopped) return;
      s.checked_at = clock();
      if (response.status === 304) {
        s.status = 'LIVE'; s.last_success = clock(); s.failures = 0;
        s.next_check = clock() + cacheSeconds(response, s.interval);
      } else if (response.ok) {
        const items = parseNewsFeed(body, s, clock());
        const insert = db.prepare('INSERT INTO headlines VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET published_at=excluded.published_at,data=excluded.data');
        let added = 0;
        for (const item of items) {
          const old = db.prepare('SELECT data FROM headlines WHERE id=?').get(item.id);
          const received = old ? JSON.parse(old.data).received_at : clock();
          insert.run(item.id, item.published_at, JSON.stringify({...item, received_at: received}));
          if (!old) added++;
        }
        db.prepare('DELETE FROM headlines WHERE id NOT IN (SELECT id FROM headlines ORDER BY published_at DESC LIMIT 300)').run();
        s.status = 'LIVE'; s.last_success = clock(); s.failures = 0; s.items = items.length;
        s.etag = response.headers.get('etag'); s.modified = response.headers.get('last-modified');
        const ttl = Number(xmlTtl(body)) * 60;
        s.next_check = clock() + Math.max(cacheSeconds(response, s.interval), Math.min(3600, ttl || 0));
        if (added) revision++;
      } else {
        s.status = 'ERROR'; s.next_check = clock() + retrySeconds(response, Math.min(900, s.interval * 2 ** Math.min(++s.failures, 5)));
      }
    } catch {
      if (!stopped) {s.status = 'ERROR'; s.checked_at = clock(); s.next_check = clock() + Math.min(900, s.interval * 2 ** Math.min(++s.failures, 5));}
    } finally {s.busy = false; if (!stopped) onChange();}
  }
  function tick() {
    if (stopped) return;
    for (const s of state) if (!s.busy && clock() >= s.next_check) {
      const job = refresh(s); pending.add(job); job.finally(() => pending.delete(job));
    }
  }
  return {publicState, refreshAll: () => Promise.all(state.filter(s => !s.busy).map(refresh)),
    start() {if (running || stopped) return; running = true; tick(); timer = setInterval(tick, 1000); timer.unref();},
    async close() {stopped = true; clearInterval(timer); controller.abort(); await Promise.allSettled([...pending]);}
  };
}
const xmlTtl = xml => xml.match(/<ttl>\s*(\d+)\s*<\/ttl>/i)?.[1] || 0;
