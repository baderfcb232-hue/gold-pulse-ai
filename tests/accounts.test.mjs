import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../server.mjs';
import {sqliteAuthStore} from '../auth-store.mjs';
import {totp, totpStep, encrypt, decrypt, hashPassword, checkPassword} from '../auth-crypto.mjs';
import {backupStorage, exportAuthBackup, readAuthBackup} from '../auth-backup.mjs';
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
  assert.equal((await h.request('/api/auth/mt5-accounts', {broker:'JustMarkets',server:'JustMarkets-Demo2',login:'87654321',environment:'demo',acknowledge:true},member)).status,201);
  assert.equal(typeof await exportAuthBackup(h.store, h.backup.key, h.now), 'string');
  const exported = await h.request('/api/admin/backup/download', {password: PASSWORD}, admin); assert.equal(exported.status, 200, h.errors.map(e => e.stack).join('\n'));
  assert.equal(exported.body.backup.includes('backup@example.test'), false); assert.equal(exported.body.backup.includes('scrypt'), false);
  assert.equal(exported.body.backup.includes('87654321'), false);
  assert.equal(readAuthBackup(exported.body.backup,h.backup.key).tables.nabd_member_mt5_accounts.length,1);
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
  assert.equal((await h.store.query('SELECT login FROM nabd_member_mt5_accounts')).rows[0].login,'87654321');
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

test('accounts health check fails closed and recovers without losing logins after database outage', async t => {
  const h=await setup(t);
  const original=h.store.query.bind(h.store);
  let offline=false;
  h.store.query=async (...args)=> {if(offline) throw new Error('SIMULATED_DATABASE_OUTAGE'); return original(...args);};
  const initial=await h.request('/api/auth/status'); assert.equal(initial.body.ready,true);
  offline=true;
  const down=await h.request('/api/auth/status');
  assert.equal(down.body.ready,false); assert.equal(down.body.database,'UNAVAILABLE');
  assert.equal((await h.request('/api/auth/login',{email:'member@example.test',password:PASSWORD})).status,503);
  offline=false;
  const restored=await h.request('/api/auth/status');
  assert.equal(restored.body.ready,true);assert.equal(restored.body.database,'CONNECTED');
});

test('MT5 Demo registration is owner-scoped, CSRF protected, and never grants trading privileges', async t => {
  const h = await setup(t);
  await h.verify('mt5-one@example.test'); await h.verify('mt5-two@example.test');
  const one = await h.login('mt5-one@example.test'), two = await h.login('mt5-two@example.test');
  const path = '/api/auth/mt5-accounts', details = {
    broker: 'JustMarkets', server: 'JustMarkets-Demo2', login: '12345678',
    environment: 'demo', acknowledge: true
  };
  assert.equal((await h.request(path)).status, 401);
  assert.equal((await h.request(path, details)).status, 401);
  assert.equal((await h.request(path, details, one, {'X-NABD-CSRF': ''})).status, 403);
  assert.equal((await h.request(path, details, one, {Origin:'https://untrusted.example'})).status, 403);
  assert.equal((await h.request(path, {...details, password:'broker-secret'}, one)).status, 400);
  assert.equal((await h.request(path, {...details, environment:'real'}, one)).status, 400);
  assert.equal((await h.request(path, {...details, server:'JustMarkets-Live'}, one)).status, 400);
  assert.equal((await h.request(path, {...details, login:12345678}, one)).status, 400);
  assert.equal((await h.request(path, {...details, acknowledge:false}, one)).status, 400);
  const created = await h.request(path, details, one);
  assert.equal(created.status, 201, h.errors.map(e => e.stack).join('\n'));
  assert.equal(created.body.status, 'PENDING_SETUP');
  assert.equal(created.body.connectionEnabled, false);
  assert.equal(created.body.tradingEnabled, false);
  const mine = await h.request(path, undefined, one);
  assert.equal(mine.body.accounts.length, 1);
  assert.equal(mine.body.accounts[0].login, details.login);
  assert.equal(mine.body.accounts[0].status, 'PENDING_SETUP');
  assert.equal('user_id' in mine.body.accounts[0], false);
  assert.equal('password' in mine.body.accounts[0], false);
  const others = await h.request(path, undefined, two);
  assert.deepEqual(others.body.accounts, []);
  assert.equal((await h.request(path, details, two)).status, 409);
  assert.equal((await h.request(path, {...details, login:'34567890'}, one)).status, 409);
  const twoCreated = await h.request(path, {...details, login:'34567890'}, two);
  assert.equal(twoCreated.status, 201);
  assert.equal((await h.request(path + '/remove', {id: twoCreated.body.id}, one)).status, 404);
  assert.equal((await h.request(path + '/remove', {id: created.body.id}, two)).status, 404);
  assert.equal((await h.request(path + '/remove', {id: created.body.id}, one, {'X-NABD-CSRF':''})).status, 403);
  assert.equal((await h.request(path, undefined, one)).body.accounts.length, 1);
  assert.equal((await h.request(path + '/remove', {id:created.body.id}, one)).status, 200);
  assert.deepEqual((await h.request(path, undefined, one)).body.accounts, []);
  assert.equal((await h.request(path, undefined, two)).body.accounts.length, 1);
  assert.equal((await h.request(path + '/remove', {id:created.body.id}, one)).status, 404);
  assert.equal((await h.request('/api/account', undefined, one)).status, 401);
  assert.equal((await h.request('/api/commands', {action:'RESUME'}, one)).status, 401);
  assert.equal((await h.request('/api/bridge/next', undefined, one)).status, 401);
  const schema = await h.store.query('PRAGMA table_info(nabd_member_mt5_accounts)');
  assert.equal(schema.rows.some(column => /password|secret|token/i.test(column.name)), false);
  const html = await fetch(h.base + '/account').then(response => response.text());
  assert.match(html, /member-mt5-form/);
  assert.match(html, /الموافقة الإدارية لا تعني ربط MT5 أو بدء التداول/);
});

test('old encrypted identity backups remain readable without MT5 registrations', async t => {
  const h = await setup(t);
  const tables = {};
  for (const name of ['nabd_users', 'nabd_auth_audit', 'nabd_auth_settings'])
    tables[name] = (await h.store.query('SELECT * FROM ' + name)).rows;
  const oldArchive = encrypt(JSON.stringify({version:1,created_at:h.now(),tables}),h.backup.key);
  const recovered = readAuthBackup(oldArchive,h.backup.key);
  assert.deepEqual(recovered.tables.nabd_member_mt5_accounts,[]);
  assert.equal(recovered.version,1);
});

test('central hosting requests are opt-in, tenant-isolated, and require MFA admin review', async t => {
  const h = await setup(t);
  await h.verify('hosting-a@example.test');
  await h.verify('hosting-b@example.test');
  const a = await h.login('hosting-a@example.test'), b = await h.login('hosting-b@example.test');
  const admin = await h.owner();
  const spec = {broker:'JustMarkets',server:'JustMarkets-Demo2',environment:'demo',acknowledge:true};
  const aRegistered = await h.request('/api/auth/mt5-accounts',{...spec,login:'12345678'},a);
  const bRegistered = await h.request('/api/auth/mt5-accounts',{...spec,login:'98765432'},b);
  assert.equal(aRegistered.status,201);
  assert.equal(bRegistered.status,201);
  const path='/api/auth/mt5-hosting/request';
  assert.equal((await h.request(path,{id:aRegistered.body.id,consent:true})).status,401);
  assert.equal((await h.request(path,{id:bRegistered.body.id,consent:true},a)).status,404);
  assert.equal((await h.request(path,{id:aRegistered.body.id,consent:false},a)).status,400);
  assert.equal((await h.request(path,{id:aRegistered.body.id,consent:true,password:'secret'},a)).status,400);
  assert.equal((await h.request(path,{id:aRegistered.body.id,consent:true},a,{'X-NABD-CSRF':''})).status,403);
  assert.equal((await h.request(path,{id:aRegistered.body.id,consent:true},a,{Origin:'https://evil.example'})).status,403);
  const request=await h.request(path,{id:aRegistered.body.id,consent:true},a);
  assert.equal(request.status,202,h.errors.map(e=>e.stack).join('\n'));
  assert.equal(request.body.tradingEnabled,false);
  assert.equal(request.body.connectionEnabled,false);
  assert.equal((await h.request(path,{id:aRegistered.body.id,consent:true},a)).status,409);
  const mine=await h.request('/api/auth/mt5-accounts',undefined,a);
  const someoneElse=await h.request('/api/auth/mt5-accounts',undefined,b);
  assert.equal(mine.body.accounts[0].hosting_status,'REQUESTED');
  assert.equal(someoneElse.body.accounts[0].hosting_status,'NOT_REQUESTED');
  assert.equal('member_email' in mine.body.accounts[0],false);
  assert.equal((await h.request('/api/admin/mt5-hosting',undefined,a)).status,403);
  assert.equal((await h.request('/api/admin/mt5-hosting/review',{id:aRegistered.body.id,decision:'APPROVE'},a)).status,403);
  const queue=await h.request('/api/admin/mt5-hosting',undefined,admin);
  assert.equal(queue.status,200);
  assert.equal(queue.body.accounts.length,1);
  assert.equal(queue.body.accounts[0].member_email,'hosting-a@example.test');
  assert.equal(queue.body.workerConnected,false);
  assert.equal(queue.body.tradingEnabled,false);
  const reviewPath='/api/admin/mt5-hosting/review';
  assert.equal((await h.request(reviewPath,{id:aRegistered.body.id,decision:'APPROVE'},admin,{'X-NABD-CSRF':''})).status,403);
  assert.equal((await h.request(reviewPath,{id:bRegistered.body.id,decision:'APPROVE'},admin)).status,409);
  assert.equal((await h.request(reviewPath,{id:aRegistered.body.id,decision:'APPROVE',trade:true},admin)).status,400);
  const approved=await h.request(reviewPath,{id:aRegistered.body.id,decision:'APPROVE'},admin);
  assert.equal(approved.status,200,h.errors.map(e=>e.stack).join('\n'));
  assert.equal(approved.body.tradingEnabled,false);
  assert.equal(approved.body.workerConnected,false);
  assert.equal((await h.request(reviewPath,{id:aRegistered.body.id,decision:'REJECT'},admin)).status,409);
  assert.equal((await h.request('/api/auth/mt5-accounts',undefined,a)).body.accounts[0].hosting_status,'APPROVED');
  assert.equal((await h.request('/api/account',undefined,a)).status,401);
  assert.equal((await h.request('/api/commands',{action:'RESUME'},a)).status,401);
  // Removing a member account cascades to its hosting request, without touching another user.
  assert.equal((await h.request('/api/auth/mt5-accounts/remove',{id:aRegistered.body.id},a)).status,200);
  assert.deepEqual((await h.request('/api/admin/mt5-hosting',undefined,admin)).body.accounts,[]);
  const audit=(await h.request('/api/admin/audit',undefined,admin)).body.events;
  assert.ok(audit.some(e=>e.event==='MT5_HOSTING_REQUESTED'));
  assert.ok(audit.some(e=>e.event==='MT5_HOSTING_APPROVED'));
});

test('rejected hosting requests can be resubmitted, but cannot be reviewed twice', async t => {
  const h=await setup(t);await h.verify('hosting-retry@example.test');
  const user=await h.login('hosting-retry@example.test'),admin=await h.owner();
  const created=await h.request('/api/auth/mt5-accounts',{
    broker:'JustMarkets',server:'JustMarkets-Demo',login:'44446666',environment:'demo',acknowledge:true
  },user);
  assert.equal(created.status,201);
  const path='/api/auth/mt5-hosting/request', id=created.body.id;
  assert.equal((await h.request(path,{id,consent:true},user)).status,202);
  assert.equal((await h.request('/api/admin/mt5-hosting/review',{id,decision:'REJECT'},admin)).status,200);
  assert.equal((await h.request('/api/auth/mt5-accounts',undefined,user)).body.accounts[0].hosting_status,'REJECTED');
  assert.equal((await h.request(path,{id,consent:true},user)).status,202);
  assert.equal((await h.request('/api/auth/mt5-accounts',undefined,user)).body.accounts[0].hosting_status,'REQUESTED');
  assert.equal((await h.request('/api/admin/mt5-hosting/review',{id,decision:'APPROVE'},admin)).status,200);
});

test('encrypted backups include central hosting requests and v2 archives still decode', async t => {
  const h=await setup(t);await h.verify('hosting-backup@example.test');
  const user=await h.login('hosting-backup@example.test');
  const registered=await h.request('/api/auth/mt5-accounts',{
    broker:'JustMarkets',server:'JustMarkets-Demo',login:'55557777',environment:'demo',acknowledge:true
  },user);
  await h.request('/api/auth/mt5-hosting/request',{id:registered.body.id,consent:true},user);
  const archive=await exportAuthBackup(h.store,h.backup.key,h.now);
  assert.equal(archive.includes('55557777'),false);
  const decoded=readAuthBackup(archive,h.backup.key);
  assert.equal(decoded.version,6);
  assert.equal(decoded.tables.nabd_mt5_hosting_requests.length,1);
  assert.deepEqual(decoded.tables.nabd_member_alert_preferences,[]);
  assert.deepEqual(decoded.tables.nabd_member_telegram,[]);
  const oldTables={};
  for(const name of ['nabd_users','nabd_auth_audit','nabd_auth_settings','nabd_member_mt5_accounts'])
    oldTables[name]=(await h.store.query('SELECT * FROM '+name)).rows;
  const v2=encrypt(JSON.stringify({version:2,created_at:h.now(),tables:oldTables}),h.backup.key);
  const oldDecoded=readAuthBackup(v2,h.backup.key);
  assert.equal(oldDecoded.version,2);
  assert.deepEqual(oldDecoded.tables.nabd_mt5_hosting_requests,[]);
});

test('Windows read-only worker is one-time provisioned and scoped to an approved Demo account', async t => {
  const h=await setup(t);
  await h.verify('worker-a@example.test');await h.verify('worker-b@example.test');
  const a=await h.login('worker-a@example.test'),b=await h.login('worker-b@example.test');
  const admin=await h.owner(),registration='/api/auth/mt5-accounts';
  const spec={broker:'JustMarkets',server:'JustMarkets-Demo',environment:'demo',acknowledge:true};
  const ar=await h.request(registration,{...spec,login:'13579135'},a);
  const br=await h.request(registration,{...spec,login:'24680246'},b);
  assert.equal(ar.status,201);assert.equal(br.status,201);
  const heartbeat='/api/worker/mt5-heartbeat';
  const basePacket={account_id:ar.body.id,broker:'JustMarkets',server:spec.server,login:'13579135',
    environment:'demo',terminal_connected:true,demo_mode:true};
  const raw=async (payload,token,origin)=>{
    const response=await fetch(h.base+heartbeat,{
      method:'POST',headers:{'Content-Type':'application/json',...(token?{'X-NABD-Worker-Token':token}:{}),
        ...(origin?{Origin:origin}:{})},
      body:JSON.stringify(payload)});
    return {status:response.status,body:await response.json()};
  };
  const provision='/api/admin/mt5-monitor/provision',issue={id:ar.body.id,confirm:'ISSUE_READONLY_TOKEN'};
  assert.equal((await h.request(provision,issue,a)).status,403);
  assert.equal((await h.request(provision,issue,admin,{'X-NABD-CSRF':''})).status,403);
  assert.equal((await h.request(provision,issue,admin)).status,409);
  await h.request('/api/auth/mt5-hosting/request',{id:ar.body.id,consent:true},a);
  assert.equal((await h.request(provision,issue,admin)).status,409);
  await h.request('/api/admin/mt5-hosting/review',{id:ar.body.id,decision:'APPROVE'},admin);
  const issued=await h.request(provision,issue,admin);
  assert.equal(issued.status,200,h.errors.map(e=>e.stack).join('\n'));
  const {token,worker_id}=issued.body;
  assert.match(token,/^[A-Za-z0-9_-]{43}$/);
  assert.match(worker_id,/^[a-f0-9-]{36}$/);
  assert.equal(issued.body.tradeAllowed,false);
  assert.equal(issued.body.monitoringOnly,true);
  const row=(await h.store.query('SELECT * FROM nabd_mt5_monitor_workers WHERE account_id=?',[ar.body.id])).rows[0];
  assert.notEqual(row.token_hash,token);
  assert.equal('secret' in row,false);
  const packet={...basePacket,worker_id};
  assert.equal((await raw(packet)).status,401);
  assert.equal((await raw(packet,token.slice(0,-1)+'Z')).status,401);
  assert.equal((await raw({...packet,account_id:br.body.id},token)).status,401);
  assert.equal((await raw({...packet,worker_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},token)).status,401);
  assert.equal((await raw({...packet,login:'24680246'},token)).status,409);
  assert.equal((await raw({...packet,environment:'real'},token)).status,400);
  assert.equal((await raw({...packet,demo_mode:false},token)).status,409);
  assert.equal((await raw({...packet,trade:true},token)).status,400);
  const ok=await raw(packet,token);
  assert.equal(ok.status,200,JSON.stringify(ok.body));
  assert.equal(ok.body.tradeAllowed,false);
  assert.equal(ok.body.observed,true);
  const self=(await h.request(registration,undefined,a)).body.accounts[0];
  assert.equal(self.monitoring_status,'OBSERVED_DEMO');
  assert.equal('worker_id' in self,false);assert.equal('token' in self,false);
  const other=(await h.request(registration,undefined,b)).body.accounts[0];
  assert.equal(other.monitoring_status,'NOT_APPROVED');
  assert.equal((await h.request('/api/account',undefined,a)).status,401);
  assert.equal((await h.request('/api/commands',{action:'RESUME'},a)).status,401);
  h.advance(46);
  assert.equal((await h.request(registration,undefined,a)).body.accounts[0].monitoring_status,'STALE');
  assert.equal((await raw({...packet,terminal_connected:false},token)).status,200);
  assert.equal((await h.request(registration,undefined,a)).body.accounts[0].monitoring_status,'MT5_OFFLINE');
  const rotated=await h.request(provision,issue,admin);
  assert.equal(rotated.status,200);
  assert.notEqual(rotated.body.token,token);
  assert.equal((await raw(packet,token)).status,401);
  assert.equal((await raw({...packet,worker_id:rotated.body.worker_id},rotated.body.token)).status,200);
  assert.equal((await h.request('/api/admin/mt5-monitor/revoke',{id:ar.body.id},a)).status,403);
  assert.equal((await h.request('/api/admin/mt5-monitor/revoke',{id:ar.body.id},admin)).status,200);
  assert.equal((await raw({...packet,worker_id:rotated.body.worker_id},rotated.body.token)).status,401);
  assert.equal((await h.request(registration,undefined,a)).body.accounts[0].monitoring_status,'NOT_ISSUED');
  const audit=(await h.request('/api/admin/audit',undefined,admin)).body.events;
  assert.ok(audit.some(e=>e.event==='MT5_MONITOR_TOKEN_ROTATED'));
  assert.ok(audit.some(e=>e.event==='MT5_MONITOR_REVOKED'));
});

test('Windows monitor cannot spoof a member account after access is disabled',async t=>{
  const h=await setup(t),admin=await h.owner();await h.verify('monitor-disabled@example.test');
  const member=await h.login('monitor-disabled@example.test');
  const r=await h.request('/api/auth/mt5-accounts',{broker:'JustMarkets',
    server:'JustMarkets-Demo',environment:'demo',login:'56473829',acknowledge:true},member);
  await h.request('/api/auth/mt5-hosting/request',{id:r.body.id,consent:true},member);
  await h.request('/api/admin/mt5-hosting/review',{id:r.body.id,decision:'APPROVE'},admin);
  const issued=await h.request('/api/admin/mt5-monitor/provision',
    {id:r.body.id,confirm:'ISSUE_READONLY_TOKEN'},admin);
  assert.equal(issued.status,200);
  await h.request('/api/admin/users/update',{id:member.body.user.id,status:'disabled',recommendations:false},admin);
  const packet={account_id:r.body.id,worker_id:issued.body.worker_id,broker:'JustMarkets',
    server:'JustMarkets-Demo',login:'56473829',environment:'demo',
    terminal_connected:true,demo_mode:true};
  const response=await fetch(h.base+'/api/worker/mt5-heartbeat',
    {method:'POST',headers:{'Content-Type':'application/json','X-NABD-Worker-Token':issued.body.token},
      body:JSON.stringify(packet)});
  assert.equal(response.status,401);
  assert.equal((await h.request('/api/admin/mt5-hosting',undefined,admin)).body.accounts[0].monitoring_status,'AWAITING_WORKER');
});

test('stage-only stop request HTTP is owner-scoped, CSRF-guarded and never claims MT5 stopped', async t => {
 const h=await setup(t);
 await h.verify('stop-one@example.test');
 await h.verify('stop-two@example.test');
 const owner=await h.login('stop-one@example.test'),other=await h.login('stop-two@example.test');
 const reg=await h.request('/api/auth/mt5-accounts',{broker:'JustMarkets',server:'JustMarkets-Demo2',login:'23456789',environment:'demo',acknowledge:true},owner);
 assert.equal(reg.status,201);
 const path='/api/auth/risk-stop-requests';
 const request={accountId:reg.body.id,symbol:'BTCUSD',acknowledgeUnconfirmed:true};
 assert.equal((await h.request(path,request)).status,401);
 assert.equal((await h.request(path,request,owner,{'X-NABD-CSRF':''})).status,403);
 assert.equal((await h.request(path,request,owner,{Origin:'https://example.attacker'})).status,403);
 assert.equal((await h.request(path,request,other)).status,404);
 assert.equal((await h.request(path,{...request,acknowledgeUnconfirmed:false},owner)).status,400);
 const created=await h.request(path,request,owner);
 assert.equal(created.status,202);
 assert.equal(created.body.status,'AWAITING_MT5_ACK');
 assert.equal(created.body.confirmedByMT5,false);
 assert.equal(created.body.executionStopped,false);
 const repeated=await h.request(path,request,owner);
 assert.equal(repeated.status,202);
 assert.equal(repeated.body.created,false);
 assert.equal(repeated.body.requestId,created.body.requestId);
 const mine=await h.request(path,undefined,owner);
 assert.equal(mine.status,200);
 assert.equal(mine.body.requests.length,1);
 assert.equal(mine.body.connectedToMT5,false);
 assert.equal((await h.request(path,undefined,other)).body.requests.length,0);
});
