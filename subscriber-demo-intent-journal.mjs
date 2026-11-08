/**
 * NABD Phase 14: isolated PostgreSQL reservation journal for subscriber Demo intents.
 * Intentionally NOT wired to website routes, Windows, broker or existing operator journal.
 * All records remain NON_EXECUTABLE. Never treat a reservation as a broker fill.
 */
const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SIG=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const STATUS=Object.freeze(['RESERVED','CANCELLED']);
const fail=()=>{throw new Error('Invalid subscriber Demo reservation');};
export const SUBSCRIBER_DEMO_SCHEMA=`
CREATE TABLE IF NOT EXISTS nabd_subscriber_demo_intents (
 account_id text NOT NULL,
 signal_id text NOT NULL,
 owner_id text NOT NULL,
 broker text NOT NULL CHECK (broker = 'JustMarkets'),
 environment text NOT NULL CHECK (environment = 'demo'),
 symbol text NOT NULL CHECK (symbol IN ('XAUUSD', 'BTCUSD')),
 side text NOT NULL CHECK (side IN ('BUY', 'SELL')),
 status text NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED','CANCELLED')),
 created_at_ms bigint NOT NULL,
 expires_at_ms bigint NOT NULL,
 cancelled_at_ms bigint,
 PRIMARY KEY (account_id, signal_id),
 CHECK (expires_at_ms > created_at_ms)
);
CREATE INDEX IF NOT EXISTS nabd_subscriber_demo_owner_idx
 ON nabd_subscriber_demo_intents(owner_id, created_at_ms DESC);
`;
const assertText=(x,re)=>typeof x==='string'&&re.test(x);
const assertInputs=({accountId,signalId,ownerId,symbol,side,createdAtMs,expiresAtMs,policy})=>{
 if(!assertText(accountId,ID)||!assertText(signalId,SIG)||
    !assertText(ownerId,/^[A-Za-z0-9_-]{1,128}$/)||
    !['XAUUSD','BTCUSD'].includes(symbol)||!['BUY','SELL'].includes(side)||
    !Number.isSafeInteger(createdAtMs)||createdAtMs<=0||
    !Number.isSafeInteger(expiresAtMs)||expiresAtMs<=createdAtMs||
    expiresAtMs-createdAtMs>30000||
    policy?.allowed!==true||policy?.dedupeKey!==accountId+':'+signalId||
    policy?.reason!=='DEMO_POLICY_OK') fail();
};
/** pool must be an authorized pg Pool, never a client-controlled connection. */
export function subscriberDemoIntentJournal(pool){
 if(!pool||typeof pool.query!=='function')fail();
 return Object.freeze({
   initialize:()=>pool.query(SUBSCRIBER_DEMO_SCHEMA),
   /** Call ONLY after owner/worker/grant have been revalidated against server-side DB state. */
   async reserve(input){
     assertInputs(input);
     const {accountId,signalId,ownerId,symbol,side,createdAtMs,expiresAtMs}=input;
     // Atomic database uniqueness; duplicates do NOT create a new reservation.
     const r=await pool.query(`INSERT INTO nabd_subscriber_demo_intents
       (account_id,signal_id,owner_id,broker,environment,symbol,side,created_at_ms,expires_at_ms)
       VALUES ($1,$2,$3,'JustMarkets','demo',$4,$5,$6,$7)
       ON CONFLICT (account_id,signal_id) DO NOTHING
       RETURNING account_id,signal_id,status`,
       [accountId,signalId,ownerId,symbol,side,createdAtMs,expiresAtMs]);
     return Object.freeze({created:r.rows.length===1,status:r.rows.length===1?'RESERVED':'DUPLICATE'});
   },
   /** Only caller-authenticated owner IDs; no global list or browser-supplied owner. */
   async listByOwner(trustedOwnerId){
     if(!assertText(trustedOwnerId,/^[A-Za-z0-9_-]{1,128}$/))fail();
     const r=await pool.query(`SELECT account_id,signal_id,symbol,side,status,created_at_ms,expires_at_ms
       FROM nabd_subscriber_demo_intents WHERE owner_id=$1
       ORDER BY created_at_ms DESC LIMIT 100`,[trustedOwnerId]);
     return r.rows;
   },
   /** Fail-safe administrative cancellation; no dispatch path exists. */
   async cancel({accountId,signalId,ownerId,nowMs}){
     if(!assertText(accountId,ID)||!assertText(signalId,SIG)||
       !assertText(ownerId,/^[A-Za-z0-9_-]{1,128}$/)||
       !Number.isSafeInteger(nowMs)||nowMs<=0)fail();
     const r=await pool.query(`UPDATE nabd_subscriber_demo_intents
       SET status='CANCELLED', cancelled_at_ms=$4
       WHERE account_id=$1 AND signal_id=$2 AND owner_id=$3 AND status='RESERVED'
       RETURNING account_id`,[accountId,signalId,ownerId,nowMs]);
     return r.rows.length===1;
   },
   permittedStatuses:STATUS,
   executionEnabled:false
 });
}
