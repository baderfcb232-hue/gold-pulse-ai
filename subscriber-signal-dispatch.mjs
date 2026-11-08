/** NABD personal Telegram alerts: published reference signals only, never broker execution. */
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const finite=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const format=x=>Number(x).toString();
export const SUBSCRIBER_SIGNAL_DELIVERY_SCHEMA=`
CREATE TABLE IF NOT EXISTS nabd_member_telegram_deliveries (
 user_id TEXT NOT NULL REFERENCES nabd_users(id) ON DELETE CASCADE,
 signal_id TEXT NOT NULL,
 symbol TEXT NOT NULL CHECK(symbol IN ('XAUUSD','BTCUSD')),
 status TEXT NOT NULL CHECK(status IN ('SENDING','SENT','FAILED','UNCERTAIN')),
 claimed_at DOUBLE PRECISION NOT NULL,
 completed_at DOUBLE PRECISION,
 telegram_message_id BIGINT,
 PRIMARY KEY(user_id,signal_id)
);
`;
export function validatePublicSignal(p,now){
 if(!p||typeof p!=='object'||!ID.test(p.id||'')||
    !['XAUUSD','BTCUSD'].includes(p.symbol)||!['BUY','SELL'].includes(p.side)||
    p.status!=='TRACKING'||!finite(p.entry)||!finite(p.sl)||!finite(p.tp1)||
    !Number.isFinite(p.issued_at)||!Number.isFinite(p.expires_at)||
    p.issued_at>now+5||now-p.issued_at>300||p.expires_at<=now)return false;
 return p.side==='BUY'?p.sl<p.entry&&p.entry<p.tp1:p.tp1<p.entry&&p.entry<p.sl;
}
const message=p=>['نبض | توصية تحليلية جديدة',p.symbol+' — '+(p.side==='BUY'?'شراء':'بيع'),
 'الدخول: '+format(p.entry),'وقف الخسارة: '+format(p.sl),
 'الهدف الأول: '+format(p.tp1),'رقم التوصية: '+p.id,
 'هذه ليست صفقة منفذة ولا ضمان ربح. تحقق من حالة المصدر داخل نبض.'].join('\n');

export function createSubscriberSignalDispatch({
 store,clock=()=>Date.now()/1000,enabled=false,botToken='',fetcher=fetch,maxRecipients=100
}={}){
 if(!store||typeof store.query!=='function')throw Error('Postgres account store required');
 const configured=enabled===true&&Boolean(botToken)&&
   Number.isSafeInteger(maxRecipients)&&maxRecipients>=1&&maxRecipients<=500;
 async function publish(p){
  const now=clock();
  if(!configured||!validatePublicSignal(p,now))return {attempted:0,enabled:configured};
  const recipients=(await store.query(`SELECT t.user_id,t.chat_id
    FROM nabd_member_telegram t
    JOIN nabd_users u ON u.id=t.user_id
    JOIN nabd_member_alert_preferences a ON a.user_id=u.id
    WHERE u.status='active' AND u.verified_at IS NOT NULL
      AND u.notifications=1 AND u.recommendations=1
      AND a.signals_enabled=1
      AND ((?='XAUUSD' AND a.gold_enabled=1)
        OR (?='BTCUSD' AND a.btc_enabled=1))
    ORDER BY t.user_id LIMIT ?`,[p.symbol,p.symbol,maxRecipients])).rows;
  let attempted=0,sent=0;
  // Bounded concurrency and dedupe claim BEFORE network IO; failures are not blindly retried.
  for(let start=0;start<recipients.length;start+=3){
   const batch=recipients.slice(start,start+3);
   const results=await Promise.allSettled(batch.map(async recipient=>{
    // Re-evaluate current consent and chat binding atomically at claim time.
    // A preselected recipient may have disabled notices or unlinked Telegram.
    const claim=await store.query(`INSERT INTO nabd_member_telegram_deliveries
      (user_id,signal_id,symbol,status,claimed_at)
      SELECT t.user_id,?,?,'SENDING',?
      FROM nabd_member_telegram t
      JOIN nabd_users u ON u.id=t.user_id
      JOIN nabd_member_alert_preferences a ON a.user_id=u.id
      WHERE t.user_id=? AND t.chat_id=?
        AND u.status='active' AND u.verified_at IS NOT NULL
        AND u.notifications=1 AND u.recommendations=1 AND a.signals_enabled=1
        AND ((?='XAUUSD' AND a.gold_enabled=1)
          OR (?='BTCUSD' AND a.btc_enabled=1))
      ON CONFLICT(user_id,signal_id) DO NOTHING
      RETURNING user_id`,
      [p.id,p.symbol,now,recipient.user_id,recipient.chat_id,p.symbol,p.symbol]);
    if(!claim.rows.length)return false;
    attempted++;
    let status='UNCERTAIN',messageId=null;
    try{
     const response=await fetcher('https://api.telegram.org/bot'+botToken+'/sendMessage',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({chat_id:recipient.chat_id,text:message(p),
       link_preview_options:{is_disabled:true}}),signal:AbortSignal.timeout(10000)});
     const data=await response.json();
     if(response.ok&&data?.ok===true&&Number.isSafeInteger(data?.result?.message_id)){
      status='SENT';messageId=data.result.message_id;sent++;
     }else if(data?.ok===false)status='FAILED';
    }catch{/* Network outcome uncertain: do not retry automatically. */}
    await store.query(`UPDATE nabd_member_telegram_deliveries
      SET status=?,completed_at=?,telegram_message_id=?
      WHERE user_id=? AND signal_id=? AND status='SENDING'`,
      [status,clock(),messageId,recipient.user_id,p.id]);
    return status==='SENT';
   }));
   // Failed database claims are not retried in this dispatch pass.
   if(results.some(x=>x.status==='rejected'))break;
  }
  return {attempted,sent,enabled:true};
 }
 return Object.freeze({publish,enabled:configured});
}
