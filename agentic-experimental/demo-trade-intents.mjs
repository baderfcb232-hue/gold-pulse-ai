// NABD isolated DEMO order intents. Broker execution happens ONLY inside a separate
// opt-in DEMO MT5 EA after independent broker/account/lot/stop/drawdown guards.
// No imports from production, no LIVE order route, and no order credentials.
import {createHmac,timingSafeEqual} from 'node:crypto';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const round=x=>Number(x.toFixed(8));
const signature=(secret,wire)=>createHmac('sha256',secret).update(wire).digest('hex');
const openPosition=Object.freeze({XAUUSD:1,BTCUSD:2});
export function createDemoTradeIntents({
 enabled=false,secret='',clock=()=>Math.floor(Date.now()/1000),quoteProvider=()=>null,
 onAudit=()=>{}
}={}){
 const keyReady=typeof secret==='string'&&Buffer.byteLength(secret,'utf8')>=32;
 const queue=new Map(),seen=new Set(),delivered=new Map(),acks=new Map();
 let registeredDemoLogin=null,registeredDemoServer=null,lastExecutorSeen=null,lastAckAt=null;
 let created=0,pulled=0,rejected=0,brokerFeedMismatch=0;
 const lastBySymbol={};
 function audit(symbol,state,reason=null){
  lastBySymbol[symbol]={at:new Date(clock()*1000).toISOString(),state,reason};
  try{onAudit(symbol,state,reason)}catch{}
 }
 function deny(symbol,reason){
  rejected++;
  audit(symbol,'BLOCKED',reason);
  return {created:false,reason,orderCreated:false};
 }
 function consider({symbol,plan,features,closedBarTime}={}){
  if(!enabled)return deny(symbol,'DEMO_EXECUTION_DISABLED');
  if(!keyReady)return deny(symbol,'SECRET_NOT_CONFIGURED');
  if(!['XAUUSD','BTCUSD'].includes(symbol))return deny(symbol,'UNVERIFIED_BROKER');
  if(!plan||!['BUY_WATCH','SELL_WATCH'].includes(plan.stance))
   return deny(symbol,'NO_AI_WATCH');
  if(!finite(plan.confidence)||plan.confidence<0.82)return deny(symbol,'LOW_CONFIDENCE');
  const n=clock(),s=quoteProvider(symbol);
  if(!s||s.accountType!=='DEMO'||s.environment!=='EXPERIMENTAL_NABD_AGENTIC'||
    !s.brokerServer?.toLowerCase().includes('demo')||
    !finite(s.bid)||!finite(s.ask)||s.bid<=0||s.ask<=s.bid)
   return deny(symbol,'UNVERIFIED_BROKER');
  if(!Number.isSafeInteger(s.accountLogin)||s.accountLogin<=0)
   return deny(symbol,'SENSOR_ACCOUNT_UNVERIFIED');
  if(registeredDemoLogin!==null&&registeredDemoLogin!==s.accountLogin)
   return deny(symbol,'BROKER_ACCOUNT_MISMATCH');
  if(!Number.isSafeInteger(s.timestamp)||s.timestamp>n||n-s.timestamp>2)
   return deny(symbol,'STALE_BROKER_QUOTE');
  const f=features;
  if(!f||['M5','M15','H1','H4'].some(tf=>f[tf]?.status!=='INDICATORS_AVAILABLE')||
     f.M5.ema200Verified!==true||
     s.candlesM5?.at(-1)?.time!==closedBarTime)
   return deny(symbol,'HISTORY_NOT_VERIFIED');
  const buy=plan.stance==='BUY_WATCH',trend=buy?'UP':'DOWN';
  if(['M5','M15','H1','H4'].some(tf=>f[tf].emaDirection!==trend)||
    !finite(f.M5.ema200)||
    (buy?f.M5.lastClose<=f.M5.ema200:f.M5.lastClose>=f.M5.ema200))
   return deny(symbol,'TREND_CONFLICT');
  const rsi=f.M5.rsi14;
  if(!finite(rsi)||(buy?(rsi<52||rsi>70):(rsi<30||rsi>48)))
   return deny(symbol,'RSI_UNFAVORABLE');
  const atr=f.M5.atr14;
  if(!finite(atr)||atr<=0)return deny(symbol,'ATR_MISSING');
  const spread=s.ask-s.bid,limit=symbol==='BTCUSD'?80:2.5;
  if(spread<=0||spread>limit||spread>atr*0.25)
   return deny(symbol,'SPREAD_LIMIT');
  if(!Number.isSafeInteger(closedBarTime)||closedBarTime+300>n||
    n-closedBarTime>750)return deny(symbol,'HISTORY_NOT_VERIFIED');
  const id=symbol+'-'+closedBarTime;
  if(seen.has(id))return deny(symbol,'DUPLICATE_M5_INTENT');
  if(queue.has(symbol))return deny(symbol,'INTENT_ALREADY_PENDING');
  const entry=buy?s.ask:s.bid,dist=Math.max(1.5*atr,spread*4);
  const rr=symbol==='BTCUSD'?3:2;
  const stop=round(entry+(buy?-dist:dist));
  const target=round(entry+(buy?rr*dist:-rr*dist));
  if(stop<=0||target<=0||(!buy&&(target>=entry||stop<=entry))||
    (buy&&(stop>=entry||target<=entry)))
   return deny(symbol,'UNSAFE_LEVELS');
  const intent={id,symbol,side:buy?'BUY':'SELL',bar:closedBarTime,
   issued:n,expires:n+20,entry:round(entry),stop,target,
   riskPct:0.4,spreadLimit:limit,atr:round(atr),
   maxPositions:openPosition[symbol]};
  // Set dedupe before returning. One-per-candle and single delivery (fail closed).
  seen.add(id);queue.set(symbol,intent);
  if(seen.size>1000){seen.clear();seen.add(id)}
  created++;audit(symbol,'QUEUED',null);
  return {created:true,id,orderCreated:false,brokerExecution:false};
 }
 function take(symbols=[],brokerServer=null){
  if(!enabled||!keyReady)return null;
  for(const symbol of symbols){
   const p=queue.get(symbol);
   if(!p)continue;
   queue.delete(symbol);
   const n=clock(),fresh=quoteProvider(symbol);
   // An executor on a different DEMO broker must never receive an order,
   // even when it knows the test key and has similar quote prices.
   if(!fresh||fresh.brokerServer!==brokerServer){
     brokerFeedMismatch++;audit(symbol,'BLOCKED','BROKER_FEED_IDENTITY_MISMATCH');continue;
   }
   if(p.expires<n||fresh.timestamp>n||n-fresh.timestamp>2||
      Math.abs((p.side==='BUY'?fresh.ask:fresh.bid)-p.entry)>Math.max(p.atr*0.25,0.01)){
    audit(symbol,'EXPIRED_OR_PRICE_MOVED');continue;
   }
   const fields=['V1',p.id,p.symbol,p.side,p.bar,p.issued,p.expires,
    p.entry,p.stop,p.target,p.riskPct,p.spreadLimit,p.maxPositions];
   const base=fields.join('|');
   delivered.set(p.id,{symbol,deliveredAt:n,expires:p.expires});
   if(delivered.size>500)delivered.delete(delivered.keys().next().value);
   pulled++;audit(symbol,'DELIVERED_TO_DEMO_EA');
   return base+'|'+signature(secret,base);
  }
  return null;
 }

 // A separate trading-capable EA must authenticate itself. The old read-only
 // observer never requests and never receives execution instructions.
 function pull({body,timestamp,mac,secure=false}={}){
  if(!enabled||!keyReady||!secure)return {status:'DISABLED',wire:null};
  if(typeof body!=='string'||body.length>2000||
     typeof timestamp!=='string'||!/^\d{10}$/.test(timestamp)||
     Math.abs(clock()-Number(timestamp))>10||typeof mac!=='string'||
     !/^[a-f0-9]{64}$/.test(mac))return {status:'REJECTED',wire:null};
  const expected=signature(secret,timestamp+'\n'+body);
  if(!timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(mac,'hex')))
    return {status:'REJECTED',wire:null};
  let x;try{x=JSON.parse(body)}catch{return {status:'REJECTED',wire:null}}
  if(!x||x.source!=='ISOLATED_DEMO_TRADE_EXECUTOR'||
     x.accountType!=='DEMO'||!Number.isSafeInteger(x.accountLogin)||
     x.accountLogin<=0||typeof x.brokerServer!=='string'||
     x.brokerServer.length>100||!x.brokerServer.toLowerCase().includes('demo')||
     !Array.isArray(x.symbols)||x.symbols.length!==2||
     x.symbols[0]!=='XAUUSD'||x.symbols[1]!=='BTCUSD'||
     !Number.isSafeInteger(x.capturedAt)||Math.abs(x.capturedAt-Number(timestamp))>2)
    return {status:'REJECTED',wire:null};
  // Both EAs must belong to the SAME independently isolated DEMO account.
  // Legacy read-only snapshots without a signed login may still be used for
  // chart research, but they MUST NEVER authorize broker execution.
  const observed=x.symbols.map(symbol=>quoteProvider(symbol))
    .filter(s=>s&&Number.isSafeInteger(s.timestamp)&&
      s.timestamp<=clock()&&clock()-s.timestamp<=10);
  if(!observed.length)return {status:'WAITING_FOR_SENSOR',wire:null};
  if(observed.some(s=>s.brokerServer!==x.brokerServer))
    return {status:'BROKER_MISMATCH',wire:null};
  if(observed.some(s=>!Number.isSafeInteger(s.accountLogin)||s.accountLogin<=0))
    return {status:'SENSOR_ACCOUNT_UNVERIFIED',wire:null};
  if(observed.some(s=>s.accountLogin!==x.accountLogin))
    return {status:'WRONG_DEMO_ACCOUNT',wire:null};
  if(registeredDemoLogin!==null&&
     (registeredDemoLogin!==x.accountLogin||registeredDemoServer!==x.brokerServer))
    return {status:'WRONG_DEMO_ACCOUNT',wire:null};
  if(registeredDemoLogin===null){
    registeredDemoLogin=x.accountLogin;registeredDemoServer=x.brokerServer;
  }
  lastExecutorSeen=clock();
  const wire=take(x.symbols,x.brokerServer);
  return {status:wire?'INTENT_DELIVERED':'NO_INTENT',wire,liveTrading:false};
 }

 // Signed HTTP ACK is audit-only; this method never authorizes any additional trade.
 function ack({body,timestamp,mac,secure=false}={}){
  if(!enabled||!keyReady||!secure)return {status:'REJECTED'};
  if(typeof body!=='string'||body.length>1000||
     typeof timestamp!=='string'||!/^\d{10}$/.test(timestamp)||
     Math.abs(clock()-Number(timestamp))>10||typeof mac!=='string'||
     !/^[a-f0-9]{64}$/.test(mac))return {status:'REJECTED'};
  const expected=signature(secret,timestamp+'\n'+body);
  if(!timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(mac,'hex')))
   return {status:'REJECTED'};
  let parsed;try{parsed=JSON.parse(body)}catch{return {status:'REJECTED'}}
  if(!parsed||typeof parsed.id!=='string'||!delivered.has(parsed.id)||
     !['FILLED','REJECTED'].includes(parsed.status)||
     parsed.accountType!=='DEMO'||!Number.isSafeInteger(parsed.accountLogin)||
     parsed.accountLogin<=0||parsed.accountLogin!==registeredDemoLogin||
     !Number.isSafeInteger(parsed.occurredAt)||
     Math.abs(parsed.occurredAt-clock())>30)return {status:'REJECTED'};
  if(acks.has(parsed.id))return {status:'DUPLICATE'};
  const deliveredIntent=delivered.get(parsed.id);
  if(parsed.occurredAt<deliveredIntent.deliveredAt-2||parsed.occurredAt>deliveredIntent.expires+30)
    return {status:'REJECTED'};
  const dealTicketValid=Number.isSafeInteger(parsed.brokerDealTicket)&&parsed.brokerDealTicket>0;
  const retcodeValid=[10009,10010].includes(parsed.tradeRetcode);
  const volumeValid=finite(parsed.executedVolume)&&parsed.executedVolume>0&&parsed.executedVolume<=1000;
  const hasBrokerReference=parsed.status==='FILLED'&&dealTicketValid&&retcodeValid&&volumeValid;
  // This is an authenticated EA claim with deal reference, NOT independent
  // broker verification. Never label this as independent broker confirmation.
  const status=parsed.status==='FILLED'?
    (hasBrokerReference?'EA_REPORTED_FILL_WITH_DEAL':'UNVERIFIED_EA_FILL_CLAIM'):'EA_REPORTED_REJECTION';
  acks.set(parsed.id,{status,at:clock(),hasBrokerReference});
  lastAckAt=clock();
  audit(deliveredIntent.symbol,status);
  return {status:'RECORDED'};
 }
 function report(){
  return {enabled:enabled&&keyReady,status:!enabled?'OFF':!keyReady?'SECRET_NOT_CONFIGURED':'DEMO_INTENTS_ARMED',
   mode:'ISOLATED_DEMO_ONLY',created,delivered:pulled,rejected,
   brokerAcks:acks.size,filledAcks:[...acks.values()].filter(x=>x.hasBrokerReference).length,
   eaUnverifiedFillClaims:[...acks.values()].filter(x=>x.status==='UNVERIFIED_EA_FILL_CLAIM').length,
   brokerIndependentlyVerifiedFills:0,
   queued:[...queue.keys()],lastBySymbol,executorRegistered:registeredDemoLogin!==null,
   executorOnline:lastExecutorSeen!==null&&clock()>=lastExecutorSeen&&clock()-lastExecutorSeen<=15,
   lastExecutorSeenAt:lastExecutorSeen===null?null:new Date(lastExecutorSeen*1000).toISOString(),
   lastAckAt:lastAckAt===null?null:new Date(lastAckAt*1000).toISOString(),
   brokerFeedMismatch,
   tradeCountVerifiedByBroker:false,
   liveTrading:false,serverPlacesOrders:false,dailyLimitsEnforcedByEA:true};
 }
 return {consider,pull,ack,report};
}
