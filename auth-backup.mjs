import {createHash, createHmac} from 'node:crypto';
import {encrypt, decrypt, parseKey} from './auth-crypto.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const mac = (key, value, encoding) => createHmac('sha256', key).update(value).digest(encoding);
export function backupStorage({endpoint, bucket, accessKey, secretKey, region = 'auto', fetcher = fetch}) {
  if (!endpoint || !bucket || !accessKey || !secretKey) return null;
  const root = new URL(endpoint); if (root.protocol !== 'https:' || root.username || root.password) throw Error('HTTPS backup endpoint required');
  return async (name, content) => {
    const url = new URL(root); url.pathname = root.pathname.replace(/\/$/, '') + '/' + [bucket, ...name.split('/')].map(encodeURIComponent).join('/');
    const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''), day = date.slice(0, 8), hash = sha(content);
    const signed = 'host;x-amz-content-sha256;x-amz-date';
    const canonical = ['PUT', url.pathname, '', `host:${url.host}\nx-amz-content-sha256:${hash}\nx-amz-date:${date}\n`, signed, hash].join('\n');
    const scope = `${day}/${region}/s3/aws4_request`, message = `AWS4-HMAC-SHA256\n${date}\n${scope}\n${sha(canonical)}`;
    const key = mac(mac(mac(mac('AWS4' + secretKey, day), region), 's3'), 'aws4_request');
    const response = await fetcher(url, {method: 'PUT', body: content, signal: AbortSignal.timeout(20000),
      headers: {'x-amz-date': date, 'x-amz-content-sha256': hash,
        Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signed}, Signature=${mac(key, message, 'hex')}`}});
    if (!response.ok) throw Error('Backup destination unavailable');
  };
}
export const backupTables = ['nabd_users', 'nabd_auth_audit', 'nabd_auth_settings'];
export async function exportAuthBackup(store, key, clock) {
  if (!key) throw Object.assign(Error('مفتاح النسخ الاحتياطي غير مضبوط.'), {status: 503});
  return store.transaction(async query => {
    const tables = {};
    for (const name of backupTables) tables[name] = (await query(`SELECT * FROM ${name}`)).rows;
    // Sessions, reset links and rate counters are intentionally never restored.
    return encrypt(JSON.stringify({version: 1, created_at: clock(), tables}), key);
  });
}
export function readAuthBackup(value, key) {
  const data = JSON.parse(decrypt(value, key));
  if (data.version !== 1 || !data.tables || !backupTables.every(name => Array.isArray(data.tables[name]))) throw Error('Invalid backup');
  return data;
}
export function backupConfig(env) {
  return {key: parseKey(env.AUTH_BACKUP_KEY), storage: backupStorage({endpoint: env.AUTH_BACKUP_ENDPOINT,
    bucket: env.AUTH_BACKUP_BUCKET, accessKey: env.AUTH_BACKUP_ACCESS_KEY, secretKey: env.AUTH_BACKUP_SECRET_KEY,
    region: env.AUTH_BACKUP_REGION || 'auto'})};
}
