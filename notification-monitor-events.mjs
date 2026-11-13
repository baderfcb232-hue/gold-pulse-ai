// Authenticated MT5 Demo read-only monitor events. State here represents the
// monitor's observation, NEVER an independently broker-verified trade/connection.
// Must be invoked with a transaction query AFTER worker token + account verification.
import {randomUUID} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATES=new Set(['ONLINE','OFFLINE','STALE']);
const error=(status,message)=>{throw Object.assign(Error(message),{status});};
function eventForState(state,previous){
 if(state==='STALE')return {
  type:'MT5_STATUS',titleAr:'تأخر تقرير مراقب MT5',titleEn:'MT5 monitor report delayed',
  bodyAr:'لم يصل تحديث مراقبة جديد في المهلة المحددة. حالة اتصال الوسيط غير مؤكدة، ولا يعني ذلك تنفيذًا أو إيقافًا للتداول.',
  bodyEn:'The read-only monitor is late. Broker connectivity is unverified; no trade or stop is confirmed.'};
 if(state==='OFFLINE')return {
  type:'MT5_DISCONNECTED',titleAr:'مراقب MT5 أبلغ عن انقطاع',titleEn:'MT5 monitor reported offline',
  bodyAr:'أبلغ مراقب الحساب التجريبي أنه غير متصل. هذا تقرير مراقبة وليس تأكيدًا مستقلًا من الوسيط.',
  bodyEn:'The Demo monitor reported offline. This is a monitoring report, not independent broker proof.'};
 if(previous==='OFFLINE'||previous==='STALE')return {
  type:'MT5_RECONNECTED',titleAr:'عودة تقرير اتصال MT5',titleEn:'MT5 monitor reported online again',
  bodyAr:'أبلغ مراقب الحساب التجريبي بعودة الاتصال. لم يتم التحقق من تنفيذ أي صفقة.',
  bodyEn:'The Demo monitor reported online again. No trade execution was verified.'};
 return {
  type:'MT5_STATUS',titleAr:'بدأت مراقبة MT5 التجريبية',titleEn:'Demo MT5 monitoring started',
  bodyAr:'وصل أول تقرير حالة من مراقب الحساب التجريبي. هذه مراقبة فقط وليست تفعيل تداول.',
  bodyEn:'First Demo monitoring observation received. Monitoring only, with no trading enabled.'};
}
export async function recordVerifiedDemoMonitorState(query,{userId,accountId,state,at}){
 if(typeof query!=='function'||!UUID.test(userId)||!UUID.test(accountId)||
   !STATES.has(state)||typeof at!=='number'||!Number.isFinite(at)||at<0)
  error(400,'Invalid trusted Demo monitor state');
 const prior=(await query('SELECT status,revision FROM nabd_member_mt5_monitor_state WHERE account_id=?',[accountId])).rows[0];
 if(prior?.status===state)return {changed:false};
 const revision=(prior?.revision??0)+1;
 await query(`INSERT INTO nabd_member_mt5_monitor_state(account_id,user_id,status,revision,observed_at)
   VALUES(?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET status=excluded.status,
   revision=excluded.revision,observed_at=excluded.observed_at`,
   [accountId,userId,state,revision,at]);
 const e=eventForState(state,prior?.status??null);
 const eventKey='MT5MON:'+accountId+':'+revision;
 await query(`INSERT INTO nabd_member_notifications
  (id,user_id,event_key,event_type,symbol,title_ar,title_en,body_ar,body_en,created_at)
  SELECT ?,u.id,?,?,NULL,?,?,?,?,? FROM nabd_users u
  LEFT JOIN nabd_member_alert_preferences prefs ON prefs.user_id=u.id
  WHERE u.id=? AND u.status='active' AND u.verified_at IS NOT NULL
  AND u.notifications=1 AND COALESCE(prefs.system_enabled,1)=1
  ON CONFLICT(user_id,event_key) DO NOTHING`,
  [randomUUID(),eventKey,e.type,e.titleAr,e.titleEn,e.bodyAr,e.bodyEn,at,userId]);
 return {changed:true,state,revision};
}
export function createMonitorStaleSweep({store,clock=()=>Date.now()/1000}){
 if(!store?.transaction)throw Error('Persistent monitor store required');
 return async function sweep(){
  const now=clock();
  return store.transaction(async q=>{
   const stale=(await q(`SELECT s.account_id,s.user_id
     FROM nabd_member_mt5_monitor_state s
     JOIN nabd_mt5_monitor_workers w ON w.account_id=s.account_id
     JOIN nabd_member_mt5_accounts a ON a.id=s.account_id AND a.user_id=s.user_id
     JOIN nabd_mt5_hosting_requests h ON h.account_id=a.id
     WHERE s.status='ONLINE' AND h.status='APPROVED'
     AND w.last_seen_at<? AND w.last_seen_at<=?
     ORDER BY w.last_seen_at ASC LIMIT 250`,[now-60,now])).rows;
   let changed=0;
   for(const item of stale) {
     const result=await recordVerifiedDemoMonitorState(q,{userId:item.user_id,accountId:item.account_id,state:'STALE',at:now});
     if(result.changed)changed++;
   }
   return {changed};
  });
 }
}
