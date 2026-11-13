import {randomUUID} from 'node:crypto';
import {validatePublicSignal} from './subscriber-signal-dispatch.mjs';

// Phase 13: per-member persistent inbox. Public API is READ + owner-scoped status
// mutations only. Event creation is server-internal and never grants MT5 access.
export const NOTIFICATION_TYPES=Object.freeze([
 'GOLD_SIGNAL','BTC_SIGNAL','TRADE_EXECUTED','TRADE_REJECTED','TP_HIT','SL_HIT',
 'MT5_DISCONNECTED','MT5_RECONNECTED','MT5_STATUS','DAILY_LOSS',
 'SUBSCRIPTION_EXPIRING','SUBSCRIPTION_EXPIRED'
]);
const types=new Set(NOTIFICATION_TYPES);
const markets=new Set(['XAUUSD','BTCUSD']);
const bad=(status,message)=>{throw Object.assign(Error(message),{status});};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const trim=(text,max)=>typeof text==='string' ? text.trim().slice(0,max) : '';
const validKey=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/.test(value);
const view=row=>({
 id:row.id,eventType:row.event_type,market:row.symbol||null,
 titleAr:row.title_ar,titleEn:row.title_en,bodyAr:row.body_ar,bodyEn:row.body_en,
 createdAt:Number(row.created_at),read:row.read_at!=null,archived:row.archived_at!=null,
 source:'NABD'
});
export function createNotificationCenter({store,clock=()=>Date.now()/1000,maxSubscribers=1000}={}){
 if(typeof store?.query!=='function'||typeof store?.transaction!=='function')throw Error('Persistent accounts storage required');
 if(!Number.isSafeInteger(maxSubscribers)||maxSubscribers<1||maxSubscribers>5000)throw Error('Invalid notification member cap');
 async function emitForMember(userId,event){
  if(!uuid(userId)||!event||!types.has(event.eventType)||!validKey(event.eventKey)||
    (event.market!=null&&!markets.has(event.market))||
    !['titleAr','titleEn','bodyAr','bodyEn'].every(k=>typeof event[k]==='string'&&event[k].trim().length>0&&event[k].length<=350))
    bad(400,'Invalid trusted notification event');
  const id=randomUUID(),now=clock();
  const inserted=await store.query(`INSERT INTO nabd_member_notifications
     (id,user_id,event_key,event_type,symbol,title_ar,title_en,body_ar,body_en,created_at)
     SELECT ?,u.id,?,?,?,?,?,?,?,? FROM nabd_users u
     LEFT JOIN nabd_member_alert_preferences p ON p.user_id=u.id
     WHERE u.id=? AND u.status='active' AND u.verified_at IS NOT NULL AND u.notifications=1
       AND (
         (? IN ('GOLD_SIGNAL','BTC_SIGNAL') AND u.recommendations=1
           AND COALESCE(p.signals_enabled,1)=1
           AND ((?='XAUUSD' AND COALESCE(p.gold_enabled,1)=1)
             OR (?='BTCUSD' AND COALESCE(p.btc_enabled,1)=1)))
         OR (? IN ('TRADE_EXECUTED','TRADE_REJECTED','TP_HIT','SL_HIT')
            AND COALESCE(p.execution_enabled,0)=1)
         OR (? IN ('MT5_DISCONNECTED','MT5_RECONNECTED','MT5_STATUS','DAILY_LOSS',
             'SUBSCRIPTION_EXPIRING','SUBSCRIPTION_EXPIRED')
            AND COALESCE(p.system_enabled,1)=1)
       )
     ON CONFLICT(user_id,event_key) DO NOTHING RETURNING id`,
     [id,event.eventKey,event.eventType,event.market||null,trim(event.titleAr,160),
       trim(event.titleEn,160),trim(event.bodyAr,350),trim(event.bodyEn,350),now,userId,
       event.eventType,event.market,event.market,event.eventType,event.eventType]);
  return {created:inserted.rows.length===1};
 }
 async function publishSignal(signal){
  const now=clock();
  if(!validatePublicSignal(signal,now))return {accepted:false,inserted:0};
  const recipients=(await store.query(`SELECT u.id FROM nabd_users u
    LEFT JOIN nabd_member_alert_preferences a ON a.user_id=u.id
    WHERE u.status='active' AND u.verified_at IS NOT NULL
      AND u.notifications=1 AND u.recommendations=1
      AND COALESCE(a.signals_enabled,1)=1
      AND ((?='XAUUSD' AND COALESCE(a.gold_enabled,1)=1) OR
           (?='BTCUSD' AND COALESCE(a.btc_enabled,1)=1))
    ORDER BY u.id LIMIT ?`,[signal.symbol,signal.symbol,maxSubscribers])).rows;
  const buy=signal.side==='BUY';
  const market=signal.symbol==='XAUUSD'?'GOLD_SIGNAL':'BTC_SIGNAL';
  const nameAr=signal.symbol==='XAUUSD'?'الذهب':'البيتكوين';
  const nameEn=signal.symbol==='XAUUSD'?'Gold':'Bitcoin';
  const event={eventKey:'SIGNAL:'+signal.id,eventType:market,market:signal.symbol,
   titleAr:'توصية '+nameAr+' جديدة',titleEn:'New '+nameEn+' reference signal',
   bodyAr:(buy?'شراء':'بيع')+' · '+signal.symbol+' · رقم '+signal.id+
      ' · توصية مرجعية وليست صفقة منفّذة.',
   bodyEn:(buy?'Buy':'Sell')+' · '+signal.symbol+' · #'+signal.id+
      ' · Reference signal, not a confirmed trade.'};
  let inserted=0;
  for(const user of recipients){
   if((await emitForMember(user.id,event)).created)inserted++;
  }
  return {accepted:true,inserted};
 }
 async function list(userId,{type='ALL',market='ALL',state='active',limit=30,offset=0}={}){
  if(!uuid(userId))bad(401,'Authenticated member required');
  if(type!=='ALL'&&!types.has(type))bad(400,'Invalid notification type filter');
  if(market!=='ALL'&&!markets.has(market))bad(400,'Invalid market filter');
  if(!['active','unread','read','archived'].includes(state))bad(400,'Invalid inbox state');
  if(!Number.isSafeInteger(limit)||limit<1||limit>50||!Number.isSafeInteger(offset)||offset<0||offset>10000)
   bad(400,'Invalid inbox pagination');
  const conditions=['user_id=?','deleted_at IS NULL'];
  const args=[userId];
  if(type!=='ALL'){conditions.push('event_type=?');args.push(type);}
  if(market!=='ALL'){conditions.push('symbol=?');args.push(market);}
  if(state==='archived')conditions.push('archived_at IS NOT NULL');
  else{
   conditions.push('archived_at IS NULL');
   if(state==='unread')conditions.push('read_at IS NULL');
   if(state==='read')conditions.push('read_at IS NOT NULL');
  }
  const rows=(await store.query(`SELECT id,event_type,symbol,title_ar,title_en,body_ar,body_en,
    created_at,read_at,archived_at FROM nabd_member_notifications
    WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`,
    [...args,limit,offset])).rows;
  const [count]= (await store.query(`SELECT COUNT(*) AS count FROM nabd_member_notifications
    WHERE user_id=? AND deleted_at IS NULL AND archived_at IS NULL AND read_at IS NULL`,[userId])).rows;
  return {items:rows.map(view),unreadCount:Number(count?.count||0),nextOffset:rows.length===limit?offset+limit:null};
 }
 async function update(userId,{id,action}={}){
  if(!uuid(userId)||!uuid(id)||!['read','unread','archive','restore','delete'].includes(action))
    bad(400,'Invalid notification operation');
  const now=clock();
  const field={read:'read_at',unread:'read_at',archive:'archived_at',
    restore:'archived_at',delete:'deleted_at'}[action];
  const value=action==='read'||action==='archive'||action==='delete'?now:null;
  const updated=(await store.query(`UPDATE nabd_member_notifications SET ${field}=?
    WHERE id=? AND user_id=? AND deleted_at IS NULL RETURNING id`,[value,id,userId])).rows;
  if(!updated.length)bad(404,'Notification not found');
  return {ok:true,id,action};
 }
 async function purgeDeleted(){
  const n=(await store.query('DELETE FROM nabd_member_notifications WHERE deleted_at IS NOT NULL AND deleted_at<? RETURNING id',[clock()-30*86400])).rows.length;
  return {purged:n};
 }
 return Object.freeze({emitForMember,publishSignal,list,update,purgeDeleted});
}
