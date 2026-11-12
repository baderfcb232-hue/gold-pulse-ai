/**
 * NABD phase 15: dormant, account-scoped Demo execution consent registry.
 * This is NOT an authorization API: all methods require a trusted server-side
 * caller that already verified session, owner, MFA, account and legal consent.
 * No trading worker, execution endpoint, MT5 broker credential or dispatch.
 */
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const OWNER=/^[A-Za-z0-9_-]{1,128}$/;
const invalid=()=>{throw Error('Invalid subscriber Demo consent request');};
const validId=v=>typeof v==='string'&&UUID.test(v);
const validOwner=v=>typeof v==='string'&&OWNER.test(v);
const validTime=v=>Number.isSafeInteger(v)&&v>0;
export const SUBSCRIBER_DEMO_GRANT_SCHEMA=`
CREATE TABLE IF NOT EXISTS nabd_subscriber_demo_grants (
 account_id text PRIMARY KEY REFERENCES nabd_member_mt5_accounts(id) ON DELETE CASCADE,
 owner_id text NOT NULL REFERENCES nabd_users(id) ON DELETE CASCADE,
 scope text NOT NULL CHECK (scope='demo-execute'),
 status text NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
 issued_at_ms bigint NOT NULL,
 expires_at_ms bigint NOT NULL,
 revoked_at_ms bigint,
 consent_version text NOT NULL,
 CHECK (expires_at_ms > issued_at_ms),
 CHECK ((status='REVOKED') = (revoked_at_ms IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS nabd_subscriber_demo_grants_owner_idx
 ON nabd_subscriber_demo_grants(owner_id);
`;
/** Passing a pool here does not initialize the schema until initialize is called. */
export function subscriberDemoGrantStore(pool){
 if(!pool||typeof pool.query!=='function')invalid();
 return Object.freeze({
  initialize:()=>pool.query(SUBSCRIBER_DEMO_GRANT_SCHEMA),
  /** Non-browser trusted verification required. This method never grants by itself. */
  async issue({accountId,ownerId,issuedAtMs,expiresAtMs,consentVersion,verifiedByServer}={}){
   if(!validId(accountId)||!validOwner(ownerId)||!validTime(issuedAtMs)||
      !validTime(expiresAtMs)||expiresAtMs<=issuedAtMs||
      expiresAtMs-issuedAtMs>86400000||
      typeof consentVersion!=='string'||!/^v[1-9][0-9]{0,3}$/.test(consentVersion)||
      verifiedByServer!==true)invalid();
   // Never upsert or silently re-enable a previously revoked grant.
   // Issuance should be in an authenticated owner transaction before activation.
   const r=await pool.query(`
     INSERT INTO nabd_subscriber_demo_grants
       (account_id,owner_id,scope,status,issued_at_ms,expires_at_ms,consent_version)
     SELECT a.id,a.user_id,'demo-execute','ACTIVE',$3,$4,$5
     FROM nabd_member_mt5_accounts a
     JOIN nabd_users u ON u.id=a.user_id
     JOIN nabd_mt5_hosting_requests h ON h.account_id=a.id
     WHERE a.id=$1 AND a.user_id=$2 AND a.environment='demo'
       AND a.broker='JustMarkets' AND u.status='active'
       AND u.verified_at IS NOT NULL AND h.status='APPROVED'
     ON CONFLICT (account_id) DO NOTHING
     RETURNING account_id`,[accountId,ownerId,issuedAtMs,expiresAtMs,consentVersion]);
   return Object.freeze({created:r.rows.length===1});
  },
  /** Revocation is irreversible for this grant row; independent of worker availability. */
  async revoke({accountId,ownerId,nowMs}={}){
   if(!validId(accountId)||!validOwner(ownerId)||!validTime(nowMs))invalid();
   const r=await pool.query(`
     UPDATE nabd_subscriber_demo_grants
       SET status='REVOKED',revoked_at_ms=$3
     WHERE account_id=$1 AND owner_id=$2 AND status='ACTIVE'
     RETURNING account_id`,[accountId,ownerId,nowMs]);
   return Object.freeze({revoked:r.rows.length===1});
  },
  /** Server-derived identity only; not a browser-submitted owner identifier. */
  async getActive({accountId,ownerId,nowMs}={}){
   if(!validId(accountId)||!validOwner(ownerId)||!validTime(nowMs))invalid();
   const r=await pool.query(`
     SELECT g.account_id,g.owner_id,g.scope,g.expires_at_ms
     FROM nabd_subscriber_demo_grants g
     JOIN nabd_member_mt5_accounts a ON a.id=g.account_id AND a.user_id=g.owner_id
     JOIN nabd_users u ON u.id=a.user_id
     JOIN nabd_mt5_hosting_requests h ON h.account_id=a.id
     WHERE g.account_id=$1 AND g.owner_id=$2 AND g.status='ACTIVE'
       AND g.expires_at_ms>$3 AND a.environment='demo' AND a.broker='JustMarkets'
       AND u.status='active' AND u.verified_at IS NOT NULL AND h.status='APPROVED'
     LIMIT 1`,[accountId,ownerId,nowMs]);
   const row=r.rows[0];return row?Object.freeze({
    accountId:row.account_id,ownerId:row.owner_id,scope:row.scope,
    expiresAtMs:Number(row.expires_at_ms),authorized:true,revoked:false
   }):null;
  },
  executionEnabled:false
 });
}
