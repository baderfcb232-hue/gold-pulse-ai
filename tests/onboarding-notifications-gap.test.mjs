import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');

test('original prompt phase 11 includes a usable account-notification step',()=>{
 const html=read('public/onboarding.html'),js=read('public/onboarding.js');
 assert.match(html,/id="onboarding-alerts-form"/);
 assert.match(html,/name="notifications"/);
 assert.match(html,/id="onboarding-alerts-feedback"/);
 assert.match(js,/write\('\/api\/auth\/profile',\{name:user\.name,notifications\},button\)/);
 assert.match(js,/onboarding-alerts'\)\.hidden=!user/);
 assert.match(js,/user\.notifications/);
 assert.match(js,/alertsSaved/);
 assert.match(js,/alertsTelegram/);
});
test('onboarding never claims per-member Telegram connection or execution rights',()=>{
 const html=read('public/onboarding.html');
 const js=read('public/onboarding.js');
 assert.match(html,/لا تتوفر هنا بعد خدمة ربط Telegram خاص بكل مشترك/);
 assert.match(js,/Personal subscriber linking and test messages are not yet available/);
 assert.doesNotMatch(js,/\/api\/telegram\/link|\/api\/trade\/send|order_send/);
 assert.doesNotMatch(html,/name="(?:password|investorPassword|workerToken)"/);
});
