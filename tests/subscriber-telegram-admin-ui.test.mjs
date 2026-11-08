import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const file=x=>readFileSync(new URL('../'+x,import.meta.url),'utf8');
test('private Telegram readiness is displayed only in the existing admin-MFA content',()=>{
 const html=file('public/accounts.html');
 const start=html.indexOf('id="admin-content"'),end=html.indexOf('id="admin-subscriber-tg-check"');
 assert.ok(start>=0&&end>start,'status must be inside protected admin content');
 assert.match(html,/id="admin-subscriber-tg-status"/);
 assert.match(html,/id="admin-subscriber-tg-check"/);
 assert.doesNotMatch(html,/NABD_SUBSCRIBER_TELEGRAM_BOT_TOKEN=/);
});
test('admin-only UI uses a safe GET and never reflects tokens or webhook secrets',()=>{
 const js=file('public/accounts.js');
 assert.match(js,/api\('\/api\/admin\/subscriber-telegram-readiness'\)/);
 assert.match(js,/subscriberTelegramStates/);
 assert.match(js,/r\.autoSignalsEnabled/);
 assert.doesNotMatch(js,/getWebhookSecret|NABD_SUBSCRIBER_TELEGRAM_BOT_TOKEN/);
});
