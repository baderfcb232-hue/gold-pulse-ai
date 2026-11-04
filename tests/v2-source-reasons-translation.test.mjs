import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dashboardStaticEnglish} from '../public/dashboard-static-en.js';
import {accountStaticEnglish} from '../public/account-static-en.js';
import {attributeStaticEnglish} from '../public/attribute-static-en.js';
import {runtimeStatusEnglish} from '../public/runtime-status-en.js';
import {liveStatusEnglish} from '../public/live-status-en.js';
import {appExtraEnglish} from '../public/app-extra-en.js';
import {safetyStatusEnglish} from '../public/safety-status-en.js';
import {serverStatusEnglish} from '../public/server-status-en.js';
import {translations} from '../public/i18n-core.js';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const reviewed=Object.freeze({...Object.fromEntries(Object.keys(translations.ar).map(k=>[translations.ar[k],translations.en[k]])),
  ...dashboardStaticEnglish,...accountStaticEnglish,...attributeStaticEnglish,
  ...runtimeStatusEnglish,...liveStatusEnglish,...appExtraEnglish,...safetyStatusEnglish,...serverStatusEnglish});

test('all reviewed EA risk/news/connection server messages have exact English source vocabulary',()=>{
  const paths=['engine.mjs','market.mjs','news.mjs','broker-market.mjs','server.mjs',
    'public/command-feedback.js','public/control-readiness.js','public/http.js',
    'public/mini-spark.js','public/state-connection.js','public/toast-ui.js'];
  const suffixes=new Set([': توقف وصول بيانات جسر MT5 لأكثر من دقيقة. حالة الأصل الآخر مستقلة.',
    ': جسر MT5 متصل لكن نبض البوت قديم أو غير متاح؛ أوامر التحكم معلّقة لهذا الأصل.']);
  for(const path of paths){
    const phrases=[...new Set([...read(path).matchAll(/'([^'\n]*[\u0600-\u06FF][^'\n]*)'|"([^"\n]*[\u0600-\u06FF][^"\n]*)"/g)]
      .map(x=>x[1]||x[2]).filter(x=>x.length<230&&!/[{}=;]/.test(x)&&x.trim()===x))];
    const missing=phrases.filter(v=>!Object.hasOwn(reviewed,v)&&!suffixes.has(v));
    assert.deepEqual(missing,[],path+' has unknown Arabic code-generated status labels');
  }
});

test('translated safety source cannot silently turn unconfirmed execution into a confirmed fill',()=>{
  assert.match(reviewed['وصلت للجسر — لم يصل تأكيد MT5'],/not confirmed/);
  assert.match(reviewed['سجل إرسال الصفقات الدائم غير متاح؛ لا نرسل أمرًا قد يتكرر.'],/no order will be sent/i);
  assert.match(reviewed['تعذّر الدخول: أقل لوت عند البروكر يتجاوز سقف مخاطرة حسابك. يُحسب الحجم تلقائيًا؛ ننتظر فرصة تناسب الحساب.'],/Entry blocked/);
  assert.match(reviewed['ننتظر توصية تصدر بعد تشغيل وضع الموقع؛ لن ندخل توصية سابقة.'],/earlier signal will not be traded/);
});
