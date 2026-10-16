import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../server.mjs';
import {sqliteAuthStore} from '../auth-store.mjs';
import {totp, totpStep, encrypt, decrypt, hashPassword, checkPassword} from '../auth-crypto.mjs';
import {backupStorage, exportAuthBackup} from '../auth-backup.mjs';
import {createAuthMailer} from '../auth-mail.mjs';
import {samplePlan, fixture} from './fixtures.mjs';

const PASSWORD = 'A long testing password 2026!', OWNER = 'owner@example.test';
async function setup(t, options = {}) {
  let now = 1792105200; const mails = [], copies = [], errors = [], dataDir = mkdtempSync(join(tmpdir(), 'nabd-accounts-'));
  const store = sqliteAuthStore(), backup = {key: randomBytes(32), storage: async (name, content) => copies.push({name, content})};
  const app = createApplication({dataDir, publicBase: 'https://nabd.example', clock: () => now,
    accountOptions: {store, env: {}, adminEmail: OWNER, encryptionKey: randomBytes(32),
      mailer: async mail => {mails.push(mail);}, onError: error => errors.push(error), backup, ...options}});
  await app.accounts.ready; await new Promise(done => app.server.listen(0, '127.0.0.1', done));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  t.after(async () => {await app.close(); rmSync(dataDir, {recursive: true, force: true});});
  const request = async (path, data, auth = {}, headers = {}) => {
    const response = await fetch(base + path, {method: data === undefined ? 'GET' : 'POST',
      headers: {Origin: 'https://nabd.example', ...(data === undefined ? {} : {'Content-Type': 'application/json'}),
        ...(auth.cookie ? {Cookie: auth.cookie, 'X-NABD-CSRF': auth.csrf || ''} : {}), ...headers},
      ...(data === undefined ? {} : {body: JSON.stringify(data)})});
    const json = await response.json();
    return {status: response.status, body: json, cookies: response.headers.getSetCookie(),
      cookie: response.headers.getSetCookie().filter(x => !x.includes('Max-Age=0')).map(x => x.split(';')[0]).join('; '), csrf: json.csrf};
  };
  const register = async (email, password = PASSWORD) => {
    const response = await request('/api/auth/register', {email, name: 'Test Member', password, acceptPrivacy: true, role: 'admin'});
    assert.equal(response.status, 202); return mails.filter(m => m.email === email && m.kind === 'verify').at(-1)?.token;
  };
  const verify = async (email, password = PASSWORD) => {
    const token = await register(email, password);
    const response = await request('/api/auth/verify', {token, password}); assert.equal(response.status, 200); return token;
  };
  const login = (email, password = PASSWORD) => request('/api/auth/login', {email, password});
  const owner = async () => {
    await verify(OWNER); const auth = await login(OWNER); assert.equal(auth.status, 200);
    const pending = await request('/api/auth/mfa/start', {password: PASSWORD}, auth); assert.equal(pending.status, 200);
    const confirmed = await request('/api/auth/mfa/confirm', {code: totp(pending.body.secret, Math.floor(now / 30))}, auth);
    assert.equal(confirmed.status, 200); assert.equal(confirmed.body.recoveryCodes.length, 8);
    return {...auth, secret: pending.body.secret, recoveryCodes: confirmed.body.recoveryCodes};
  };
  return {app, store, base, request, register, verify, login, owner, mails, copies, errors, backup, advance: seconds => {now += seconds;}, now: () => now};
}

test('accounts refuse registration without persistent database and mail setup', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'nabd-unconfigured-'));
  const app = createApplication({dataDir: dir, accountOptions: {env: {}}});
  await app.accounts.ready; await new Promise(done => app.server.listen(0, '127.0.0.1', done));
  t.after(async () => {await app.close(); rmSync(dir, {recursive: true, force: true});});
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const status = await (await fetch(base + '/api/auth/status')).json(); assert.equal(status.ready, false); assert.ok(status.missing.includes('DATABASE'));
  assert.equal((await fetch(base + '/api/auth/register', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'})).status, 503);
  assert.equal((await fetch(base + '/api/signals')).status, 401);
  assert.equal((await fetch(base + '/api/market/signals')).status, 401);
  assert.equal((await fetch(base + '/api/signals.csv')).status, 401);
  for (const path of ['/auth', '/account', '/admin', '/privacy', '/accounts.js', '/accounts.css']) assert.equal((await fetch(base + path)).status, 200);
});

test('verified email ownership fixes the final password and cannot accept a requested admin role', async t => {
  const h = await setup(t), token = await h.register('member@example.test');
  assert.equal((await h.login('member@example.test')).status, 401);
  const pass = 'The actual mailbox owners password!';
  assert.equal((await h.request('/api/auth/verify', {token, password: pass})).status, 200);
  assert.equal((await h.request('/api/auth/verify', {token, password: pass})).status, 400);
  assert.equal((await h.login('member@example.test')).status, 401);
  const auth = await h.login('member@example.test', pass); assert.equal(auth.status, 200); assert.equal(auth.body.user.role, 'user');
  assert.match(auth.cookies[0], /HttpOnly/); assert.match(auth.cookies[0], /Secure/); assert.match(auth.cookies[0], /SameSite=Strict/);
  assert.equal('password_hash' in auth.body.user, false); assert.equal('totp_secret' in auth.body.user, false);
  assert.equal((await h.request('/api/admin/users', undefined, auth)).status, 403);
  assert.equal((await h.request('/api/account', undefined, auth)).status, 401);
  assert.equal((await h.request('/api/commands', {action: 'CLOSE_ALL'}, auth)).status, 401);
  assert.equal((await h.request('/api/signals', undefined, auth)).status, 200);
  const row = (await h.store.query('SELECT * FROM nabd_users')).rows[0]; assert.match(row.password_hash, /^scrypt\$/); assert.notEqual(row.password_hash, pass);
});

test('database setup can be verified while missing email keeps registration closed', async t => {
  const h = await setup(t, {mailer: undefined});
  const status = (await h.request('/api/auth/status')).body;
  assert.equal(status.ready, false); assert.equal(status.database, 'CONNECTED'); assert.deepEqual(status.missing, ['EMAIL']);
  assert.equal((await h.request('/api/auth/register', {email: 'member@example.test', name: 'Member', password: PASSWORD, acceptPrivacy: true})).status, 503);
  assert.equal((await h.store.query('SELECT COUNT(*) AS count FROM nabd_users')).rows[0].count, 0);
});

test('cookie changes require same origin and CSRF; sessions and profile are scoped to their owner', async t => {
  const h = await setup(t); await h.verify('one@example.test'); await h.verify('two@example.test');
  const one = await h.login('one@example.test'), two = await h.login('two@example.test');
  assert.equal((await h.request('/api/auth/profile', {name: 'Changed', notifications: false}, one, {'X-NABD-CSRF': ''})).status, 403);
  assert.equal((await h.request('/api/auth/profile', {name: 'Changed', notifications: false}, one, {Origin: 'https://evil.example'})).status, 403);
  assert.equal((await h.request('/api/auth/profile', {name: 'Changed', notifications: false, id: two.body.user.id, role: 'admin'}, one)).status, 200);
  assert.equal((await h.request('/api/auth/me', undefined, two)).body.user.name, 'Test Member');
  const mine = (await h.request('/api/auth/me', undefined, one)).body.user; assert.equal(mine.name, 'Changed'); assert.equal(mine.role, 'user'); assert.equal(mine.notifications, false);
  const sessions = (await h.request('/api/auth/sessions', undefined, two)).body.sessions;
  await h.request('/api/auth/sessions/revoke', {id: sessions[0].id}, one);
  assert.ok((await h.request('/api/auth/me', undefined, two)).body.user);
  await h.request('/api/auth/sessions/revoke', {all: true}, one);
  assert.equal((await h.request('/api/auth/me', undefined, one)).body.user, null);
});

test('reset tokens expire, are single-use and revoke old sessions', async t => {
  const h = await setup(t); await h.verify('reset@example.test'); const old = await h.login('reset@example.test');
  await h.request('/api/auth/forgot', {email: 'reset@example.test'});
  let token = h.mails.filter(x => x.kind === 'reset').at(-1).token; h.advance(1801);
  assert.equal((await h.request('/api/auth/reset', {token, password: PASSWORD + 'new'})).status, 400);
  await h.request('/api/auth/forgot', {email: 'reset@example.test'}); token = h.mails.filter(x => x.kind === 'reset').at(-1).token;
  assert.equal((await h.request('/api/auth/reset', {token, password: PASSWORD + 'new'})).status, 200);
  assert.equal((await h.request('/api/auth/reset', {token, password: PASSWORD + 'new'})).status, 400);
  assert.equal((await h.request('/api/auth/me', undefined, old)).body.user, null);
  assert.equal((await h.login('reset@example.test', PASSWORD + 'new')).status, 200);
  const unknown = await h.request('/api/auth/forgot', {email: 'unknown@example.test'}); assert.equal(unknown.status, 202); assert.equal('token' in unknown.body, false);
});

test('admin requires MFA; authenticator and recovery codes cannot be replayed', async t => {
  const h = await setup(t); await h.verify(OWNER); const initial = await h.login(OWNER);
  assert.equal(initial.body.user.role, 'admin'); assert.equal((await h.request('/api/admin/overview', undefined, initial)).status, 403);
  const start = await h.request('/api/auth/mfa/start', {password: PASSWORD}, initial), code = totp(start.body.secret, Math.floor(h.now() / 30));
  const confirm = await h.request('/api/auth/mfa/confirm', {code}, initial); assert.equal(confirm.status, 200);
  const stored = (await h.store.query('SELECT totp_secret FROM nabd_users WHERE email=?', [OWNER])).rows[0]; assert.notEqual(stored.totp_secret, start.body.secret);
  assert.equal((await h.request('/api/admin/overview', undefined, initial)).status, 200);
  let challenge = await h.login(OWNER); assert.equal(challenge.body.mfaRequired, true);
  assert.equal((await h.request('/api/auth/mfa-login', {code}, challenge)).status, 401);
  h.advance(31); const auth = await h.request('/api/auth/mfa-login', {code: totp(start.body.secret, Math.floor(h.now() / 30))}, challenge); assert.equal(auth.status, 200);
  challenge = await h.login(OWNER); const recovery = confirm.body.recoveryCodes[0];
  assert.equal((await h.request('/api/auth/mfa-login', {code: recovery}, challenge)).status, 200);
  challenge = await h.login(OWNER); assert.equal((await h.request('/api/auth/mfa-login', {code: recovery}, challenge)).status, 401);
  await h.request('/api/auth/forgot', {email: OWNER}); const token = h.mails.filter(x => x.kind === 'reset').at(-1).token;
  await h.request('/api/auth/reset', {token, password: PASSWORD + 'new'});
  assert.equal((await h.login(OWNER, PASSWORD + 'new')).body.mfaRequired, true);
});

test('admin suspension and recommendation permissions immediately revoke access and are audited', async t => {
  const h = await setup(t), admin = await h.owner(); await h.verify('member@example.test'); const auth = await h.login('member@example.test');
  const p = samplePlan(); h.app.db.prepare('INSERT INTO signals VALUES(?,?,?)').run(p.id, p.issued_at, JSON.stringify(p));
  assert.equal((await h.request('/api/signals', undefined, auth)).body.signals.length, 1);
  const events = await fetch(h.base + '/api/events', {headers: {Cookie: auth.cookie}, signal: AbortSignal.timeout(5000)}), reader = events.body.getReader();
  assert.doesNotMatch(new TextDecoder().decode((await reader.read()).value), /"membersOnly":true/);
  const update = await h.request('/api/admin/users/update', {id: auth.body.user.id, status: 'disabled', recommendations: false}, admin); assert.equal(update.status, 200);
  h.app.ingest(fixture(h.now()));
  let revoked = ''; while (!revoked.includes('"membersOnly":true')) revoked += new TextDecoder().decode((await reader.read()).value);
  await reader.cancel(); assert.match(revoked, /"membersOnly":true/);
  assert.equal((await h.request('/api/signals', undefined, auth)).status, 401);
  assert.equal((await h.login('member@example.test')).status, 401);
  assert.equal((await h.request('/api/admin/users/update', {id: admin.body.user.id, status: 'disabled', recommendations: false}, admin)).status, 403);
  const audit = (await h.request('/api/admin/audit', undefined, admin)).body.events; assert.ok(audit.some(x => x.event === 'USER_UPDATED'));
  await h.request('/api/admin/users/update', {id: auth.body.user.id, status: 'active', recommendations: false}, admin);
  const restricted = await h.login('member@example.test'); assert.equal(restricted.status, 200); assert.equal((await h.request('/api/signals', undefined, restricted)).status, 401);
  const filtered = await h.request('/api/admin/users?status=active&search=member%40example.test', undefined, admin); assert.equal(filtered.body.users.length, 1);
});

test('deletion requests end sessions without letting users disable the site owner', async t => {
  const h = await setup(t), admin = await h.owner(); await h.verify('delete@example.test'); const auth = await h.login('delete@example.test');
  assert.equal((await h.request('/api/auth/delete-request', {password: PASSWORD}, auth)).status, 200);
  assert.equal((await h.request('/api/auth/me', undefined, auth)).body.user, null);
  assert.equal((await h.request('/api/admin/users?status=deletion_requested', undefined, admin)).body.users.length, 1);
  assert.equal((await h.request('/api/auth/delete-request', {password: PASSWORD}, admin)).status, 409);
});

test('encrypted external backups restore atomically, reject tampering and invalidate sessions', async t => {
  const h = await setup(t), admin = await h.owner(); await h.verify('backup@example.test'); const member = await h.login('backup@example.test');
  assert.equal(typeof await exportAuthBackup(h.store, h.backup.key, h.now), 'string');
  const exported = await h.request('/api/admin/backup/download', {password: PASSWORD}, admin); assert.equal(exported.status, 200, h.errors.map(e => e.stack).join('\n'));
  assert.equal(exported.body.backup.includes('backup@example.test'), false); assert.equal(exported.body.backup.includes('scrypt'), false);
  const restore = {backup: exported.body.backup, password: PASSWORD, confirm: 'RESTORE'};
  assert.equal((await h.request('/api/admin/restore', {...restore, backup: restore.backup.slice(0, -2) + 'AA', code: '000000'}, admin)).status, 400);
  await h.request('/api/admin/users/update', {id: member.body.user.id, status: 'disabled', recommendations: false}, admin);
  h.advance(31); restore.code = totp(admin.secret, Math.floor(h.now() / 30));
  const destination = h.backup.storage; h.backup.storage = async () => {throw Error('test destination offline');};
  assert.equal((await h.request('/api/admin/restore', restore, admin)).status, 503);
  assert.equal((await h.store.query('SELECT status FROM nabd_users WHERE id=?', [member.body.user.id])).rows[0].status, 'disabled');
  assert.ok((await h.request('/api/auth/me', undefined, admin)).body.user);
  h.backup.storage = destination; h.advance(31); restore.code = totp(admin.secret, Math.floor(h.now() / 30));
  assert.equal((await h.request('/api/admin/restore', restore, admin)).status, 200); assert.ok(h.copies.length >= 2);
  assert.equal((await h.request('/api/auth/me', undefined, admin)).body.user, null);
  assert.equal((await h.login('backup@example.test')).status, 200);
});

test('verification and sessions expire, while repeated recovery requests are limited', async t => {
  const h = await setup(t), token = await h.register('expired@example.test'); h.advance(86401);
  assert.equal((await h.request('/api/auth/verify', {token, password: PASSWORD})).status, 400);
  await h.verify('active@example.test'); const auth = await h.login('active@example.test'); h.advance(604801);
  assert.equal((await h.request('/api/auth/me', undefined, auth)).body.user, null);
  for (let i = 0; i < 4; i++) assert.equal((await h.request('/api/auth/forgot', {email: 'missing@example.test'})).status, 202);
  assert.equal((await h.request('/api/auth/forgot', {email: 'missing@example.test'})).status, 429);
});

test('verification mail uses an HTTPS site link, keeps its token out of query strings and reports failures', async () => {
  let sent;
  const mail = createAuthMailer({apiKey: 'test-only-key', from: 'test@example.test', publicBase: 'https://nabd.example', fetcher: async (url, options) => {sent = {url, options}; return new Response('{}');}});
  await mail({email: 'member@example.test', token: 'test-only-token', kind: 'verify'});
  assert.equal(sent.url, 'https://api.resend.com/emails'); const body = JSON.parse(sent.options.body);
  assert.deepEqual(body.to, ['member@example.test']); assert.match(body.text, /https:\/\/nabd.example\/auth#verify=test-only-token/); assert.doesNotMatch(body.text, /\?token=/);
  const brevo = createAuthMailer({provider: 'brevo', apiKey: 'test-brevo-key', from: 'NABD <test@example.test>', publicBase: 'https://nabd.example', fetcher: async (url, options) => {sent = {url, options}; return new Response('{}');}});
  await brevo({email: 'member@example.test', token: 'test-token', kind: 'reset'});
  assert.equal(sent.url, 'https://api.brevo.com/v3/smtp/email'); assert.equal(sent.options.headers['api-key'], 'test-brevo-key');
  const brevoBody = JSON.parse(sent.options.body); assert.deepEqual(brevoBody.sender, {name: 'NABD', email: 'test@example.test'});
  assert.match(brevoBody.textContent, /\/auth#reset=test-token/);
  const broken = createAuthMailer({apiKey: 'test-key', from: 'test@example.test', publicBase: 'https://nabd.example', fetcher: async () => new Response('{}', {status: 500})});
  await assert.rejects(broken({email: 'member@example.test', token: 'test-token', kind: 'reset'}), /unavailable/);
});

test('password hashing and TOTP match security properties and the RFC 6238 test vector', async () => {
  const hash = await hashPassword(PASSWORD); assert.ok(await checkPassword(PASSWORD, hash)); assert.equal(await checkPassword('wrong', hash), false);
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; assert.equal(totp(secret, 1), '287082');
  assert.equal(totpStep(secret, '287082', 59), 1); assert.equal(totpStep(secret, '287082', 59, 1), null);
  const key = randomBytes(32), value = encrypt('sensitive', key); assert.equal(decrypt(value, key), 'sensitive'); assert.throws(() => decrypt(value, randomBytes(32)));
});

test('S3-compatible backups require HTTPS, sign the payload and report destination failures', async () => {
  let request; const put = backupStorage({endpoint: 'https://storage.example', bucket: 'nabd', region: 'auto', accessKey: 'test-key', secretKey: 'test-secret', fetcher: async (url, options) => {request = {url, options}; return new Response('', {status: 200});}});
  await put('nabd-accounts/one.enc', 'ciphertext'); assert.equal(request.url.pathname, '/nabd/nabd-accounts/one.enc');
  assert.match(request.options.headers.Authorization, /AWS4-HMAC-SHA256/); assert.match(request.options.headers.Authorization, /SignedHeaders=host;x-amz-content-sha256;x-amz-date/);
  assert.equal(request.options.body, 'ciphertext'); assert.throws(() => backupStorage({endpoint: 'http://storage.example', bucket: 'n', accessKey: 'a', secretKey: 'b'}));
});
