// Phase 13: optional Telegram for independently authenticated Demo MONITOR notices.
// No unverified trade fills or user-supplied text can be sent through this service.
import {createHash} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY=/^MT5MON:[0-9a-f-]{36}:[1-9][0-9]{0,10}$/;
export function createMonitorTelegramAlerts({store,clock=()=>Date.now()/1000,
  enabled=false,botToken='',fetcher=fetch,cooldownSeconds=60}={}){
 if(!store?.transaction||!store?.query)throw Error('Account store required');
 const available=enabled===true&&typeof botToken==='string'&&botToken.length>=5;
 const publish=async(ownerId,eventKey)=>{
  if(!available)return {attempted:false,enabled:false};
  if(!UUID.test(ownerId)||!KEY.test(eventKey))return {attempted:false,enabled:true};
  const now=clock();
  const claim=await store.transaction(async q=>{
   const rows=(await q(`INSERT INTO nabd_member_telegram_monitor_deliveries
     (user_id,event_key,status,claimed_at)
     SELECT n.user_id,n.event_key,'SENDING',?
     FROM nabd_member_notifications n
     JOIN nabd_users u ON u.id=n.user_id
     JOIN nabd_member_telegram t ON t.user_id=n.user_id
     LEFT JOIN nabd_member_alert_preferences p ON p.user_id=n.user_id
     WHERE n.user_id=? AND n.event_key=? AND n.deleted_at IS NULL
       AND n.event_type IN ('MT5_STATUS','MT5_RECONNECTED','MT5_DISCONNECTED')
       AND u.status='active' AND u.verified_at IS NOT NULL
       AND u.notifications=1 AND COALESCE(p.system_enabled,1)=1
       AND NOT EXISTS(SELECT 1 FROM nabd_member_telegram_monitor_deliveries d
         WHERE d.user_id=n.user_id AND d.claimed_at>?)
     ON CONFLICT(user_id,event_key) DO NOTHING RETURNING user_id`,
     [now,ownerId,eventKey,now-cooldownSeconds])).rows;
   if(!rows.length)return null;
   const current=(await q(`SELECT t.chat_id,n.title_ar,n.body_ar
     FROM nabd_member_notifications n
     JOIN nabd_users u ON u.id=n.user_id
     JOIN nabd_member_telegram t ON t.user_id=n.user_id
     LEFT JOIN nabd_member_alert_preferences p ON p.user_id=n.user_id
     WHERE n.user_id=? AND n.event_key=? AND n.deleted_at IS NULL
       AND u.status='active' AND u.notifications=1 AND COALESCE(p.system_enabled,1)=1`,
     [ownerId,eventKey])).rows[0];
   return current||null;
  });
  if(!claim)return {attempted:false,enabled:true};
  // Recheck unlink/opt-out AFTER claim, before network IO. If state changed,
  // retain the claim as skipped to avoid sending an unwanted replay later.
  const confirm=(await store.query(`SELECT t.chat_id FROM nabd_member_telegram t
    JOIN nabd_users u ON u.id=t.user_id
    LEFT JOIN nabd_member_alert_preferences p ON p.user_id=t.user_id
    WHERE t.user_id=? AND u.status='active' AND u.verified_at IS NOT NULL
      AND u.notifications=1 AND COALESCE(p.system_enabled,1)=1`,[ownerId])).rows[0];
  if(!confirm||confirm.chat_id!==claim.chat_id){
   await store.query(`UPDATE nabd_member_telegram_monitor_deliveries SET status='FAILED',completed_at=?
     WHERE user_id=? AND event_key=? AND status='SENDING'`,[clock(),ownerId,eventKey]);
   return {attempted:false,enabled:true};
  }
  let status='UNCERTAIN',messageId=null;
  try{
   const response=await fetcher('https://api.telegram.org/bot'+botToken+'/sendMessage',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({chat_id:claim.chat_id,
      text:'نبض | إشعار متابعة تجريبي\\n'+claim.title_ar+'\\n'+claim.body_ar+
        '\\nمراقبة فقط؛ لا تؤكد تنفيذ أو إيقاف صفقة.',
      link_preview_options:{is_disabled:true}}),signal:AbortSignal.timeout(10000)
   });
   const data=await response.json();
   if(response.ok&&data?.ok===true&&Number.isSafeInteger(data?.result?.message_id)){
    status='SENT';messageId=data.result.message_id;
   }else if(data?.ok===false)status='FAILED';
  }catch{/* Outcome uncertain. NEVER auto retry. */}
  await store.query(`UPDATE nabd_member_telegram_monitor_deliveries
    SET status=?,completed_at=?,telegram_message_id=?
    WHERE user_id=? AND event_key=? AND status='SENDING'`,
    [status,clock(),messageId,ownerId,eventKey]);
  return {attempted:true,enabled:true,sent:status==='SENT'};
 };
 return Object.freeze({publish,enabled:available});
}
