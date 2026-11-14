// NABD Agentic: offline, point-in-time replay of ARCHIVED decisions against broker M5 candles.
// This is never an AI reconstruction, broker fill confirmation, or live order route.
// Historical candle data and archived decisions MUST be user-supplied. No network/MT5 imports.
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createHmac} from 'node:crypto';
import {multiTimeframeFeatures} from './market-features.mjs';
import {createDemoTradeIntents} from './demo-trade-intents.mjs';

const seconds={M5:300,M15:900,H1:3600,H4:14400};
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const safeInteger=x=>Number.isSafeInteger(x)&&x>0;
const round=x=>Number(x.toFixed(8));
const fail=s=>{throw Error('BACKTEST_DATA_INVALID: '+s)};
const reasonCount=(map,key)=>{map[key]=(map[key]||0)+1};
function upperBound(bars,t){
 let lo=0,hi=bars.length;
 while(lo<hi){const mid=(lo+hi)>>1;if(bars[mid].time<=t)lo=mid+1;else hi=mid}
 return lo;
}
function validateBars(bars,tf){
 if(!Array.isArray(bars)||!bars.length)fail('missing '+tf+' candles');
 let prior=0;
 for(const b of bars){
  if(!safeInteger(b?.time)||b.time<=prior||!['open','high','low','close'].every(k=>finite(b[k])&&b[k]>0)||
    b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close))
   fail('unsorted/invalid '+tf+' broker candle');
  prior=b.time;
 }
}
function closedBars(market,at){
 const out={};
 for(const [tf,dur] of Object.entries(seconds)){
  const bars=market.candles[tf];
  const count=upperBound(bars,at-dur);
  const max=tf==='M5'?240:tf==='M15'?100:tf==='H1'?80:60;
  out['candles'+tf]=bars.slice(Math.max(0,count-max),count);
 }
 return out;
}
function priceAtStart(m5,at){
 const i=upperBound(m5,at-1);
 return i<m5.length?i:-1;
}
function simulate(intent,m5,index,assumptions,lot,oneLotStopRisk){
 const buy=intent.side==='BUY',spread=assumptions.spreadPrice,slip=assumptions.slippagePrice;
 const entryBar=m5[index],entry=entryBar.open+(buy?spread:0)+(buy?slip:-slip);
 if((buy&&(entry<=intent.stop||entry>=intent.target))||
    (!buy&&(entry>=intent.stop||entry<=intent.target)))
  return {skip:'OPEN_BEYOND_STOP_OR_TARGET'};
 if(Math.abs(entry-intent.entry)>Math.max(intent.atr*.25,.01))
  return {skip:'FILL_PRICE_MOVED'};
 const endAt=entryBar.time+assumptions.maxHoldSeconds;
 let exit=null,exitAt=null,why=null;
 for(let k=index;k<m5.length;k++){
  const b=m5[k];if(b.time>endAt)break;
  const low=buy?b.low:b.low+spread,high=buy?b.high:b.high+spread;
  const stop=buy?low<=intent.stop:high>=intent.stop;
  const target=buy?high>=intent.target:low<=intent.target;
  if(stop){exit=buy?Math.min(intent.stop,b.open)-slip:
    Math.max(intent.stop,b.open+spread)+slip;
   exitAt=b.time;why='SL_STOP_FIRST';break;}
  if(target){exit=intent.target+(buy?-slip:slip);
   exitAt=b.time;why='TP';break;}
  if(b.time+300>=endAt){
   exit=b.close+(buy?-slip:spread+slip);
   exitAt=b.time+300;why='TIME_EXIT';break;
  }
 }
 if(exit===null)return {skip:'INSUFFICIENT_FUTURE_BARS'};
 const gross=(buy?exit-entry:entry-exit)/assumptions.tickSize*assumptions.tickValueLoss*lot;
 const netUsd=gross-assumptions.commissionPerLotRoundTrip*lot;
 return {entryAt:entryBar.time,exitAt,side:intent.side,entry:round(entry),
  exit:round(exit),stop:intent.stop,target:intent.target,lot,
  exitReason:why,netUsd:round(netUsd),netR:round(netUsd/(oneLotStopRisk*lot))};
}
function validateConfig(market){
 if(!market||typeof market!=='object'||!market.candles||!Array.isArray(market.decisions))
  fail('candles and archived decisions required');
 for(const tf of Object.keys(seconds))validateBars(market.candles[tf],tf);
 const c=market.costs;
 if(!c||!['spreadPrice','slippagePrice','commissionPerLotRoundTrip','tickSize','tickValueLoss',
  'minLot','maxLot','lotStep','startingEquityUsd'].every(k=>finite(c[k])&&c[k]>=0)||
  c.tickSize<=0||c.tickValueLoss<=0||c.minLot<=0||c.lotStep<=0||
  c.maxLot<c.minLot||c.startingEquityUsd<=0||
  !safeInteger(c.maxHoldSeconds)||c.maxHoldSeconds>3600)
  fail('explicit broker costs, volume and maximum hold required');
 if(!market.brokerSymbol||!/^[A-Za-z0-9._-]{1,64}$/.test(market.brokerSymbol)||
   typeof market.brokerServer!=='string'||!market.brokerServer.toLowerCase().includes('demo'))
  fail('verified DEMO broker identity metadata required');
}
export function replayAgenticBacktest(dataset,{minCoverageDays=730}={}){
 if(dataset?.schema!=='NABD_AGENTIC_PIT_REPLAY_V1'||dataset?.source!=='BROKER_EXPORT_WITH_ARCHIVED_AI_DECISIONS')
  fail('exact point-in-time source required; never invent historical AI decisions');
 if(!Number.isSafeInteger(minCoverageDays)||minCoverageDays<0||minCoverageDays>4000)
  fail('invalid minimum coverage');
 if(!dataset.markets||Object.keys(dataset.markets).some(s=>!['XAUUSD','BTCUSD'].includes(s))||
   Object.keys(dataset.markets).length!==2)fail('both XAUUSD and BTCUSD required');
 const reports={};
 for(const symbol of ['XAUUSD','BTCUSD']){
  const market=dataset.markets[symbol];validateConfig(market);
  const m5=market.candles.M5,spanDays=(m5.at(-1).time-m5[0].time)/86400;
  if(spanDays<minCoverageDays)fail(symbol+' history shorter than '+minCoverageDays+' calendar days');
  if(!market.decisions.length){
   reports[symbol]={status:'NOT_TESTABLE_NO_ARCHIVED_AI_DECISIONS',
    coverageDays:round(spanDays),decisions:0,trades:0,
    winRate:null,netR:null,profitFactor:null,maxDrawdownPct:null};
   continue;
  }
  const reasons={},trades=[],secret='OFFLINE_BACKTEST_NOT_A_REAL_BROKER_SECRET_000000';
  let now=0,current=null,equity=market.costs.startingEquityUsd,peak=equity,maxDD=0,lossStreak=0,maxLossStreak=0;
  let active=[],seenAt=0,seenBar=new Set(),day='',dailyCount=0;
  const orders=createDemoTradeIntents({enabled:true,secret,
   clock:()=>now,quoteProvider:sym=>sym===symbol?current:null});
  function mac(body){return createHmac('sha256',secret).update(String(now)+'\n'+body).digest('hex')}
  for(const d of market.decisions){
   if(!safeInteger(d.analyzedAt)||!safeInteger(d.closedBarTime)||
      d.analyzedAt<d.closedBarTime+300||d.analyzedAt<=seenAt||
      !['WAIT','BUY_WATCH','SELL_WATCH'].includes(d.stance)||
      !finite(d.confidence)||d.confidence<0||d.confidence>1||
      !finite(d.bid)||!finite(d.ask)||d.bid<=0||d.ask<=d.bid||
      !safeInteger(d.quoteAt)||d.quoteAt>d.analyzedAt||
      d.analyzedAt-d.quoteAt>6)
    fail(symbol+' non-point-in-time archived decision / quote');
   if(seenBar.has(d.closedBarTime))fail(symbol+' duplicate archived M5 decision');
   seenBar.add(d.closedBarTime);seenAt=d.analyzedAt;now=d.analyzedAt;
   // Conservative portfolio bookkeeping: every closed simulated trade is applied
   // before the next decision, with no historical future data entering its gate.
   active=active.filter(x=>x.exitAt>now);
   const stamp=new Date(now*1000).toISOString().slice(0,10);
   if(stamp!==day){day=stamp;dailyCount=0}
   const candles=closedBars(market,now);
   current={environment:'EXPERIMENTAL_NABD_AGENTIC',accountType:'DEMO',
    brokerServer:market.brokerServer,brokerSymbol:market.brokerSymbol,
    accountLogin:1,timestamp:d.quoteAt,bid:d.bid,ask:d.ask,...candles};
   const features=multiTimeframeFeatures(current);
   const outcome=orders.consider({symbol,plan:{stance:d.stance,confidence:d.confidence},
    features,closedBarTime:d.closedBarTime});
   if(!outcome.created){reasonCount(reasons,outcome.reason);continue;}
   const maxPositions=symbol==='BTCUSD'?2:1,maxDaily=symbol==='BTCUSD'?6:100000;
   if(active.length>=maxPositions||dailyCount>=maxDaily){
    reasonCount(reasons,'POSITION_OR_DAILY_LIMIT');continue;
   }
   const req={source:'ISOLATED_DEMO_TRADE_EXECUTOR',accountType:'DEMO',accountLogin:1,
    brokerServer:market.brokerServer,symbols:['XAUUSD','BTCUSD'],
    brokerSymbols:{XAUUSD:symbol==='XAUUSD'?market.brokerSymbol:'BTCUSD.m',
     BTCUSD:symbol==='BTCUSD'?market.brokerSymbol:'XAUUSD.m'},capturedAt:now};
   const body=JSON.stringify(req);
   const delivered=orders.pull({body,timestamp:String(now),mac:mac(body),secure:true});
   if(delivered.status!=='INTENT_DELIVERED'){reasonCount(reasons,delivered.status);continue;}
   const wire=delivered.wire.split('|'),intent={
    side:wire[3],entry:Number(wire[7]),stop:Number(wire[8]),target:Number(wire[9]),
    atr:features.M5.atr14};
   const index=priceAtStart(m5,now);
   if(index<0){reasonCount(reasons,'NO_FUTURE_FILL');continue;}
   const lotRisk=Math.abs(intent.entry-intent.stop)/market.costs.tickSize*market.costs.tickValueLoss;
   const cashCap=equity*0.004;
   const lot=round(Math.floor(cashCap/lotRisk/market.costs.lotStep)*market.costs.lotStep);
   if(!finite(lotRisk)||lotRisk<=0||lot<market.costs.minLot||lot>market.costs.maxLot){
    reasonCount(reasons,'BROKER_MIN_LOT_OR_RISK');continue;
   }
   const result=simulate(intent,m5,index,market.costs,lot,lotRisk);
   if(result.skip){reasonCount(reasons,result.skip);continue;}
   trades.push({id:delivered.wire.split('|')[1],...result});
   active.push(result);dailyCount++;
   // Account for a closed trade only after it has closed: conservative sizing
   // uses initial equity for open trades, then realized PnL for future entries.
   // In this single-threaded replay, equity is recomputed from realized fills.
   equity=market.costs.startingEquityUsd+trades.filter(x=>x.exitAt<=now).reduce((n,x)=>n+x.netUsd,0);
   peak=Math.max(peak,equity);maxDD=Math.max(maxDD,peak-equity);
   if(result.netUsd<0){lossStreak++;maxLossStreak=Math.max(maxLossStreak,lossStreak)}else lossStreak=0;
  }
  const wins=trades.filter(x=>x.netUsd>0);
  const profit=wins.reduce((x,t)=>x+t.netUsd,0);
  const loss=-trades.filter(x=>x.netUsd<0).reduce((x,t)=>x+t.netUsd,0);
  // Recompute a chronological realized-equity drawdown; never mark unrealized PnL as guaranteed.
  const byClose=[...trades].sort((a,b)=>a.exitAt-b.exitAt);
  let balance=market.costs.startingEquityUsd,high=balance,dd=0;
  for(const x of byClose){balance+=x.netUsd;high=Math.max(high,balance);dd=Math.max(dd,(high-balance)/high*100)}
  reports[symbol]={status:'REPLAYED_ARCHIVED_DECISIONS_WITH_ASSUMED_FILLS',
   coverageDays:round(spanDays),decisions:market.decisions.length,trades:trades.length,
   winRate:trades.length?round(wins.length/trades.length):null,
   netUsd:round(balance-market.costs.startingEquityUsd),
   netR:round(trades.reduce((n,t)=>n+t.netR,0)),
   profitFactor:loss>0?round(profit/loss):null,
   maxDrawdownPct:round(dd),maxConsecutiveLosses:maxLossStreak,
   costAssumptions:market.costs,rejections:reasons,trades};
 }
 return {kind:'OFFLINE_AGENTIC_POINT_IN_TIME_REPLAY',
  disclaimer:'NO LIVE AI INFERENCE; NO REAL MT5 ORDER; NO INDEPENDENT HISTORICAL FILL PROOF',
  brokerExecutionConfirmed:false,orderRoutesAvailable:false,
  decisionProvenance:'USER_SUPPLIED_ARCHIVED_RESEARCH_JOURNAL_NOT_INDEPENDENTLY_VERIFIED',
  assumptions:'Next M5 open after analysis; fixed supplied spread/slippage/commission; stop-first intrabar; no swap; broker constraints approximated',
  markets:reports};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const input=process.argv[2],output=process.argv[3];
  if(!input||!output)fail('Usage: node agentic-replay-backtest.mjs input.json report.json');
  const report=replayAgenticBacktest(JSON.parse(readFileSync(input,'utf8')));
  writeFileSync(output,JSON.stringify(report,null,2));
  console.log(JSON.stringify({output,markets:Object.fromEntries(Object.entries(report.markets).map(([s,r])=>[s,
   {status:r.status,coverageDays:r.coverageDays,trades:r.trades,netR:r.netR}]))}));
 }catch(e){console.error(e.message);process.exitCode=1}
}
