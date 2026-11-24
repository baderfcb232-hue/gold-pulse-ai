// Prospective shadow simulation only. No broker calls or position instructions.
// Fixed-horizon executable quote returns, not intrabar SL/TP or actual account P&L.
import {createHash} from 'node:crypto';
const symbols=['XAUUSD','BTCUSD'];
const positive=x=>Number.isFinite(x)&&x>0;
const epoch=x=>Number.isSafeInteger(x)&&x>0;
const fingerprint=q=>typeof q?.brokerServer==='string'&&q.brokerServer.toLowerCase().includes('demo')&&!q.brokerServer.toLowerCase().includes('synthetic')&&typeof q.brokerSymbol==='string'&&q.brokerSymbol.length>0&&epoch(q.accountLogin)?createHash('sha256').update(JSON.stringify([q.brokerServer,q.brokerSymbol,q.accountLogin])).digest('hex'):null;
const verified=(q,now)=>q?.environment==='EXPERIMENTAL_NABD_AGENTIC'&&q.accountType==='DEMO'&&q.executionEnabled===false&&symbols.includes(q.symbol)&&epoch(q.timestamp)&&q.timestamp<=now&&now-q.timestamp<=5&&positive(q.bid)&&positive(q.ask)&&q.ask>q.bid&&!!fingerprint(q);
export function paperOutcome({stance,entryBid,entryAsk,exitBid,exitAsk,riskDistance,commissionR=.05,slippageFraction=.1}={}){
 if(!['BUY_WATCH','SELL_WATCH','WAIT'].includes(stance)||![entryBid,entryAsk,exitBid,exitAsk,riskDistance].every(positive)||entryAsk<=entryBid||exitAsk<=exitBid||!Number.isFinite(commissionR)||commissionR<0||!Number.isFinite(slippageFraction)||slippageFraction<0)throw Error('INVALID_PAPER_OUTCOME');
 const friction=slippageFraction*((entryAsk-entryBid)+(exitAsk-exitBid))/riskDistance+commissionR;
 return {buyR:(exitBid-entryAsk)/riskDistance-friction,sellR:(entryBid-exitAsk)/riskDistance-friction,
  netR:stance==='WAIT'?null:stance==='BUY_WATCH'?(exitBid-entryAsk)/riskDistance-friction:(entryBid-exitAsk)/riskDistance-friction};
}
export function createProfitabilityStore({query,clock=()=>Math.floor(Date.now()/1000)}){
 async function save({symbol,closedBarTime,plan,features,broker}={}){
  const now=clock(),atr=features?.M5?.atr14;
  if(!verified(broker,now)||broker.symbol!==symbol||!epoch(closedBarTime)||closedBarTime+300>now||now-closedBarTime>750||!positive(atr)||!['BUY_WATCH','SELL_WATCH','WAIT'].includes(plan?.stance)||!Number.isFinite(plan.confidence)||plan.confidence<0||plan.confidence>1||!Number.isInteger(plan.timeHorizonMinutes)||plan.timeHorizonMinutes<1||plan.timeHorizonMinutes>60)return {inserted:false,reason:'INVALID_PAPER_BASELINE'};
  const spread=broker.ask-broker.bid;
  if(spread>atr*.25||spread>(symbol==='XAUUSD'?2.5:80))return {inserted:false,reason:'PAPER_SPREAD_LIMIT'};
  const r=await query(`INSERT INTO agentic_research.ai_paper_outcomes
   (symbol,bar_at,anchor_at,tick_at,due_at,feed_fingerprint,stance,confidence,entry_bid,entry_ask,risk_distance)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING RETURNING symbol`,
   [symbol,closedBarTime,now,broker.timestamp,now+plan.timeHorizonMinutes*60,fingerprint(broker),plan.stance,plan.confidence,broker.bid,broker.ask,Math.max(1.5*atr,4*spread)]);
  return {inserted:r.rowCount===1};
 }
 async function observe(q){
  const now=clock();if(!verified(q,now))return {scored:0,expired:0};
  const r=await query(`UPDATE agentic_research.ai_paper_outcomes SET
   state=CASE WHEN $3<=due_at+120 THEN 'SCORED' ELSE 'EXPIRED' END,
   exit_at=$3,exit_bid=CASE WHEN $3<=due_at+120 THEN $4::double precision ELSE NULL END,
   exit_ask=CASE WHEN $3<=due_at+120 THEN $5::double precision ELSE NULL END
   WHERE symbol=$1 AND feed_fingerprint=$2 AND state='PENDING' AND $3>=due_at AND $3>tick_at RETURNING state`,[q.symbol,fingerprint(q),q.timestamp,q.bid,q.ask]);
  return {scored:r.rows.filter(x=>x.state==='SCORED').length,expired:r.rows.filter(x=>x.state==='EXPIRED').length};
 }
 async function report(){
  const r=await query(`SELECT symbol,stance,state,entry_bid,entry_ask,exit_bid,exit_ask,risk_distance,anchor_at,exit_at FROM agentic_research.ai_paper_outcomes ORDER BY anchor_at DESC,symbol LIMIT 2000`,[]);
  const markets={};
  for(const symbol of symbols){
   const rows=r.rows.filter(x=>x.symbol===symbol),scored=rows.filter(x=>x.state==='SCORED');
   let grossProfitR=0,grossLossR=0,wait=0,waitBothNegative=0,waitEitherPositive=0,wins=0,trades=0;
   for(const x of scored){
    const o=paperOutcome({stance:x.stance,entryBid:Number(x.entry_bid),entryAsk:Number(x.entry_ask),exitBid:Number(x.exit_bid),exitAsk:Number(x.exit_ask),riskDistance:Number(x.risk_distance)});
    if(o.netR===null){wait++;if(o.buyR<=0&&o.sellR<=0)waitBothNegative++;if(o.buyR>0||o.sellR>0)waitEitherPositive++;continue;}
    trades++;if(o.netR>0){wins++;grossProfitR+=o.netR;}else grossLossR-=o.netR;
   }
   markets[symbol]={recorded:rows.length,pending:rows.filter(x=>x.state==='PENDING').length,expired:rows.filter(x=>x.state==='EXPIRED').length,scored:scored.length,directionalSamples:trades,wins,
    netR:grossProfitR-grossLossR,profitFactor:trades>=30&&grossLossR>0?grossProfitR/grossLossR:null,minimumSamples:30,wait,waitBothNegative,waitEitherPositive};
  }
  return {version:'AI_PAPER_FIXED_HORIZON_V1',markets,retainedWindow:2000,commissionAssumedR:.05,slippageAssumedSpreadFractionPerSide:.1,spreadIncluded:true,actualBrokerProfitability:false,slTpSimulated:false,portfolioDrawdownMeasured:false,overlappingSamplesPossible:true,waitCounterfactualUsesBothDirections:true,waitCounterfactualNotTradableStrategy:true,executionPermission:false,ordersCreated:0};
 }
 return {save,observe,report};
}
