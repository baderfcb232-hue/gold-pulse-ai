import test from 'node:test';
import assert from 'node:assert/strict';
import {subscriberTelegramReadiness as probe} from '../subscriber-telegram-readiness.mjs';
const base={token:'123456:example-private-token',username:'NabdSubscriberAlertsBot',webhookSecret:'a-long-webhook-secret-string',
siteUrl:'https://gold-pulse-ai.onrender.com'};
const good={
 getMe:{ok:true,result:{id:123,is_bot:true,username:base.username}},
 getWebhookInfo:{ok:true,result:{url:'https://gold-pulse-ai.onrender.com/api/telegram/subscriber-webhook',pending_update_count:0}}
};
const fake=data=>async url=>({ok:true,json:async()=>data[url.split('/').pop()]});
test('no credentials or invalid config => no Telegram network call',async()=>{
 let called=0;
 let r=await probe({...base,token:'',fetcher:async()=>{called++}});
 assert.equal(r.state,'NOT_CONFIGURED');assert.equal(r.ready,false);assert.equal(called,0);
 r=await probe({...base,siteUrl:'http://insecure.test',fetcher:async()=>{called++}});
 assert.equal(r.state,'NOT_CONFIGURED');assert.equal(called,0);
});
test('expected webhook and verified bot => readiness is conditional; not a delivery/secret proof',async()=>{
 const r=await probe({...base,fetcher:fake(good)});
 assert.deepEqual(r,{ready:true,state:'API_READY',botVerified:true,webhookVerified:true,
  secretTokenVerified:false,deliveryVerified:false});
 assert.doesNotMatch(JSON.stringify(r),/123456:example|webhook-secret/);
});
test('wrong bot, missing webhook, and backlog fail closed',async()=>{
 assert.equal((await probe({...base,fetcher:fake({...good,getMe:{ok:true,result:{is_bot:true,username:'OtherBot'}}})})).state,'BOT_IDENTITY_MISMATCH');
 assert.equal((await probe({...base,fetcher:fake({...good,getWebhookInfo:{ok:true,result:{url:'',pending_update_count:0}}})})).state,'WEBHOOK_URL_MISMATCH');
 assert.equal((await probe({...base,fetcher:fake({...good,getWebhookInfo:{ok:true,result:{...good.getWebhookInfo.result,pending_update_count:101}}})})).state,'WEBHOOK_BACKLOG');
 assert.equal((await probe({...base,fetcher:async()=>{throw Error('network');}})).state,'TELEGRAM_API_UNAVAILABLE');
});
