// Phase 12: owner/account-scoped, persisted DEMO policy preferences.
// Staging only. No entry dispatcher or MT5 EA consumes these settings yet.
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const keys=['riskPercent','maxDailyLoss','maxDailyTrades','maxOpenPositions','maxSpread','maxSlippage','quoteMaxAgeSeconds'];
export function validateRiskPreferences(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['accountId','symbol','paused',...keys].includes(k)))
    fail(400,'Invalid risk preferences');
  if(typeof input.accountId!=='string'||!/^[a-f0-9-]{36}$/.test(input.accountId)||
     !['XAUUSD','BTCUSD'].includes(input.symbol)||typeof input.paused!=='boolean')
    fail(400,'Invalid account, market, or stop state');
  for(const k of keys)if(typeof input[k]!=='number'||!Number.isFinite(input[k]))
    fail(400,'Missing or invalid risk limit');
  if(input.riskPercent<=0||input.riskPercent>2||input.maxDailyLoss<=0||input.maxDailyLoss>10||
    !Number.isSafeInteger(input.maxDailyTrades)||input.maxDailyTrades<1||input.maxDailyTrades>100||
    !Number.isSafeInteger(input.maxOpenPositions)||input.maxOpenPositions<1||input.maxOpenPositions>20||
    input.maxSpread<0||input.maxSpread>100000||
    input.maxSlippage<0||input.maxSlippage>100000||
    input.quoteMaxAgeSeconds<=0||input.quoteMaxAgeSeconds>60)
    fail(400,'Risk preference outside accepted validation range');
  return Object.fromEntries(['accountId','symbol','paused',...keys].map(k=>[k,input[k]]));
}
export function createRiskPreferences({store,clock=()=>Date.now()/1000}){
  if(!store?.transaction||!store?.query)throw Error('Persistent store required');
  async function owned(query,userId,accountId){
    const account=(await query("SELECT id FROM nabd_member_mt5_accounts WHERE id=? AND user_id=? AND environment='demo'",[accountId,userId])).rows[0];
    if(!account)fail(404,'Demo account not found');
  }
  return {
    async list(userId){
      const rows=(await store.query(`SELECT p.* FROM nabd_member_risk_preferences p
        JOIN nabd_member_mt5_accounts a ON a.id=p.account_id
        WHERE a.user_id=? ORDER BY p.updated_at DESC`,[userId])).rows;
      return rows.map(row=>({accountId:row.account_id,symbol:row.symbol,paused:Boolean(row.paused),
        riskPercent:Number(row.risk_percent),maxDailyLoss:Number(row.max_daily_loss),
        maxDailyTrades:Number(row.max_daily_trades),maxOpenPositions:Number(row.max_open_positions),
        maxSpread:Number(row.max_spread),maxSlippage:Number(row.max_slippage),
        quoteMaxAgeSeconds:Number(row.quote_max_age_seconds),updatedAt:Number(row.updated_at),
        connectedToExecution:false}));
    },
    async save(userId,input){
      const p=validateRiskPreferences(input);
      return store.transaction(async q=>{
        await owned(q,userId,p.accountId);
        await q(`INSERT INTO nabd_member_risk_preferences
          (account_id,symbol,paused,risk_percent,max_daily_loss,max_daily_trades,max_open_positions,max_spread,max_slippage,quote_max_age_seconds,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(account_id,symbol) DO UPDATE SET
          paused=excluded.paused,risk_percent=excluded.risk_percent,max_daily_loss=excluded.max_daily_loss,
          max_daily_trades=excluded.max_daily_trades,max_open_positions=excluded.max_open_positions,
          max_spread=excluded.max_spread,max_slippage=excluded.max_slippage,
          quote_max_age_seconds=excluded.quote_max_age_seconds,updated_at=excluded.updated_at`,
          [p.accountId,p.symbol,p.paused?1:0,p.riskPercent,p.maxDailyLoss,p.maxDailyTrades,p.maxOpenPositions,p.maxSpread,p.maxSlippage,p.quoteMaxAgeSeconds,clock()]);
        await q('INSERT INTO nabd_auth_audit(id,time,actor,event,subject) VALUES(?,?,?,?,?)',
          [cryptoRandom(),clock(),userId,p.paused?'RISK_PREFS_STAGED_PAUSED':'RISK_PREFS_STAGED_UPDATED',p.accountId]);
        return {saved:true,connectedToExecution:false,pausedPreference:p.paused};
      });
    }
  };
}
import {randomUUID as cryptoRandom} from 'node:crypto';
