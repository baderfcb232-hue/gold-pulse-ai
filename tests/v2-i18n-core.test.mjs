import test from 'node:test';
import assert from 'node:assert/strict';
import {translations,t,localeOf,layoutFor,rejectionText,REJECTION_CODES} from '../public/i18n-core.js';

test('Arabic and English share the same translation keys',()=>{
  const ar=Object.keys(translations.ar).sort(),en=Object.keys(translations.en).sort();
  assert.ok(ar.length>=80);
  assert.deepEqual(en,ar);
  for(const value of Object.values(translations.en)){
    assert.equal(typeof value,'string');
    assert.ok(value.length>0);
    assert.doesNotMatch(value,/[\u0600-\u06FF]/,'English locale must never display untranslated Arabic');
  }
});
test('LTR/RTL layout is explicit, language selection has safe defaults',()=>{
  assert.deepEqual(layoutFor('en'),{lang:'en',dir:'ltr'});
  assert.deepEqual(layoutFor('ar'),{lang:'ar',dir:'rtl'});
  assert.deepEqual(layoutFor('unexpected'),{lang:'ar',dir:'rtl'});
  assert.equal(localeOf('en'),'en');
  assert.equal(t('market.ask','en'),'Buy Ask');
  assert.equal(t('signal.confirmed','en'),'MT5 confirmed execution');
  assert.equal(t('trade.orderSubmitted','en'),'MT5 request sent; execution unconfirmed');
  assert.throws(()=>t('invented-key','en'),/Missing NABD translation key/);
});
test('MT5 rejection translations use source reason codes rather than inventing fills',()=>{
  assert.ok(Object.keys(REJECTION_CODES).length>=12);
  assert.match(rejectionText(125,'en'),/minimum distance/);
  assert.match(rejectionText(128,'en'),/risk limit/);
  assert.match(rejectionText(121,'en'),/rejected/);
  assert.equal(rejectionText(999,'en'),'Order rejected');
  for(const code of Object.keys(REJECTION_CODES))assert.doesNotMatch(rejectionText(code,'en'),/[\u0600-\u06FF]/);
});

import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../server.mjs';

test('shared translation module loads on dashboard and protects trading/API routes',async t=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const locale=readFileSync(new URL('../public/dashboard-locale.js',import.meta.url),'utf8');
  assert.match(html,/dashboard-locale\.js\?v=v2-i18n-5" type="module"/);
  assert.match(locale,/import \{t,layoutFor\} from '\/i18n-core\.js'/);
  assert.match(locale,/t\('lang\.ar',lang\)/);
  const dir=mkdtempSync(join(tmpdir(),'nabd-i18n-core-'));
  const app=createApplication({dataDir:dir});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+app.server.address().port;
  const response=await fetch(base+'/i18n-core.js');
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/text\/javascript/);
  assert.match(await response.text(),/SUPPORTED_LOCALES/);
  assert.equal((await fetch(base+'/api/account')).status,401);
  assert.equal((await (await fetch(base+'/healthz')).json()).ok,true);
});
