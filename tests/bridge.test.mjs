import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {createApplication} from '../server.mjs';
import {eaFixture, NOW} from './fixtures.mjs';

// Exercise the actual calendar JSON expressions, with documented MQL5 casts.
// MQL5's (string)datetime formats a date; (string)(long)datetime emits seconds.
// This focused adapter is not a MetaEditor compiler or a terminal integration test.
class MqlDatetime {
  constructor(seconds) { this.seconds = seconds; }
  valueOf() { return this.seconds; }
  toString() {
    return new Date(this.seconds * 1000).toISOString().slice(0, 19).replaceAll('-', '.').replace('T', ' ');
  }
}

function calendarWire({unavailable = false, complete = true, events = []} = {}) {
  const source = readFileSync(new URL('../mt5/NABD_Bridge.mqh', import.meta.url), 'utf8');
  const fn = source.slice(source.indexOf('void NBUpdateCalendar('), source.indexOf('string NBPositions('));
  const assignments = [...fn.matchAll(/g_nb_calendar\s*=\s*([^;]+);/g)];
  assert.equal(assignments.length, 2, 'both calendar response paths must be exercised');
  const expression = assignments[unavailable ? 0 : 1][1]
    .replace(/\(string\)\s*\(\s*\(long\)\s*now\s*\)/g, 'String(Number(now))')
    .replace(/\(string\)\s*now\b/g, 'String(now)');
  return runInNewContext(expression, {
    now: new MqlDatetime(NOW), complete, NBQ: JSON.stringify,
    json: JSON.stringify(events).slice(0, -1),
  }, {timeout: 100});
}

test('MT5 calendar wire JSON uses numeric UTC seconds for unavailable, empty and populated calendars', () => {
  const event = {id: 'test-news', name: 'USD "Jobs"\nبيانات العمل', currency: 'USD',
    time: NOW + 3600, importance: 3, actual: null, forecast: 1.2, previous: -0.1, unit: '%'};
  for (const options of [{unavailable: true}, {}, {events: [event]}, {complete: false, events: [event]}]) {
    const calendar = JSON.parse(calendarWire(options));
    assert.equal(calendar.updated_at, NOW);
    assert.ok(Number.isInteger(calendar.updated_at));
    assert.equal(calendar.status, options.unavailable || options.complete === false ? 'unavailable' : 'ok');
    assert.deepEqual(calendar.events, options.unavailable ? [] : options.events || []);
  }
});

test('full bridge updates reach the local API after bootstrap even when the calendar is unavailable', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'nabd-calendar-wire-'));
  const ingest = 'wire-test-ingest-xxxxxxxxxxxxxxxxxxxxxxxx';
  const app = createApplication({dataDir: dir, clock: () => NOW, ingestToken: ingest});
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); rmSync(dir, {recursive: true, force: true}); });
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const raw = eaFixture();
  raw.execution.enabled = false; raw.execution.remote_control = false;
  raw.ea.signal = null; delete raw.account; delete raw.positions; delete raw.deals;
  for (const options of [{unavailable: true}, {}]) {
    const prefix = JSON.stringify({...raw, calendar: undefined}).slice(0, -1);
    const body = prefix + ',"calendar":' + calendarWire(options) + '}';
    const response = await fetch(base + '/api/mt5', {method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + ingest}, body});
    assert.equal(response.status, 200, await response.text());
    const state = await (await fetch(base + '/api/state')).json();
    assert.equal(state.connection, 'LIVE');
    assert.equal(state.timeframes.M5.count, raw.candles.M5.length);
    assert.equal(state.calendar.updated_at, NOW);
    assert.equal(state.execution.enabled, false);
    assert.equal(state.currentSignal, null);
  }
});
