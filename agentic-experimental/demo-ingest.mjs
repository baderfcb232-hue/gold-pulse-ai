// Experimental broker DEMO read-only ingestion. No order commands and no credentials.
// Wire this only to an isolated sensor; never share secrets with production.
import {createHmac,timingSafeEqual,createHash} from 'node:crypto';
import {validateIsolatedDemoSnapshot} from './mt5-demo-sensor.mjs';
const safeNow=()=>Math.floor(Date.now()/1000);
const hex=/^[a-f0-9]{64}$/;
function hmac(secret,ts,body){return createHmac('sha256',secret).update(ts+'\n').update(body).digest('hex')}
export function signDemoEnvelope(secret,timestamp,body){
 if(typeof secret!=='string'||!secret)throw Error('SIGNING_SECRET_MISSING');
 return hmac(secret,String(timestamp),body);
}
export function createDemoIngest({secret='',clock=safeNow}={}){
 const configured=typeof secret==='string'&&Buffer.byteLength(secret,'utf8')>=32;
 const recent=new Map(),latest=new Map();
 let accepted=0,rejected=0,lastReceipt=null,lastReject=null;
 const deny=(code)=>{rejected++;lastReject=code;return {status:'REJECTED',code}};
 function report(){
  const now=clock(),markets={};
  for(const [symbol,s] of latest){
   const age=now-s.receivedAt;
   markets[symbol]={status:age>=0&&age<=10?'SENSOR_OBSERVED':'STALE',
    brokerServer:s.brokerServer,quoteAgeSeconds:now-s.timestamp,
    observedAt:new Date(s.timestamp*1000).toISOString(),
    receivedAt:new Date(s.receivedAt*1000).toISOString(),
    multiTimeframeVerified:s.multiTimeframeVerified};
  }
  const fresh=Object.values(markets).some(x=>x.status==='SENSOR_OBSERVED');
  return {status:!configured?'AUTH_SECRET_NOT_CONFIGURED':fresh?'OBSERVING_ISOLATED_DEMO':accepted?'STALE_SENSOR':'AWAITING_SENSOR',
   authentication:configured?'HMAC_SHA256_CONFIGURED':'DISABLED',
   transport:'TLS_REQUIRED',maxBytes:120000,accepted,rejected,lastReceipt,lastReject,
   markets,brokerOrderRoutes:false,allowTrading:false,aiAutoInvocation:false};
 }
 function receive({body,timestamp,signature,secure=true}={}){
  if(!configured)return deny('INGEST_DISABLED');
  if(!secure)return deny('HTTPS_REQUIRED');
  if(typeof body!=='string'||Buffer.byteLength(body,'utf8')>120000||body.length===0)
   return deny('BODY_INVALID_OR_TOO_LARGE');
  if(typeof timestamp!=='string'||!/^\d{10}$/.test(timestamp))
   return deny('TIMESTAMP_INVALID');
  const ts=Number(timestamp),now=clock();
  if(!Number.isSafeInteger(ts)||Math.abs(now-ts)>10)return deny('REQUEST_TOO_OLD');
  if(typeof signature!=='string'||!hex.test(signature))return deny('SIGNATURE_INVALID');
  const expected=hmac(secret,timestamp,body);
  if(!timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(expected,'hex')))
   return deny('SIGNATURE_INVALID');
  const digest=createHash('sha256').update(timestamp).update(body).digest('hex');
  for(const [k,expiry] of recent)if(expiry<now)recent.delete(k);
  if(recent.has(digest))return deny('REPLAY_DETECTED');
  let record;
  try{record=JSON.parse(body)}catch{return deny('JSON_INVALID')}
  if(!record||record.source!=='ISOLATED_MT5_DEMO_SENSOR'||
     record.ordersSupported!==false||!Number.isSafeInteger(record.capturedAt)||
     Math.abs(now-record.capturedAt)>10||!record.symbols||
     Object.keys(record.symbols).some(x=>!['XAUUSD','BTCUSD'].includes(x)))
   return deny('ISOLATION_PROVENANCE_INVALID');
  let count=0;
  const entries=[];
  for(const symbol of Object.keys(record.symbols)){
   const snapshot=record.symbols[symbol];
   if(snapshot?.status==='BLOCKED')continue;
   if(snapshot?.symbol!==symbol||snapshot?.brokerServer==='SYNTHETIC-Demo')
    return deny('BROKER_IDENTITY_UNVERIFIED');
   const result=validateIsolatedDemoSnapshot(snapshot,now);
   if(result.status!=='VALIDATED_RESEARCH_SENSOR'||!result.safe.multiTimeframeVerified)
    return deny('MARKET_SNAPSHOT_INVALID');
   const old=latest.get(symbol);
   if(old&&snapshot.timestamp<old.timestamp)return deny('OUT_OF_ORDER_BROKER_QUOTE');
   entries.push({symbol,safe:result.safe});count++;
  }
  if(count===0)return deny('NO_VALID_MARKET_SNAPSHOTS');
  recent.set(digest,now+20);
  for(const {symbol,safe} of entries){
   latest.set(symbol,{...safe,receivedAt:now});
  }
  accepted++;lastReceipt=new Date(now*1000).toISOString();lastReject=null;
  return {status:'OBSERVED',symbols:entries.map(x=>x.symbol),ordersCreated:0,
   modelCalled:false,tradeAllowed:false};
 }
 // Return only the validated research snapshot; never expose this over public GET.
 function getLatest(symbol){
  const safe=latest.get(symbol);
  return safe?structuredClone({...safe,executionEnabled:false}):null;
 }
 return {receive,report,getLatest};
}
