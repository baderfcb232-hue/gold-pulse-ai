import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';

/** Subscriber Telegram linking is for PRIVATE notifications only. It never authorizes MT5 trading. */
const hash=value=>createHash('sha256').update(value).digest('hex');
const bool=x=>x===true||x===false;
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const properBotName=x=>typeof x==='string'&&/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(x);
const validChat=x=>typeof x==='string'&&/^[1-9][0-9]{0,19}$/.test(x);
const validToken=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{43}$/.test(x);
const safeEqual=(a,b)=>{
 const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));
 return x.length===y.length && x.length>0 && timingSafeEqual(x,y);
};
const toView=row=>({
 gold:row?.gold_enabled===1||row?.gold_enabled===true,
 bitcoin:row?.btc_enabled===1||row?.btc_enabled===true,
 signals:row?.signals_enabled===1||row?.signals_enabled===true,
 execution:row?.execution_enabled===1||row?.execution_enabled===true,
 system:row?.system_enabled===1||row?.system_enabled===true
});
export const DEFAULT_SUBSCRIBER_ALERTS=Object.freeze({gold:true,bitcoin:true,signals:true,execution:false,system:true});

export function createSubscriberAlerts({store,clock=()=>Date.now()/1000,botToken='',botUsername='',
 webhookSecret='',fetcher=fetch}={}){
 if(!store||typeof store.query!=='function'||typeof store.transaction!=='function')throw Error('Account store required');
 const configured=Boolean(botToken&&properBotName(botUsername)&&webhookSecret.length>=16);
 const selectPrefs=async id=>{
  const row=(await store.query('SELECT * FROM nabd_member_alert_preferences WHERE user_id=?',[id])).rows[0];
  return row?toView(row):{...DEFAULT_SUBSCRIBER_ALERTS};
 };
 async function state(ownerId){
  const prefs=await selectPrefs(ownerId);
  const row=(await store.query('SELECT chat_id, linked_at FROM nabd_member_telegram WHERE user_id=?',[ownerId])).rows[0];
  return {preferences:prefs,telegram:{configured,linked:Boolean(row),linkedAt:row?Number(row.linked_at):null},
   personalMessagesEnabled:configured&&Boolean(row),tradingEnabled:false};
 }
 async function updatePreferences(ownerId,input){
  if(!input||Object.keys(input).sort().join(',')!=='bitcoin,execution,gold,signals,system'||
    !Object.values(input).every(bool))fail(400,'Invalid alert preferences');
  await store.query(`INSERT INTO nabd_member_alert_preferences
   (user_id,gold_enabled,btc_enabled,signals_enabled,execution_enabled,system_enabled,updated_at)
   VALUES(?,?,?,?,?,?,?)
   ON CONFLICT(user_id) DO UPDATE SET
    gold_enabled=excluded.gold_enabled,btc_enabled=excluded.btc_enabled,
    signals_enabled=excluded.signals_enabled,execution_enabled=excluded.execution_enabled,
    system_enabled=excluded.system_enabled,updated_at=excluded.updated_at`,
   [ownerId,...['gold','bitcoin','signals','execution','system'].map(x=>input[x]?1:0),clock()]);
  return selectPrefs(ownerId);
 }
 async function startLink(ownerId){
  if(!configured)fail(503,'Personal Telegram linking is not configured');
  const token=randomBytes(32).toString('base64url');
  const expires=clock()+600;
  await store.transaction(async q=>{
   await q('DELETE FROM nabd_member_telegram_pending WHERE user_id=?',[ownerId]);
   await q('INSERT INTO nabd_member_telegram_pending(user_id,token_hash,expires_at) VALUES(?,?,?)',
    [ownerId,hash(token),expires]);
  });
  // Only reveal once to the authenticated owner. Token is never stored in plaintext.
  return {url:'https://t.me/'+botUsername+'?start=nabd_'+token,expiresAt:expires};
 }
 async function acceptWebhook(secret,payload){
  if(!configured||!safeEqual(secret,webhookSecret))fail(403,'Forbidden');
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return {ok:true};
  const msg=payload.message;
  if(!msg||msg.chat?.type!=='private'||msg.chat.id!==msg.from?.id||
     !Number.isSafeInteger(msg.chat.id)||msg.chat.id<=0||
     typeof msg.text!=='string')return {ok:true};
  const match=/^\/start nabd_([A-Za-z0-9_-]{43})$/.exec(msg.text.trim());
  if(!match)return {ok:true};
  const chatId=String(msg.chat.id);
  const tokenHash=hash(match[1]); const now=clock();
  await store.transaction(async q=>{
   const used=(await q(`DELETE FROM nabd_member_telegram_pending
      WHERE token_hash=? AND expires_at>? RETURNING user_id`,[tokenHash,now])).rows[0];
   if(!used)return;
   // Private chat IDs are globally unique; a chat cannot be bound to two member accounts.
   await q(`INSERT INTO nabd_member_telegram(user_id,chat_id,linked_at,last_test_at)
     VALUES(?,?,?,NULL) ON CONFLICT(user_id) DO UPDATE SET
       chat_id=excluded.chat_id,linked_at=excluded.linked_at,last_test_at=NULL`,
       [used.user_id,chatId,now]);
  });
  return {ok:true};
 }
 async function unlink(ownerId){
  await store.transaction(async q=>{
   await q('DELETE FROM nabd_member_telegram_pending WHERE user_id=?',[ownerId]);
   await q('DELETE FROM nabd_member_telegram WHERE user_id=?',[ownerId]);
  });
  return {linked:false};
 }
 async function sendTest(ownerId){
  if(!configured)fail(503,'Personal Telegram linking is not configured');
  // Claim test before outbound request: uncertain responses must never trigger duplicate retries.
  const now=clock();
  const claimed=await store.query(`UPDATE nabd_member_telegram SET last_test_at=?
    WHERE user_id=? AND (last_test_at IS NULL OR last_test_at<=?)
    RETURNING chat_id`,[now,ownerId,now-60]);
  const chatId=claimed.rows[0]?.chat_id;
  if(!chatId)fail(429,'Link Telegram first or retry after one minute');
  if(!validChat(chatId))fail(503,'Telegram identity unavailable');
  try{
   const response=await fetcher('https://api.telegram.org/bot'+botToken+'/sendMessage',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({chat_id:chatId,text:'NABD | نبض\n✅ اختبار إشعار شخصي. هذه ليست توصية تداول ولا تأكيد تنفيذ صفقة.',
      link_preview_options:{is_disabled:true}}),signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw Error('TELEGRAM_SEND_FAILED');
   const data=await response.json();
   if(data?.ok!==true||!Number.isSafeInteger(data?.result?.message_id))throw Error('TELEGRAM_SEND_FAILED');
   return {sent:true};
  }catch {fail(503,'Personal Telegram test delivery not confirmed');}
 }
 return Object.freeze({configured,state,updatePreferences,startLink,acceptWebhook,unlink,sendTest});
}
