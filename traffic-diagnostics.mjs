// Opt-in, bounded, privacy-safe HTTP response accounting.
// Render edge maintenance pages, SSE streams and external CDNs are not included.
const groupFor = path => {
  if (path === '/api/mt5' || path === '/api/update') return 'mt5-ingest';
  if (path === '/api/mt5/btc-quote') return 'btc-quote';
  if (path.startsWith('/api/auth/')) return 'auth';
  if (path === '/api/market') return 'market';
  if (path === '/api/state') return 'state';
  if (path === '/healthz') return 'health';
  if (path === '/' || path === '/dashboard' || path === '/account') return 'html';
  if (path.startsWith('/api/')) return 'other-api';
  return 'assets-or-other';
};
export function createTrafficDiagnostics({enabled = false, clock = () => Date.now()/1000,
  log = console.info, intervalSeconds = 300} = {}) {
  const counters = new Map();
  let start = clock();
  function flush() {
    if (!enabled || !counters.size) return;
    const items = [...counters.entries()].map(([key, value]) => ({key, ...value}))
      .sort((a,b) => b.bytes-b.bytes || b.count-a.count);
    // No paths, query strings, headers, request bodies or account identifiers.
    log('NABD HTTP response summary:', JSON.stringify({periodSeconds: Math.max(0, Math.round(clock()-start)),
      groups: items.slice(0, 60)}));
    counters.clear(); start=clock();
  }
  function record(req, status, body) {
    if (!enabled) return;
    let path = '/';
    try {path = new URL(req.url, 'http://localhost').pathname;} catch {path='invalid';}
    const method = req.method === 'POST' ? 'POST' : req.method === 'GET' ? 'GET' : 'OTHER';
    const code = Number.isInteger(status) && status>=100 && status<=599 ? status : 0;
    const key = method + ':' + groupFor(path) + ':' + code;
    const bytes = Buffer.isBuffer(body) ? body.byteLength :
      typeof body === 'string' ? Buffer.byteLength(body) : 0;
    const stat = counters.get(key) || {count:0, bytes:0};
    stat.count++; stat.bytes += bytes; counters.set(key, stat);
    if(clock()-start >= intervalSeconds)flush();
  }
  return {record,flush};
}
