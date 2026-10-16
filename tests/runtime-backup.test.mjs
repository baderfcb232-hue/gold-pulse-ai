import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createRuntimeBackup} from '../runtime-backup.mjs';

test('checkpoint survives runtime deletion and an older deployment cannot overwrite it', async () => {
  let row = {};
  const pool = () => ({async query(sql, values = []) {
    if (sql.startsWith('CREATE')) return {};
    if (sql.startsWith('INSERT')) {row.generation = values[0]; return {rows: [{...row}]};}
    if (values[2] !== row.generation) return {rows: []};
    Object.assign(row, {payload: values[0], digest: values[1], saved_at: new Date()});
    return {rows: [{saved_at: row.saved_at}]};
  }, async end() {}});
  const first = await mkdtemp(join(tmpdir(), 'nabd-old-'));
  const second = await mkdtemp(join(tmpdir(), 'nabd-new-'));
  let oldDb, newDb;
  try {
    const old = await createRuntimeBackup({pool: pool(), dataDir: first});
    oldDb = new DatabaseSync(join(first, 'nabd.sqlite'));
    oldDb.exec("PRAGMA journal_mode=WAL; CREATE TABLE history(value text); INSERT INTO history VALUES('retained');");
    old.start(oldDb);
    while(old.status().state==='PENDING')await new Promise(r=>setTimeout(r,5));
    assert.equal(old.status().state, 'SAVED');
    const newer = await createRuntimeBackup({pool: pool(), dataDir: second});
    newDb = new DatabaseSync(join(second, 'nabd.sqlite'));
    assert.equal(newDb.prepare('SELECT value FROM history').get().value, 'retained');
    newer.start(newDb); await newer.close();
    oldDb.exec("INSERT INTO history VALUES('obsolete');");
    await old.close();
    assert.equal(old.status().state,'SUPERSEDED');
    const verify=new DatabaseSync(join(second,'nabd.sqlite'));
    assert.equal(verify.prepare('SELECT count(*) AS n FROM history').get().n,1);verify.close();
    // Checksum corruption must fail closed instead of starting with empty history.
    row.digest = 'invalid';
    await assert.rejects(createRuntimeBackup({pool: pool(), dataDir: second}), /recovery failed/);
  } finally {oldDb?.close(); newDb?.close(); await rm(first, {recursive: true, force: true}); await rm(second, {recursive: true, force: true});}
});
