import {randomUUID} from 'node:crypto';

// Stage-only durable stop intents. No worker consumes this table and no
// broker/MT5 command is issued by creating an intent.
const bad=(status,message)=>{throw Object.assign(Error(message),{status});};
const valid=(v)=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v);
export function createRiskStopIntents({store,clock=()=>Date.now()/1000}={}){
 if(!store?.query||!store?.transaction)throw Error('Account persistence required');
 const scope=async (q,ownerId,accountId)=>{
  const rows=(await q("SELECT id FROM nabd_member_mt5_accounts WHERE id=? AND user_id=? AND environment='demo'",[accountId,ownerId])).rows;
  if(rows.length!==1)bad(404,'Registered Demo account not found');
 };
 const output=row=>({requestId:row.id,accountId:row.account_id,symbol:row.symbol,
   requestedAt:Number(row.requested_at),status:'AWAITING_MT5_ACK',confirmedByMT5:false,
   executionStopped:false,closePositions:false});
 return {
  async request(ownerId,{accountId,symbol}={}){
   if(!valid(ownerId)||!valid(accountId)||!['XAUUSD','BTCUSD'].includes(symbol))
     bad(400,'Invalid Demo risk stop request');
   return store.transaction(async q=>{
     await scope(q,ownerId,accountId);
     // Repeated requests are idempotent: never erase an existing stop intent.
     const created=(await q(`INSERT INTO nabd_member_risk_stop_intents
       (id,account_id,symbol,user_id,requested_at,status)
       VALUES(?,?,?,?,?,'AWAITING_MT5_ACK')
       ON CONFLICT(account_id,symbol) DO NOTHING RETURNING id`,
       [randomUUID(),accountId,symbol,ownerId,clock()])).rows.length===1;
     const row=(await q(`SELECT id,account_id,symbol,requested_at FROM nabd_member_risk_stop_intents
       WHERE account_id=? AND symbol=? AND user_id=?`,[accountId,symbol,ownerId])).rows[0];
     if(!row)bad(409,'Risk stop request unavailable');
     if(created)await q('INSERT INTO nabd_auth_audit(id,time,actor,event,subject) VALUES(?,?,?,?,?)',
       [randomUUID(),clock(),ownerId,'RISK_STOP_INTENT_STAGED',accountId]);
     return {...output(row),created};
   });
  },
  async list(ownerId){
    if(!valid(ownerId))bad(401,'Invalid account session');
    const rows=(await store.query(`SELECT i.id,i.account_id,i.symbol,i.requested_at FROM nabd_member_risk_stop_intents i
      JOIN nabd_member_mt5_accounts a ON a.id=i.account_id AND a.user_id=i.user_id
      WHERE i.user_id=? ORDER BY i.requested_at DESC`,[ownerId])).rows;
    return rows.map(output);
  }
 };
}
