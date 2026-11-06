/* NABD Performance Center — broker-deal evidence, not signal tracking.
 * Build read-only statistics from closed, source-bound MT5 positions.
 * No synthetic trades, account IDs, balances, deposits or trading commands. */
export const PERFORMANCE_SYMBOLS=Object.freeze(['ALL','XAUUSD','BTCUSD']);
export const PERFORMANCE_MODES=Object.freeze(['ALL','DEMO','LIVE']);
export const PERFORMANCE_PERIODS=Object.freeze(['ALL','7D','30D','90D']);
const VALID_SYMBOLS=new Set(PERFORMANCE_SYMBOLS.slice(1));
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const validId=v=>(typeof v==='string'&&/^[1-9][0-9]{0,19}$/.test(v))||
  (typeof v==='number'&&Number.isSafeInteger(v)&&v>0);
const id=v=>String(v);
const round=(n,places=4)=>finite(n)?Number(n.toFixed(places)):null;
const timeKey=seconds=>new Date(seconds*1000).toISOString().slice(0,10);
const weekKey=seconds=>{
 const date=new Date(seconds*1000),day=date.getUTCDay()||7;
 date.setUTCDate(date.getUTCDate()+1-day);
 return date.toISOString().slice(0,10);
};
const currencyOf=source=>typeof source?.account?.currency==='string'&&
  /^[A-Z]{3}$/.test(source.account.currency)?source.account.currency:null;
const modeOf=source=>typeof source?.execution?.demo==='boolean'?
 (source.execution.demo?'DEMO':'LIVE'):null;

export function validatePerformanceFilters({symbol='ALL',mode='ALL',period='ALL'}={}){
 if(!PERFORMANCE_SYMBOLS.includes(symbol)||!PERFORMANCE_MODES.includes(mode)||
    !PERFORMANCE_PERIODS.includes(period))throw new RangeError('Invalid performance filter');
 return {symbol,mode,period};
}
export function verifiedClosedPositions({symbol,deals=[],positions=[],mode=null,currency=null,now=Date.now()/1000}={}){
 if(!VALID_SYMBOLS.has(symbol))throw new RangeError('Invalid broker symbol');
 if(!['DEMO','LIVE'].includes(mode)||!currency||
   !Array.isArray(deals)||!Array.isArray(positions))return {trades:[],excluded:0,scopeAvailable:false};
 const byTicket=new Map();
 let rejected=0;
 for(const deal of deals){
  if(!deal||!validId(deal.ticket)||!validId(deal.position_id)||
     !finite(deal.time)||deal.time<=0||deal.time>now+5 ||
     !['IN','OUT','OUT_BY','INOUT'].includes(deal.entry_type) ||
     ![deal.volume,deal.price,deal.profit,deal.commission,deal.swap,deal.fee].every(finite) ||
     deal.volume<=0||deal.price<=0){
   rejected++;continue;
  }
  if(!byTicket.has(id(deal.ticket)))byTicket.set(id(deal.ticket),deal);
 }
 const open=new Set(positions.map(p=>p?.position_id||p?.ticket).filter(validId).map(id));
 const grouped=new Map();
 for(const d of [...byTicket.values()].sort((a,b)=>a.time-b.time)){
  const key=id(d.position_id);
  if(!grouped.has(key))grouped.set(key,{entry:0,exit:0,net:0,exitAt:null,invalid:false});
  const p=grouped.get(key);
  if(d.entry_type==='INOUT'){p.invalid=true;continue;}
  if(d.entry_type==='IN')p.entry+=d.volume;
  else{p.exit+=d.volume;p.exitAt=Math.max(p.exitAt||0,d.time);}
  p.net+=d.profit+d.commission+d.swap+d.fee;
 }
 const trades=[];
 for(const [positionId,p]of grouped){
  const tolerance=Math.max(1e-7,p.entry*1e-6);
  if(p.invalid||open.has(positionId)||p.entry<=0||p.exitAt===null||
     p.exit<p.entry-tolerance||p.exit>p.entry+tolerance||!finite(p.net)) {
    rejected++;continue;
  }
  trades.push({symbol,mode,currency,closed_at:Math.floor(p.exitAt),
    net:round(p.net,6),strategy:null,riskReward:null});
 }
 trades.sort((a,b)=>a.closed_at-b.closed_at);
 return {trades,excluded:rejected,scopeAvailable:true};
}
function summarize(trades,mixedCurrency){
 const winners=trades.filter(t=>t.net>0),losers=trades.filter(t=>t.net<0);
 const breakeven=trades.length-winners.length-losers.length;
 const grossProfit=winners.reduce((s,t)=>s+t.net,0);
 const grossLoss=-losers.reduce((s,t)=>s+t.net,0);
 const allNet=trades.reduce((s,t)=>s+t.net,0);
 const curve=[{date:null,pnl:0}];let running=0,high=0,dd=0;
 for(const trade of trades){
  running+=trade.net;high=Math.max(high,running);dd=Math.max(dd,high-running);
  curve.push({date:trade.closed_at,pnl:round(running)});
 }
 const daily=new Map(),weekly=new Map(),monthly=new Map();
 for(const trade of trades){
  for(const [map,key]of [[daily,timeKey(trade.closed_at)],
    [weekly,weekKey(trade.closed_at)],[monthly,timeKey(trade.closed_at).slice(0,7)]]){
   map.set(key,(map.get(key)||0)+trade.net);
  }
 }
 const makeSeries=map=>[...map].sort((a,b)=>a[0].localeCompare(b[0]))
  .map(([period,pnl])=>({period,pnl:round(pnl)}));
 const valuesAvailable=trades.length>0&&!mixedCurrency;
 return {
  count:trades.length,wins:winners.length,losses:losers.length,breakeven,
  winRatePercent:trades.length?round(100*winners.length/trades.length,2):null,
  net:valuesAvailable?round(allNet):null,
  averageWin:valuesAvailable&&winners.length?round(grossProfit/winners.length):null,
  averageLoss:valuesAvailable&&losers.length?round(-grossLoss/losers.length):null,
  profitFactor:valuesAvailable&&grossLoss>0?round(grossProfit/grossLoss,3):null,
  maxClosedPnlDrawdown:valuesAvailable?round(dd):null,
  averageRiskReward:null,
  equityCurve:valuesAvailable?curve:[],
  daily:valuesAvailable?makeSeries(daily):[],
  weekly:valuesAvailable?makeSeries(weekly):[],
  monthly:valuesAvailable?makeSeries(monthly):[],
  sampleStart:trades.length?trades[0].closed_at:null,
  sampleEnd:trades.length?trades.at(-1).closed_at:null,
  methodology:{
   winRate:'Profitable closed positions / all fully closed positions (breakeven included).',
   net:'Sum of broker profit, commission, swap and fees for fully closed positions.',
   profitFactor:'Positive position P&L / absolute negative position P&L. Undefined when no losses.',
   maxDrawdown:'Largest peak-to-trough decline in cumulative closed-position P&L; not account equity drawdown.',
   averageRiskReward:'Not available: verified initial per-trade risk is not present in the current MT5 deal feed.',
   equityCurve:'Cumulative closed-position P&L starting at zero, not actual account balance/equity.',
   scope:'Only broker-supplied, fully closed positions; incomplete, partial, reversed or open trades excluded.'
  }
 };
}
export function buildPerformanceCenter({sources=[],filters={},now=Date.now()/1000}={}){
 const {symbol,mode,period}=validatePerformanceFilters(filters);
 const after={'ALL':0,'7D':now-7*86400,'30D':now-30*86400,'90D':now-90*86400}[period];
 const included=[],evidence=[],excluded=[];
 for(const src of sources){
  if(!VALID_SYMBOLS.has(src?.symbol))continue;
  const sourceMode=modeOf(src),currency=currencyOf(src);
  const record={symbol:src.symbol,mode:sourceMode,currency,
   lastSnapshotAt:finite(src.received_at)?src.received_at:null,
   sourceIsBroker:Boolean(src.account&&src.execution&&Array.isArray(src.deals))};
  evidence.push(record);
  if(!record.sourceIsBroker||!sourceMode||!currency){
   excluded.push({symbol:src.symbol,reason:'UNVERIFIED_SOURCE_OR_ACCOUNT_MODE'});continue;
  }
  const result=verifiedClosedPositions({symbol:src.symbol,deals:src.deals,
   positions:src.positions||[],mode:sourceMode,currency,now});
  if(result.excluded)excluded.push({symbol:src.symbol,reason:'INCOMPLETE_OR_INVALID_DEAL_RECORDS',count:result.excluded});
  included.push(...result.trades.filter(t=>t.closed_at>=after));
 }
 const selected=included.filter(t=>(symbol==='ALL'||symbol===t.symbol)&&(mode==='ALL'||mode===t.mode))
  .sort((a,b)=>a.closed_at-b.closed_at||a.symbol.localeCompare(b.symbol));
 const currencies=[...new Set(selected.map(t=>t.currency))];
 const accountModes=[...new Set(selected.map(t=>t.mode))];
 const mixedCurrency=currencies.length>1,mixedMode=accountModes.length>1;
 const bySymbol=Object.fromEntries(['XAUUSD','BTCUSD'].map(x=>{
  const rows=selected.filter(t=>t.symbol===x),modes=[...new Set(rows.map(t=>t.mode))];
  const differentCurrencies=new Set(rows.map(t=>t.currency)).size>1;
  return [x,{currency:differentCurrencies||modes.length>1?null:rows[0]?.currency||null,mode:modes,
   ...summarize(rows,differentCurrencies||modes.length>1)}];
 }));
 return {
  kind:'MT5_FULLY_CLOSED_POSITIONS_ONLY',privacy:'OPERATOR_ONLY',verified:true,
  filters:{symbol,mode,period},currency:mixedCurrency||mixedMode?null:currencies[0]||null,
  mixedCurrency,mixedMode,evidence,excluded,summary:summarize(selected,mixedCurrency||mixedMode),
  bySymbol,generatedAt:Math.floor(now),
  incompleteHistory:true,realAccountEquityAvailable:false,
  disclaimer:'Past performance does not guarantee future returns. No hypothetical signal wins, subscriptions or unverified broker orders are included. The available broker record may be incomplete.'
 };
}
