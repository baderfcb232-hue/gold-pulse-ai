import {randomBytes, scrypt, timingSafeEqual, createHash, createHmac, createCipheriv, createDecipheriv} from 'node:crypto';
import {promisify} from 'node:util';
const derive = promisify(scrypt), alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const opaque = () => randomBytes(32).toString('base64url');
export const digest = value => createHash('sha256').update(String(value)).digest('hex');
export const equal = (left, right) => typeof left === 'string' && typeof right === 'string' && timingSafeEqual(Buffer.from(digest(left)), Buffer.from(digest(right)));
export const keyed = (key, value) => createHmac('sha256', key).update(value).digest('base64url');
export function parseKey(value) {try {const key = Buffer.from(value || '', 'base64'); return key.length === 32 ? key : null;} catch {return null;}}
export function encrypt(value, key) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}
export function decrypt(value, key) {
  const raw = Buffer.from(value, 'base64url');
  if (raw.length < 28) throw Error('Invalid encrypted record');
  const cipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12)); cipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([cipher.update(raw.subarray(28)), cipher.final()]).toString('utf8');
}
let pending = 0, passwordQueue = Promise.resolve();
async function passwordWork(run) {
  if (pending >= 8) throw Object.assign(Error('محاولات كثيرة؛ حاول بعد قليل.'), {status: 429});
  pending++; const before = passwordQueue; let release; passwordQueue = new Promise(done => {release = done;}); await before;
  try {return await run();} finally {pending--; release();}
}
export async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return passwordWork(async () => 'scrypt$' + salt + '$' + (await derive(password, salt, 64, {N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024})).toString('hex'));
}
const dummy = 'scrypt$00000000000000000000000000000000$' + '0'.repeat(128);
export async function checkPassword(password, stored) {
  const value = typeof stored === 'string' && /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(stored) ? stored : dummy;
  const [, salt] = value.split('$'); return equal(await hashPassword(password, salt), value);
}
export function base32(bytes) {
  let bits = 0, count = 0, output = '';
  for (const byte of bytes) {bits = (bits << 8) | byte; count += 8; while (count >= 5) {count -= 5; output += alphabet[(bits >>> count) & 31];}}
  if (count) output += alphabet[(bits << (5 - count)) & 31]; return output;
}
function decode32(value) {
  let bits = 0, count = 0; const bytes = [];
  for (const char of value) {const digit = alphabet.indexOf(char); if (digit < 0) throw Error('Invalid MFA secret'); bits = (bits << 5) | digit; count += 5; if (count >= 8) {count -= 8; bytes.push((bits >>> count) & 255);}}
  return Buffer.from(bytes);
}
export const newTotpSecret = () => base32(randomBytes(20));
export function totp(secret, step) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const bytes = createHmac('sha1', decode32(secret)).update(counter).digest(), offset = bytes[19] & 15;
  return String((bytes.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
export function totpStep(secret, code, now, lastStep = -1) {
  if (!/^\d{6}$/.test(code || '')) return null;
  const step = Math.floor(now / 30);
  for (const test of [step, step - 1, step + 1]) if (test > Number(lastStep) && equal(totp(secret, test), code)) return test;
  return null;
}
