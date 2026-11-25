// Read-only isolated MT5 lifecycle reconciliation. No execution or order routes.
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
const syms=['XAUUSD','BTCUSD'];
const int=x=>Number.isSafeInteger(x)&&x>0;
const amount=x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=1e9;
const vol=x=>amount(x)&&x>0&&x<=1000;
const sum=(a,k)=>a.reduce((v,d)=>v+d[k],0);
const epsilon=1e-8;
export const lifecycleFeed=(server,symbol,login)=>createHash('sha256').update(JSON.stringify([server,symbol,login])).digest('hex');
export function validateClosedPosition(p,{now,symbols,feed,currency}){
 if(!p||!syms.includes(p.symbol)||!int(p.positionId)||!Array.isArray(p.deals)||p.deals.length<2||p.deals.length>25||p.positionOpen!==false)return null;
 const ids=new Set();
 for(const d of p.deals){
  if(!d||!int(d.dealTicket)||ids.has(d.dealTicket)||!int(d.at)||d.at>now+2||
   d.brokerSymbol!==symbols[p.symbol]||!['IN','OUT'].includes(d.entry)||!['BUY','SELL'].includes(d.side)||
   !vol(d.volume)||!['profit','commission','swap','fee'].every(k=>amount(d[k])))return null;
  ids.add(d.dealTicket);
 }
 const entries=p.deals.filter(d=>d.entry==='IN'),outs=p.deals.filter(d=>d.entry==='OUT');
 // Only fully closed, single-entry hedging positions. Partial exits are allowed;
 // partial entry fills, reversals, netting and mixed positions are excluded.
 if(entries.length!==1||!outs.length)return null;
 const e=entries[0];
 if(outs.some(d=>d.at<e.at||d.side===e.side)||Math.abs(sum(outs,'volume')-e.volume)>epsilon)return null;
 const closedAt=Math.max(...outs.map(d=>d.at));
 if(closedAt<now-86400||closedAt>now+2)return null;
 const net=sum(p.deals,'profit')+sum(p.deals,'commission')+sum(p.deals,'swap')+sum(p.deals,'fee');
 if(!amount(net))return null;
 return {symbol:p.symbol,feed:feed(p.symbol),positionId:p.positionId,entryTicket:e.dealTicket,openedAt:e.at,side:e.side,volume:e.volume,closedAt,currency,
   grossProfit:sum(p.deals,'profit'),commission:sum(p.deals,'commission'),swap:sum(p.deals,'swap'),fee:sum(p.deals,'fee'),net,exitCount:outs.length};
}
export function createClosedHistoryIngest({secret='',clock=()=>Math.floor(Date.now()/1000),quoteProvider=()=>null,journalProvider=()=>null}={}){
 const configured=typeof secret==='string'&&Buffer.byteLength(secret,'utf8')>=32;
 let accepted=0,rejected=0,matched=0,lastAcceptedAt=null,lastReject=null;
 const recent=new Map();
 function deny(code){rejected++;lastReject=code;return {status:'REJECTED',code,ordersCreated:0};}
 async function receive({body,timestamp,mac,secure=false}={}){
  if(!configured||!secure)return deny('CLOSURE_CHANNEL_DISABLED_OR_INSECURE');
  const now=clock();
  if(typeof body!=='string'||Buffer.byteLength(body)>64000||typeof timestamp!=='string'||!/^\d{10}$/.test(timestamp)||Math.abs(now-Number(timestamp))>12||typeof mac!=='string'||! /^[a-f0-9]{64}$/.test(mac))return deny('INVALID_CLOSURE_ENVELOPE');
  const expected=createHmac('sha256',secret).update('NABD_CLOSED_HISTORY_V1\n'+timestamp+'\n'+body).digest('hex');
  if(!timingSafeEqual(Buffer.from(mac,'hex'),Buffer.from(expected,'hex')))return deny('INVALID_CLOSURE_SIGNATURE');
  const digest=createHash('sha256').update(timestamp+'\n'+body).digest('hex');
  for(const [k,expiry] of recent)if(expiry<now)recent.delete(k);
  if(recent.has(digest))return deny('CLOSURE_REPLAY');
  let x;try{x=JSON.parse(body)}catch{return deny('INVALID_CLOSURE_JSON')}
  if(!x||x.source!=='ISOLATED_DEMO_MT5_CLOSED_HISTORY_V1'||x.accountType!=='DEMO'||x.marginMode!=='HEDGING'||!int(x.accountLogin)||
   typeof x.brokerServer!=='string'||x.brokerServer.length>100||!x.brokerServer.toLowerCase().includes('demo')||
   !int(x.observedAt)||Math.abs(x.observedAt-Number(timestamp))>2||typeof x.currency!=='string'||! /^[A-Z]{3,8}$/.test(x.currency)||
   !x.symbols||Object.keys(x.symbols).length!==2||!syms.every(s=>typeof x.symbols[s]==='string'&&/^[-A-Za-z0-9._]{1,64}$/.test(x.symbols[s]))||
   x.symbols.XAUUSD===x.symbols.BTCUSD||!Array.isArray(x.positions)||x.positions.length>20)return deny('INVALID_CLOSURE_PROVENANCE');
  const feed=s=>lifecycleFeed(x.brokerServer,x.symbols[s],x.accountLogin);
  const records=[],seen=new Set();
  for(const p of x.positions){
   const r=validateClosedPosition(p,{now,symbols:x.symbols,feed,currency:x.currency});
   if(!r||seen.has(r.positionId))return deny('INVALID_CLOSED_POSITION');
   seen.add(r.positionId);
   const q=quoteProvider(r.symbol);
   if(!q||q.accountType!=='DEMO'||q.accountLogin!==x.accountLogin||q.brokerServer!==x.brokerServer||q.brokerSymbol!==x.symbols[r.symbol]||!int(q.timestamp)||q.timestamp>now||now-q.timestamp>10)return deny('CLOSURE_SENSOR_ACCOUNT_MISMATCH');
   records.push(r);
  }
  const journal=journalProvider();
  if(!journal?.saveClosedPosition)return deny('CLOSURE_JOURNAL_UNAVAILABLE');
  recent.set(digest,now+30);while(recent.size>200)recent.delete(recent.keys().next().value);
  let added=0,unmatched=0;
  try{for(const r of records){const result=await journal.saveClosedPosition(r);if(result.inserted)added++;else if(!result.matched)unmatched++;}}
  catch{recent.delete(digest);return deny('CLOSURE_JOURNAL_WRITE_FAILED');}
  accepted++;matched+=added;lastAcceptedAt=new Date(now*1000).toISOString();lastReject=null;
  return {status:'OBSERVED',ordersCreated:0,inserted:added,unmatched,brokerSigned:false};
 }
 return {receive,report:()=>({configured,accepted,rejected,matched,lastAcceptedAt,lastReject,readOnly:true,brokerSigned:false})};
}
