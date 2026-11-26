// Fixed H4 Donchian 20/10, independent shadow research. Never invokes AI or orders.
import {createHash} from 'node:crypto';
export const POLICY=Object.freeze({version:'GOLD_H4_CHANNEL_20_10_V8',entry:20,exit:10,risk:.004,stopAtr:2,feeR:.05,slippageSpread:.1,maxGapSeconds:180,maxEntryDelay:300});
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const pos=x=>finite(x)&&x>0;
const epoch=x=>Number.isSafeInteger(x)&&x>0;
const identity=q=>typeof q.brokerServer==='string'&&q.brokerServer.toLowerCase().includes('demo')&&!q.brokerServer.toLowerCase().includes('synthetic')&&typeof q.brokerSymbol==='string'&&q.brokerSymbol.length>0&&epoch(q.accountLogin)?createHash('sha256').update(JSON.stringify([q.brokerServer,q.brokerSymbol,q.accountLogin])).digest('hex'):null;
function valid(q,now){return q?.environment==='EXPERIMENTAL_NABD_AGENTIC'&&q.accountType==='DEMO'&&q.executionEnabled===false&&q.symbol==='XAUUSD'&&epoch(q.timestamp)&&q.timestamp<=now&&now-q.timestamp<=5&&pos(q.bid)&&pos(q.ask)&&q.ask>q.bid&&identity(q);}
export function h4Setup(bars,now){
 if(!Array.isArray(bars)||bars.length<21||bars.length>60||!epoch(now))return null;
 if(bars.some((b,i)=>!b||!epoch(b.time)||b.time+14400>now||![b.open,b.high,b.low,b.close].every(pos)||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||(i>0&&b.time<=bars[i-1].time)))return null;
 const last=bars.at(-1),prev=bars.slice(-21,-1),exit=prev.slice(-10);
 if(now-last.time-14400>14400)return null;
 const high=Math.max(...prev.map(b=>b.high)),low=Math.min(...prev.map(b=>b.low));
 const shortExit=Math.max(...exit.map(b=>b.high)),longExit=Math.min(...exit.map(b=>b.low));
 const tr=bars.slice(-14).map((b,i)=>{const p=bars[bars.length-15+i].close;return Math.max(b.high-b.low,Math.abs(b.high-p),Math.abs(b.low-p));});
 const atr=tr.reduce((a,b)=>a+b,0)/14;
 return {bar:last.time,closedAt:last.time+14400,side:last.close>high?1:last.close<low?-1:0,longExit:last.close<longExit,shortExit:last.close>shortExit,atr,high,low};
}
export function initial(){return {version:POLICY.version,balance:2000,peak:2000,maxRealizedDrawdown:0,feed:null,lastTick:0,lastBar:0,position:null,entries:0,closed:0,wins:0,grossProfit:0,grossLoss:0,invalidated:0,latest:null,recent:[]};}
function append(s,event){s.recent=[event,...s.recent].slice(0,25);s.latest=event;}
export function observe(state,q,now){
 if(!valid(q,now)||q.timestamp<=state.lastTick)return state;
 const s=structuredClone(state),feed=identity(q),setup=q.multiTimeframeVerified?h4Setup(q.candlesH4,now):null;
 if(s.feed&&s.feed!==feed){if(s.position){s.invalidated++;s.position=null;append(s,{type:'INVALIDATED_FEED_CHANGED',at:q.timestamp});}return s;}
 s.feed=feed;
 const p=s.position,newBar=setup&&setup.bar>s.lastBar;
 if(p&&q.timestamp-s.lastTick>POLICY.maxGapSeconds){
  s.position=null;s.invalidated++;append(s,{type:'INVALIDATED_QUOTE_GAP',at:q.timestamp});if(newBar)s.lastBar=setup.bar;s.lastTick=q.timestamp;return s;
 }
 // While flat only a new verified H4 candle is processed. Do not repeat an old signal.
 if(!p&&!newBar)return state;
 s.lastTick=q.timestamp;
 if(newBar)s.lastBar=setup.bar;
 if(p){
  const price=p.side===1?q.bid:q.ask;
  const stop=p.side*(price-p.stop)<=0,channel=newBar&&(p.side===1?setup.longExit:setup.shortExit);
  if(stop||channel){
   const net=p.units*(p.side*(price-p.entry)-POLICY.slippageSpread*(q.ask-q.bid))-p.fee;
   s.balance+=net;s.closed++;s.peak=Math.max(s.peak,s.balance);s.maxRealizedDrawdown=Math.max(s.maxRealizedDrawdown,1-s.balance/s.peak);
   if(net>0){s.wins++;s.grossProfit+=net;}else s.grossLoss-=net;
   s.position=null;append(s,{type:stop?'STOP_SAMPLED':'CHANNEL_EXIT_SAMPLED',at:q.timestamp,net});return s;
  }
  return s;
 }
 if(!setup.side){append(s,{type:'NO_CHANNEL_BREAKOUT',at:q.timestamp,bar:setup.bar});return s;}
 if(q.timestamp-setup.closedAt>POLICY.maxEntryDelay){append(s,{type:'MISSED_BREAKOUT_WINDOW',at:q.timestamp,bar:setup.bar});return s;}
 const spread=q.ask-q.bid;
 if(!pos(setup.atr)||spread>2.5||spread>setup.atr*.25){append(s,{type:'SPREAD_OR_ATR_BLOCK',at:q.timestamp,bar:setup.bar});return s;}
 const side=setup.side,entry=(side===1?q.ask:q.bid)+side*POLICY.slippageSpread*spread,distance=Math.max(2*setup.atr,4*spread),stop=entry-side*distance;
 const units=s.balance*POLICY.risk/(distance*(1+POLICY.feeR)+POLICY.slippageSpread*spread);
 if(!pos(stop)||!pos(units)||!pos(entry))return s;
 s.position={side,entry,stop,units,fee:units*distance*POLICY.feeR,openedAt:q.timestamp,bar:setup.bar};s.entries++;
 append(s,{type:side===1?'PAPER_LONG':'PAPER_SHORT',at:q.timestamp,bar:setup.bar});return s;
}
export function report(s){return {policy:POLICY,status:'RESEARCH_ONLY_UNVALIDATED',initialBalance:2000,observedBalance:s.balance,netProfit:s.balance-2000,entries:s.entries,closed:s.closed,open:s.position?1:0,invalidated:s.invalidated,wins:s.wins,profitFactor:s.closed>=30&&s.grossLoss>0?s.grossProfit/s.grossLoss:null,maxRealizedDrawdownPct:100*s.maxRealizedDrawdown,lastClosedH4Bar:s.lastBar||null,latest:s.latest,recent:s.recent,simulated:true,swapIncluded:false,quoteSamplingOnly:true,invalidatedPositionsExcluded:true,profitabilityEstablished:false,ordersCreated:0,executionPermission:false};}
export function createGoldH4Store({query,clock=()=>Math.floor(Date.now()/1000)}){
 async function observeQuote(q){
  const now=clock();if(!valid(q,now))return;
  await query("INSERT INTO agentic_research.gold_h4_research(id,state) VALUES(1,$1::jsonb) ON CONFLICT DO NOTHING",[JSON.stringify(initial())]);
  for(let i=0;i<3;i++){
   const r=await query("SELECT state,revision FROM agentic_research.gold_h4_research WHERE id=1",[]);
   const row=r.rows[0];if(!row||row.state.version!==POLICY.version)throw Error('H4_RESEARCH_VERSION_MISMATCH');
   const next=observe(row.state,q,now);if(JSON.stringify(next)===JSON.stringify(row.state))return;
   const result=await query("UPDATE agentic_research.gold_h4_research SET state=$1::jsonb,revision=revision+1 WHERE id=1 AND revision=$2",[JSON.stringify(next),row.revision]);
   if(result.rowCount===1)return;
  }
  throw Error('H4_RESEARCH_CONCURRENT_WRITE');
 }
 return {observe:observeQuote,report:async()=>{const r=await query("SELECT state FROM agentic_research.gold_h4_research WHERE id=1",[]);return report(r.rows[0]?.state||initial());}};
}
