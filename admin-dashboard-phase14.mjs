import {randomUUID} from 'node:crypto';

// Phase 14: administrative observation and non-billable plan catalog drafts.
// This module does not authorize payment, subscriptions, MT5 execution or trading.
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const FEATURES=Object.freeze(['GOLD_SIGNALS','BTC_SIGNALS','DEMO_MT5_MONITORING']);
const currencies=new Set(['USD','ILS','EUR']);
const CODE=/^[A-Z][A-Z0-9_]{2,23}$/;
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const count=rows=>Object.fromEntries(rows.map(row=>[row.status,Number(row.count)]));
const clean=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
const asPlan=row=>({
 id:row.id,code:row.code,nameAr:row.name_ar,nameEn:row.name_en,
 currency:row.currency,priceMinor:Number(row.price_minor),durationDays:Number(row.duration_days),
 features:JSON.parse(row.features_json),state:row.state,createdAt:Number(row.created_at),
 updatedAt:Number(row.updated_at),billingEnabled:false,subscriptionsEnabled:false
});
export function validatePlanDraft(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(
   x=>!['code','nameAr','nameEn','currency','priceMinor','durationDays','features'].includes(x)))
   fail(400,'Invalid draft fields');
 if(typeof raw.code!=='string'||!CODE.test(raw.code)||
   typeof raw.nameAr!=='string'||typeof raw.nameEn!=='string'||
   raw.nameAr.trim().length<2||raw.nameAr.trim().length>80||
   raw.nameEn.trim().length<2||raw.nameEn.trim().length>80||
   !currencies.has(raw.currency)||
   !Number.isSafeInteger(raw.priceMinor)||raw.priceMinor<0||raw.priceMinor>100000000||
   !Number.isSafeInteger(raw.durationDays)||raw.durationDays<1||raw.durationDays>1095||
   !Array.isArray(raw.features)||!raw.features.length||raw.features.length>FEATURES.length||
   new Set(raw.features).size!==raw.features.length||
   raw.features.some(x=>!FEATURES.includes(x)))
  fail(400,'Invalid non-billable plan specification');
 return {code:raw.code,nameAr:raw.nameAr.trim(),nameEn:raw.nameEn.trim(),
   currency:raw.currency,priceMinor:raw.priceMinor,durationDays:raw.durationDays,
   features:[...raw.features]};
}
export function createPhase14Admin({store,clock=()=>Date.now()/1000,operationalStatus=()=>({})}={}){
 if(!store?.query||!store?.transaction)throw Error('Persistent identity database required');
 async function dashboard(){
  const now=clock();
  const [users,hosting,worker,telegram,audit]=await Promise.all([
   store.query('SELECT status,COUNT(*) AS count FROM nabd_users GROUP BY status'),
   store.query('SELECT status,COUNT(*) AS count FROM nabd_mt5_hosting_requests GROUP BY status'),
   store.query(`SELECT COUNT(*) AS total,
     COALESCE(SUM(CASE WHEN last_seen_at>=? AND last_seen_at<=? THEN 1 ELSE 0 END),0) AS recent,
     COALESCE(SUM(CASE WHEN last_seen_at>=? AND last_seen_at<=? AND mt5_online=1 THEN 1 ELSE 0 END),0) AS online_reports
     FROM nabd_mt5_monitor_workers`,[now-60,now,now-60,now]),
   store.query('SELECT COUNT(*) AS total FROM nabd_member_telegram'),
   store.query('SELECT COUNT(*) AS total FROM nabd_auth_audit WHERE time>=? AND time<=?',[now-86400,now])
  ]);
  const uc=count(users.rows),hc=count(hosting.rows),w=worker.rows[0]||{},ops=operationalStatus()||{};
  // Operational status is the application's readout, NOT a direct Render/provider SLA.
  return {
   generatedAt:now,users:{
    total:Object.values(uc).reduce((a,b)=>a+b,0),active:uc.active||0,
    disabled:uc.disabled||0,deletionRequested:uc.deletion_requested||0
   },hosting:{requested:hc.REQUESTED||0,approved:hc.APPROVED||0,rejected:hc.REJECTED||0},
   mt5Monitor:{provisioned:Number(w.total||0),recentHeartbeat:Number(w.recent||0),
     onlineReports:Number(w.online_reports||0),brokerConnectionVerified:false,
     automaticTradingEnabled:false},
   telegram:{linkedAccounts:Number(telegram.rows[0]?.total||0),
     deliveryVerified:false},
   audit:{eventsLast24Hours:Number(audit.rows[0]?.total||0)},
   services:{database:'CONNECTED',mt5:typeof ops.mt5==='string'?ops.mt5:'UNKNOWN',
    publication:typeof ops.publication==='string'?ops.publication:'UNKNOWN',
    telegram:typeof ops.telegram==='string'?ops.telegram:'UNKNOWN',
    render:'NOT_CHECKED'},
   subscriptions:{billingEnabled:false,subscriberEntitlementsEnabled:false,
     paymentIntegration:'NOT_CONNECTED'},
   restrictions:{liveTradingEnabledByAdmin:false,monitoringOnly:true},
   observationOnly:true
  };
 }
 async function listPlans(){
  const rows=(await store.query(`SELECT id,code,name_ar,name_en,currency,price_minor,duration_days,features_json,
    state,created_at,updated_at FROM nabd_admin_plan_drafts ORDER BY updated_at DESC,id LIMIT 100`)).rows;
  return {plans:rows.map(asPlan),billingEnabled:false,subscriptionsEnabled:false};
 }
 async function mutatePlan(adminId,body){
  if(!ID.test(adminId)||!body||typeof body!=='object'||Array.isArray(body)||
     !['create','update','archive'].includes(body.action))fail(400,'Invalid plan action');
  if(body.action==='archive'){
   if(Object.keys(body).sort().join(',')!=='action,id'||!ID.test(body.id))
    fail(400,'Invalid plan archive request');
   return store.transaction(async q=>{
    const changed=(await q(`UPDATE nabd_admin_plan_drafts SET state='ARCHIVED',updated_at=?
      WHERE id=? AND state='DRAFT' RETURNING id`,[clock(),body.id])).rows;
    if(!changed.length)fail(409,'Draft unavailable or already archived');
    await q('INSERT INTO nabd_auth_audit(id,time,actor,event,subject) VALUES(?,?,?,?,?)',
     [randomUUID(),clock(),adminId,'ADMIN_PLAN_DRAFT_ARCHIVED',body.id]);
    return {ok:true,state:'ARCHIVED',billingEnabled:false};
   });
  }
  const {action,id,...raw}=body;
  if(action==='create'&&id!==undefined)fail(400,'New draft must not supply an id');
  if(action==='update'&&!ID.test(id))fail(400,'Draft ID required');
  const p=validatePlanDraft(raw);
  return store.transaction(async q=>{
   const now=clock(),planId=action==='create'?randomUUID():id;
   if(action==='create'){
    const previous=(await q('SELECT id FROM nabd_admin_plan_drafts WHERE code=?',[p.code])).rows;
    if(previous.length)fail(409,'Draft code already exists');
    await q(`INSERT INTO nabd_admin_plan_drafts
      (id,code,name_ar,name_en,currency,price_minor,duration_days,features_json,state,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,'DRAFT',?,?,?)`,
      [planId,p.code,p.nameAr,p.nameEn,p.currency,p.priceMinor,p.durationDays,JSON.stringify(p.features),
       adminId,now,now]);
   }else{
    const previous=(await q('SELECT id FROM nabd_admin_plan_drafts WHERE code=? AND id<>?',[p.code,id])).rows;
    if(previous.length)fail(409,'Draft code already exists');
    const changed=(await q(`UPDATE nabd_admin_plan_drafts
      SET code=?,name_ar=?,name_en=?,currency=?,price_minor=?,duration_days=?,features_json=?,updated_at=?
      WHERE id=? AND state='DRAFT' RETURNING id`,
      [p.code,p.nameAr,p.nameEn,p.currency,p.priceMinor,p.durationDays,JSON.stringify(p.features),now,id])).rows;
    if(!changed.length)fail(409,'Draft unavailable or archived');
   }
   await q('INSERT INTO nabd_auth_audit(id,time,actor,event,subject) VALUES(?,?,?,?,?)',
    [randomUUID(),now,adminId,action==='create'?'ADMIN_PLAN_DRAFT_CREATED':'ADMIN_PLAN_DRAFT_UPDATED',planId]);
   return {ok:true,id:planId,state:'DRAFT',billingEnabled:false,
     subscriptionsEnabled:false,liveTradingEnabled:false};
  });
 }
 return Object.freeze({dashboard,listPlans,mutatePlan});
}
