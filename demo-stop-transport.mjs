import {randomUUID,createHash} from 'node:crypto';

// Demo PAUSE-only transport behind an explicit opt-in. Never grants an entry,
// resume, close, lot change, or order right. Acknowledgments report EA intent,
// NOT broker-confirmed execution or an actually observed terminal state.
const fail=(status,msg)=>{throw Object.assign(Error(msg),{status});};
const digest=s=>createHash('sha256').update(s).digest('hex');
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);
const tokenValid=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{43}$/.test(s);
const exactObject=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
 Object.keys(value).every(key=>keys.includes(key));
export function createDemoStopTransport({store,clock=()=>Date.now()/1000,enabled=false}={}){
 if(!store?.transaction||!store?.query)throw Error('Persistent storage required');
 const on=()=>{if(!enabled)fail(503,'Demo stop transport is disabled');};
 async function principal(q,credential,accountId){
   if(!tokenValid(credential)||!uuid(accountId))fail(401,'Invalid Demo stop executor token');
   const rows=(await q(`SELECT w.account_id,w.token_hash,a.broker,a.server_name,a.login,a.environment
      FROM nabd_mt5_stop_executors w
      JOIN nabd_member_mt5_accounts a ON a.id=w.account_id
      JOIN nabd_mt5_hosting_requests h ON h.account_id=a.id
      JOIN nabd_users u ON u.id=a.user_id
      WHERE w.account_id=? AND w.token_hash=? AND h.status='APPROVED'
        AND a.environment='demo' AND u.status='active' AND u.verified_at IS NOT NULL`,
        [accountId,digest(credential)])).rows[0];
   if(!rows)fail(401,'Invalid Demo stop executor token');
   return rows;
 }
 function identity(row,packet){
  if(packet.broker!==row.broker||packet.server!==row.server_name||
      packet.login!==row.login||packet.environment!=='demo'||packet.demo_mode!==true)
    fail(409,'MT5 Demo account identity mismatch');
 }
 const packetOK=packet=>exactObject(packet,[
  'accountId','broker','server','login','environment','demo_mode','requestId','symbol','persistedPaused'
 ])&&uuid(packet.accountId)&&typeof packet.login==='string'&&
  typeof packet.server==='string'&&typeof packet.broker==='string';
 return {
  async provision(q,accountId,token){
   on();if(!uuid(accountId)||!tokenValid(token))fail(400,'Invalid provision request');
   const account=(await q(`SELECT a.id FROM nabd_member_mt5_accounts a
     JOIN nabd_mt5_hosting_requests h ON h.account_id=a.id
     JOIN nabd_users u ON u.id=a.user_id
     WHERE a.id=? AND a.environment='demo' AND h.status='APPROVED'
     AND u.status='active' AND u.verified_at IS NOT NULL`,[accountId])).rows[0];
   if(!account)fail(409,'Approved verified Demo account required');
   await q(`INSERT INTO nabd_mt5_stop_executors(account_id,token_hash,provisioned_at)
     VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET
     token_hash=excluded.token_hash,provisioned_at=excluded.provisioned_at`,
     [accountId,digest(token),clock()]);
  },
  async poll(credential,packet){
   on();if(!packetOK(packet) || Object.keys(packet).some(key=>![
     'accountId','broker','server','login','environment','demo_mode'].includes(key)))
      fail(400,'Invalid scoped Demo stop poll');
   return store.transaction(async q=>{
     const row=await principal(q,credential,packet.accountId);identity(row,packet);
     const rows=(await q(`SELECT id,symbol FROM nabd_member_risk_stop_intents
       WHERE account_id=? AND status='AWAITING_MT5_ACK' ORDER BY requested_at ASC`,
       [packet.accountId])).rows;
     return {commands:rows.map(r=>({requestId:r.id,symbol:r.symbol,action:'PAUSE_NEW_ENTRIES_ONLY'})),
        executionEnabled:false,allowResume:false,allowOrders:false};
   });
  },
  async acknowledge(credential,packet){
   on();if(!packetOK(packet)||Object.keys(packet).some(key=>![
     'accountId','broker','server','login','environment','demo_mode','requestId','symbol','persistedPaused'].includes(key))||
     !uuid(packet.requestId)||!['XAUUSD','BTCUSD'].includes(packet.symbol)||
     packet.persistedPaused!==true)fail(400,'Invalid Demo stop acknowledgment');
   return store.transaction(async q=>{
     const row=await principal(q,credential,packet.accountId);identity(row,packet);
     const current=(await q(`SELECT id FROM nabd_member_risk_stop_intents
       WHERE id=? AND account_id=? AND symbol=? AND status='AWAITING_MT5_ACK'`,
       [packet.requestId,packet.accountId,packet.symbol])).rows[0];
     if(!current)fail(409,'Unknown or mismatched stop request');
     // Preserve pending status until an independent EA terminal-state verification.
     await q(`INSERT INTO nabd_mt5_stop_reports(request_id,account_id,symbol,reported_at)
       VALUES(?,?,?,?) ON CONFLICT(request_id) DO UPDATE SET reported_at=excluded.reported_at`,
       [packet.requestId,packet.accountId,packet.symbol,clock()]);
     return {reported:true,reportedState:'EA_PAUSE_REPORTED',brokerConfirmed:false,
       stopConfirmed:false,executionEnabled:false,resumeAllowed:false};
   });
  },
  async revoke(q,accountId){
   on();if(!uuid(accountId))fail(400,'Invalid account');
   const removed=(await q('DELETE FROM nabd_mt5_stop_executors WHERE account_id=? RETURNING account_id',[accountId])).rows;
   if(!removed.length)fail(404,'Stop executor not found');
  }
 };
}
