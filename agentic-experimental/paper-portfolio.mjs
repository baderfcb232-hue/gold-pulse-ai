// Pure paper simulation. No broker calls. A gap invalidates forward evidence;
// no assumed fills inside unobserved intervals. Freeze the cohort on such a gap.
import {createHash} from 'node:crypto';
const symbols=['XAUUSD','BTCUSD'];
const finite=Number.isFinite, pos=x=>finite(x)&&x>0;
const epoch=x=>Number.isSafeInteger(x)&&x>0;
const identity=q=>typeof q?.brokerServer==='string'&&q.brokerServer.toLowerCase().includes('demo')&&!q.brokerServer.toLowerCase().includes('synthetic')&&typeof q.brokerSymbol==='string'&&q.brokerSymbol.length>0&&epoch(q.accountLogin)?createHash('sha256').update(JSON.stringify([q.brokerServer,q.brokerSymbol,q.accountLogin])).digest('hex'):null;
function valid(q,now){return q?.environment==='EXPERIMENTAL_NABD_AGENTIC'&&q.accountType==='DEMO'&&q.executionEnabled===false&&symbols.includes(q.symbol)&&epoch(q.timestamp)&&q.timestamp<=now&&now-q.timestamp<=5&&pos(q.bid)&&pos(q.ask)&&q.ask>q.bid&&identity(q);}
export const POLICY=Object.freeze({version:'V5_PAPER_PORTFOLIO_1',initial:2000,risk:.004,rr:3,cap:2,btcDailyCap:6,feeR:.05,slipSpread:.1,confidenceFloor:.82,maxGap:30});
export function initialPortfolio(symbol){
 if(!symbols.includes(symbol))throw Error('INVALID_SYMBOL');
 return {version:POLICY.version,symbol,balance:2000,equity:2000,peakEquity:2000,maxDrawdown:0,peakBalance:2000,maxRealizedDrawdown:0,positions:[],feed:null,lastTick:0,lastBar:0,day:-1,entriesToday:0,closed:0,wins:0,grossProfit:0,grossLoss:0,stopHits:0,targetHits:0,timeExits:0,gaps:0,frozen:false,firstEntryAt:null,lastCloseAt:null};
}
const pnl=(p,q)=>p.units*(p.side*( (p.side===1?q.bid:q.ask)-p.entry)-POLICY.slipSpread*(q.ask-q.bid))-p.fee;
function mark(s,q){
 s.equity=s.balance+s.positions.reduce((a,p)=>a+pnl(p,q),0);
 s.peakEquity=Math.max(s.peakEquity,s.equity);
 s.maxDrawdown=Math.max(s.maxDrawdown,1-s.equity/s.peakEquity);
 s.peakBalance=Math.max(s.peakBalance,s.balance);
 s.maxRealizedDrawdown=Math.max(s.maxRealizedDrawdown,1-s.balance/s.peakBalance);
}
export function advancePortfolio(state,q,now){
 const s=structuredClone(state);
 if(!valid(q,now)||q.symbol!==s.symbol||s.frozen||q.timestamp<=s.lastTick)return s;
 const feed=identity(q);
 if(s.feed&&s.feed!==feed){if(s.positions.length){s.frozen=true;s.gaps++;}return s;}
 if(s.positions.length&&q.timestamp-s.lastTick>POLICY.maxGap){s.frozen=true;s.gaps++;return s;}
 s.feed=feed;s.lastTick=q.timestamp;
 const keep=[];
 for(const p of s.positions){
  const px=p.side===1?q.bid:q.ask;
  const stop=p.side*(px-p.stop)<=0,target=p.side*(px-p.target)>=0;
  const reason=stop?'SL':target?'TP':q.timestamp>=p.due?'TIME':null;
  if(!reason){keep.push(p);continue;}
  // Stop fills at the observed adverse quote, not a guaranteed stop price.
  // Limit target never earns an optimistic improvement beyond its limit.
  const raw=reason==='TP'?p.target:px;
  const net=p.units*(p.side*(raw-p.entry)-POLICY.slipSpread*(q.ask-q.bid))-p.fee;
  s.balance+=net;s.closed++;s.lastCloseAt=q.timestamp;
  if(net>0){s.wins++;s.grossProfit+=net;}else s.grossLoss-=net;
  if(reason==='SL')s.stopHits++;else if(reason==='TP')s.targetHits++;else s.timeExits++;
 }
 s.positions=keep;mark(s,q);return s;
}
export function enterPortfolio(state,{plan,features,broker:q,closedBarTime},now){
 let s=advancePortfolio(state,q,now);
 const no=reason=>({state:s,entered:false,reason});
 if(!valid(q,now)||q.symbol!==s.symbol||s.frozen||s.feed!==identity(q)||q.timestamp!==s.lastTick)return no('UNVERIFIED_OR_FROZEN');
 if(!epoch(closedBarTime)||closedBarTime+300>now||now-closedBarTime>750||closedBarTime<=s.lastBar)return no('BAR_INVALID_OR_DUPLICATE');
 s.lastBar=closedBarTime;
 if(!['BUY_WATCH','SELL_WATCH'].includes(plan?.stance))return no('WAIT');
 if(!finite(plan.confidence)||plan.confidence<POLICY.confidenceFloor||plan.confidence>1)return no('LOW_CONFIDENCE');
 if(!Number.isInteger(plan.timeHorizonMinutes)||plan.timeHorizonMinutes<1||plan.timeHorizonMinutes>60)return no('INVALID_HORIZON');
 const atr=features?.M5?.atr14,spread=q.ask-q.bid;
 if(!pos(atr)||spread>atr*.25||spread>(s.symbol==='XAUUSD'?2.5:80))return no('SPREAD_OR_ATR');
 const day=Math.floor(now/86400);
 if(day!==s.day){s.day=day;s.entriesToday=0;}
 const side=plan.stance==='BUY_WATCH'?1:-1;
 if(s.positions.length>=POLICY.cap||s.positions.some(p=>p.side!==side)||s.symbol==='BTCUSD'&&s.entriesToday>=POLICY.btcDailyCap)return no('POSITION_OR_DAILY_CAP');
 const entry=(side===1?q.ask:q.bid)+side*POLICY.slipSpread*spread;
 const distance=Math.max(1.5*atr,4*spread),stop=entry-side*distance,target=entry+side*POLICY.rr*distance;
 // Include estimated round trip friction in initial dollar risk budget.
 const budget=Math.min(s.balance,s.equity)*POLICY.risk;
 const units=budget/(distance+POLICY.slipSpread*spread+POLICY.feeR*distance);
 if(!pos(entry)||!pos(stop)||!pos(target)||!pos(units)||!pos(budget))return no('INVALID_RISK');
 s.positions.push({bar:closedBarTime,side,entry,stop,target,units,fee:units*distance*POLICY.feeR,due:now+plan.timeHorizonMinutes*60,openedAt:now});
 s.entriesToday++;s.firstEntryAt??=now;mark(s,q);
 return {state:s,entered:true,reason:null};
}
export function portfolioReport(s){
 return {symbol:s.symbol,initialBalance:POLICY.initial,balance:s.balance,equity:s.equity,closed:s.closed,open:s.positions.length,wins:s.wins,netProfit:s.balance-POLICY.initial,profitFactor:s.closed>=30&&s.grossLoss>0?s.grossProfit/s.grossLoss:null,maxSampledDrawdownPct:100*s.maxDrawdown,maxRealizedDrawdownPct:100*s.maxRealizedDrawdown,stopHits:s.stopHits,targetHits:s.targetHits,timeExits:s.timeExits,frozen:s.frozen,gaps:s.gaps,firstEntryAt:s.firstEntryAt,lastCloseAt:s.lastCloseAt,executionPermission:false};
}
// Persist one small JSON state per symbol, optimistic compare-and-swap prevents
// concurrent workers from double booking. Never reset after restart or gap.
export function createPortfolioStore({query,clock=()=>Math.floor(Date.now()/1000)}){
 async function mutate(symbol,fn){
  if(!symbols.includes(symbol))return {saved:false,reason:'INVALID_SYMBOL'};
  await query('INSERT INTO agentic_research.ai_paper_portfolios(symbol,state) VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING',[symbol,JSON.stringify(initialPortfolio(symbol))]);
  for(let i=0;i<3;i++){
   const r=await query('SELECT state,revision FROM agentic_research.ai_paper_portfolios WHERE symbol=$1',[symbol]);
   const row=r.rows[0];if(!row||row.state.version!==POLICY.version)throw Error('PORTFOLIO_VERSION_MISMATCH');
   const outcome=fn(row.state);const state=outcome.state;
   if(JSON.stringify(state)===JSON.stringify(row.state))return {saved:false,reason:outcome.reason||'UNCHANGED'};
   const u=await query('UPDATE agentic_research.ai_paper_portfolios SET state=$2::jsonb,revision=revision+1 WHERE symbol=$1 AND revision=$3',[symbol,JSON.stringify(state),row.revision]);
   if(u.rowCount===1)return {saved:true,entered:outcome.entered??false,reason:outcome.reason||null};
  }
  throw Error('PORTFOLIO_CONCURRENT_WRITE');
 }
 return {save:x=>mutate(x.symbol,s=>enterPortfolio(s,x,clock())),observe:q=>mutate(q.symbol,s=>({state:advancePortfolio(s,q,clock())})),report:async()=>{
  const r=await query('SELECT symbol,state FROM agentic_research.ai_paper_portfolios',[]);
  return {version:POLICY.version,policy:POLICY,markets:Object.fromEntries(symbols.map(symbol=>[symbol,portfolioReport(r.rows.find(x=>x.symbol===symbol)?.state||initialPortfolio(symbol))])),sampledQuotesOnly:true,gapFreezesPortfolio:true,lotConstraintsSimulated:false,actualBrokerProfitability:false,executionPermission:false,ordersCreated:0};
 }};
}
