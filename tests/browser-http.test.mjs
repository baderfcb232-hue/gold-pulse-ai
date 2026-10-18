import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {requestJson} from '../public/http.js';

async function endpoint(t, handle) {
  const server = http.createServer(handle);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {server.closeAllConnections(); return new Promise(resolve => server.close(resolve));});
  return 'http://127.0.0.1:' + server.address().port;
}
function withoutNativeTimeout(t) {
  const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout');
  Object.defineProperty(AbortSignal, 'timeout', {...descriptor, value: undefined});
  t.after(() => Object.defineProperty(AbortSignal, 'timeout', descriptor));
}

test('JSON requests and refresh recovery work without AbortSignal.timeout', async t => {
  withoutNativeTimeout(t);
  let calls = 0;
  const base = await endpoint(t, (req, res) => {
    if (++calls === 1) {res.writeHead(503); res.end('{"error":"Unavailable"}');}
    else res.end('{"connection":"NO_DATA"}');
  });
  await assert.rejects(requestJson(base), {message: 'Unavailable', status: 503});
  assert.deepEqual(await requestJson(base), {connection: 'NO_DATA'});
});

test('account POST requests preserve the body and CSRF header on older browsers', async t => {
  withoutNativeTimeout(t);
  let submitted, csrf;
  const base = await endpoint(t, async (req, res) => {
    csrf = req.headers['x-nabd-csrf'];
    let text = ''; for await (const chunk of req) text += chunk;
    submitted = JSON.parse(text); res.end('{"ok":true}');
  });
  const body = {name: 'Test Member', notifications: false};
  assert.deepEqual(await requestJson(base, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-NABD-CSRF': 'test-csrf'}, body: JSON.stringify(body)}, 30000), {ok: true});
  assert.deepEqual(submitted, body); assert.equal(csrf, 'test-csrf');
});

test('a stalled connection times out without native timeout support', async t => {
  withoutNativeTimeout(t);
  const base = await endpoint(t, () => {});
  await assert.rejects(requestJson(base, {}, 50), {name: 'TimeoutError', message: 'انتهت مهلة الاتصال بالخادم؛ حاول مرة أخرى.'});
});

test('the timeout also covers a stalled JSON body after headers arrive', async t => {
  const base = await endpoint(t, (req, res) => {
    res.writeHead(200, {'Content-Type': 'application/json'}); res.write('{');
  });
  await assert.rejects(requestJson(base, {}, 100), {name: 'TimeoutError'});
});

test('caller cancellation is preserved and is not reported as a timeout', async t => {
  const base = await endpoint(t, () => {}), controller = new AbortController();
  const pending = requestJson(base, {signal: controller.signal}); controller.abort();
  await assert.rejects(pending, {name: 'AbortError'});
  await assert.rejects(requestJson(base, {signal: controller.signal}), {name: 'AbortError'});
});

test('invalid JSON gets a readable error and HTTP denials retain their status', async t => {
  const base = await endpoint(t, (req, res) => {
    if (req.url === '/invalid') res.end('<html>Gateway unavailable</html>');
    else {res.writeHead(401); res.end('{"error":"Sign in required"}');}
  });
  await assert.rejects(requestJson(base + '/invalid'), {message: 'استجابة الخادم غير صالحة.'});
  await assert.rejects(requestJson(base), {status: 401, message: 'Sign in required'});
});
