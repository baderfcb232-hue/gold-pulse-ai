export async function readFeed(fetcher, url, {headers = {}, signal, maxBytes = 1_000_000} = {}) {
  const response = await fetcher(url, {headers: {'User-Agent': 'NABD/3.3 market-monitor', ...headers},
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000), redirect: 'error'});
  if (response.status === 304 || !response.ok) return {response, body: ''};
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Feed is too large');
  const reader = response.body.getReader(); const chunks = []; let length = 0;
  try {
    while (true) {const {done, value} = await reader.read(); if (done) break;
      length += value.length; if (length > maxBytes) throw new Error('Feed is too large'); chunks.push(value);}
  } catch (error) {await reader.cancel(); throw error;}
  return {response, body: Buffer.concat(chunks).toString('utf8')};
}

export function cacheSeconds(response, minimum, maximum = 3600) {
  const age = Number(response.headers.get('cache-control')?.match(/(?:s-maxage|max-age)=(\d+)/)?.[1] || 0);
  return Math.min(maximum, Math.max(minimum, age));
}

export function retrySeconds(response, minimum = 30) {
  const raw = response?.headers.get('retry-after');
  const value = /^\d+$/.test(raw || '') ? Number(raw) : (Date.parse(raw) - Date.now()) / 1000;
  return Math.min(3600, Math.max(minimum, Number.isFinite(value) ? value : 0));
}
