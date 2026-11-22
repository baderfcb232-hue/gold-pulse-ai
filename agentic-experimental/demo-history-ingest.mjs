// NABD isolated Demo - independently signed read-only MQL5 History observations.
// This endpoint never accepts orders, lot changes, secrets or execution instructions.
import {createHmac,timingSafeEqual,createHash} from 'node:crypto';
const safeNow=()=>Math.floor(Date.now()/1000);
const hex64=/^[0-9a-f]{64}$/;
const safeSymbol=/^[-A-Za-z0-9._]{1,64}$/;
const allowed=new Set(['XAUUSD','BTCUSD']);
const finitePositive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const validInt=x=>Number.isSafeInteger(x)&&x>0;
const sign=(secret,ts,body)=>createHmac('sha256',secret).update(ts+'\n'+body).digest('hex');

export function createDemoHistoryIngest({
 secret='',clock=safeNow,quoteProvider=()=>null,matchHistory=()=>({matched:0})
}={}){
 const configured=typeof secret==='string'&&Buffer.byteLength(secret,'utf8')>=32;
 const recent=new Map();
 let accepted=0,rejected=0,matchedTotal=0,lastAcceptedAt=null,lastReject=null;
 const rejectCounts=Object.create(null);
 const reject=code=>{
  rejected++;lastReject=code;
  rejectCounts[code]=(rejectCounts[code]||0)+1;
  return {status:'REJECTED',code,ordersCreated:0};
 };
 function receive({body,timestamp,mac,secure=false}={}){
  if(!configured)return reject('HISTORY_SECRET_NOT_CONFIGURED');
  if(!secure)return reject('HTTPS_REQUIRED');
  if(typeof body!=='string'||Buffer.byteLength(body,'utf8')>16000||body.length<2)
   return reject('INVALID_BODY');
  if(typeof timestamp!=='string'||!/^\d{10}$/.test(timestamp)||
     !validInt(Number(timestamp))||Math.abs(clock()-Number(timestamp))>12)
   return reject('HISTORY_REQUEST_EXPIRED');
  if(typeof mac!=='string'||!hex64.test(mac))return reject('INVALID_SIGNATURE');
  const expected=sign(secret,timestamp,body);
  if(!timingSafeEqual(Buffer.from(mac,'hex'),Buffer.from(expected,'hex')))
   return reject('INVALID_SIGNATURE');
  const n=clock(),fingerprint=createHash('sha256').update(timestamp+'\n'+body).digest('hex');
  for(const [key,expiry] of recent)if(expiry<n)recent.delete(key);
  if(recent.has(fingerprint))return reject('HISTORY_REPLAY');
  let x;try{x=JSON.parse(body)}catch{return reject('HISTORY_JSON_INVALID')}
  if(!x||Array.isArray(x)||x.source!=='ISOLATED_DEMO_MT5_HISTORY_VERIFIER'||
     x.accountType!=='DEMO'||!validInt(x.accountLogin)||
     typeof x.brokerServer!=='string'||x.brokerServer.length>100||
     !x.brokerServer.toLowerCase().includes('demo')||
     !validInt(x.observedAt)||Math.abs(x.observedAt-Number(timestamp))>2||
     !x.symbols||Array.isArray(x.symbols)||typeof x.symbols!=='object'||
     Object.keys(x.symbols).length!==2||!['XAUUSD','BTCUSD'].every(k=>
       typeof x.symbols[k]==='string'&&safeSymbol.test(x.symbols[k]))||
     x.symbols.XAUUSD===x.symbols.BTCUSD||
     !Array.isArray(x.deals)||x.deals.length>25)
   return reject('INVALID_HISTORY_PROVENANCE');
  const perSymbol={XAUUSD:[],BTCUSD:[]};
  for(const d of x.deals){
   if(!d||typeof d!=='object'||Array.isArray(d)||
      !allowed.has(d.symbol)||!validInt(d.dealTicket)||!validInt(d.orderTicket)||
      d.brokerSymbol!==x.symbols[d.symbol]||
      !['BUY','SELL'].includes(d.side)||d.entry!=='IN'||
      !validInt(d.dealAt)||d.dealAt>n+2||d.dealAt<n-900||
      !finitePositive(d.volume)||!finitePositive(d.stop)||!finitePositive(d.target))
    return reject('INVALID_HISTORY_DEAL');
   perSymbol[d.symbol].push(d);
  }
  let verified=0;
  // A signed verifier is not enough: require the independently signed Demo
  // market sensor for the same exact account, broker server and symbol mapping.
  for(const symbol of ['XAUUSD','BTCUSD']){
   if(perSymbol[symbol].length===0)continue;
   const sensor=quoteProvider(symbol);
   if(!sensor||sensor.accountType!=='DEMO'||sensor.accountLogin!==x.accountLogin||
      sensor.brokerServer!==x.brokerServer||sensor.brokerSymbol!==x.symbols[symbol])
    return reject('HISTORY_SENSOR_ACCOUNT_MISMATCH');
  }
  // Match only to an existing, signed-delivered intent and authenticated EA ACK.
  for(const symbol of ['XAUUSD','BTCUSD']){
   if(perSymbol[symbol].length===0)continue;
   const sensor=quoteProvider(symbol);
   const result=matchHistory(perSymbol[symbol],{...sensor,symbol});
   verified+=Number.isSafeInteger(result?.matched)&&result.matched>=0?result.matched:0;
  }
  recent.set(fingerprint,n+30);
  while(recent.size>200)recent.delete(recent.keys().next().value);
  accepted++;matchedTotal+=verified;lastAcceptedAt=new Date(n*1000).toISOString();lastReject=null;
  return {status:'OBSERVED',historyReadOnly:true,ordersCreated:0,matched:verified,
   brokerIndependentAttestation:false};
 }
 function report(){
  const at=lastAcceptedAt?Math.floor(Date.parse(lastAcceptedAt)/1000):null;
  return {status:!configured?'NOT_CONFIGURED':at!==null&&clock()-at<=45?
    'MQL5_HISTORY_OBSERVER_ONLINE':accepted?'MQL5_HISTORY_OBSERVER_STALE':'AWAITING_VERIFIER',
   authentication:configured?'ISOLATED_HMAC_SHA256':'NOT_CONFIGURED',
   accepted,rejected,lastReject,rejectCounts:{...rejectCounts},
   lastAcceptedAt,matchedTotal,brokerIndependentAttestation:false,
   ordersSupported:false,liveTrading:false};
 }
 return {receive,report};
}
