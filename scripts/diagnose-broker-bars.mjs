const base='https://gold-pulse-ai.onrender.com',now=Date.now()/1000;
const sizes={M5:300,M15:900,H1:3600,H4:14400};
console.log('GOLD_TIME_NOW',new Date(now*1000).toISOString());
for(const [tf,secs] of Object.entries(sizes)){
 try{
  const r=await fetch(base+'/api/market/candles?symbol=XAUUSD&tf='+tf,{signal:AbortSignal.timeout(13000)});
  const v=await r.json(),a=v.candles||[],c=a.at(-1),before=a.at(-2);
  console.log('GOLD_BAR',JSON.stringify({tf,status:r.status,bars:a.length,source:v.source,last:c?.time,
   previous:before?.time,lastISO:c?.time?new Date(c.time*1000).toISOString():null,
   ageSeconds:c?Math.round(now-c.time-secs):null,
   lastClosedSeconds:c?.time?c.time+secs:null,lastDelta:c&&before?c.time-before.time:null,
   lastClose:c?.close}));
 }catch(e){console.log('GOLD_ERROR',tf,String(e))}
}
for(const path of ['/healthz','/api/market']){
 try{
  const r=await fetch(base+path,{signal:AbortSignal.timeout(13000)}),v=await r.json();
  if(path==='/healthz') console.log('GOLD_HEALTH',JSON.stringify({status:r.status,mt5:v.mt5,markets:v.markets?.XAUUSD,publication:v.publication?.telegram}));
  else{
    const v1=v.markets?.XAUUSD;console.log('GOLD_MARKET',JSON.stringify({status:r.status,connection:v1?.connection,quoteTime:v1?.quote?.time,quoteAge:v1?.quoteAge,analysis:v1?.analysis?.status,reason:v1?.analysis?.reason,trend:Object.fromEntries(Object.entries(v1?.analysis?.frames||{}).map(([tf,s])=>[tf,s.direction]))}));
  }
 }catch(e){console.log('GOLD_ERROR',path,String(e))}
}
