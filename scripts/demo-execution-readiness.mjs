const base='https://gold-pulse-ai.onrender.com',paths=['/healthz','/api/market'];
const reports={};
for(const path of paths){
 try{
  const response=await fetch(base+path,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(14000)});
  const item=await response.json();
  if(path==='/healthz')reports.health={
   checkedAt:new Date().toISOString(),httpStatus:response.status,serverVersion:item.version,
   brokerConnection:item.mt5?.connection,quoteAge:item.mt5?.quoteAgeSeconds,
   market:item.markets?.XAUUSD,telegram:item.publication?.telegram?.verification?.state,
   publicationReason:item.publication?.reason,costStatus:item.publication?.costs,
   websiteBridge:item.websiteBridge};
  else{
   const x=item.markets?.XAUUSD;
   reports.market={httpStatus:response.status,connection:x?.connection,
    analysisStatus:x?.analysis?.status,reason:x?.analysis?.reason,
    currentSignalVisible:Boolean(x?.currentSignal),
    entryStatus:x?.execution?.reason,websiteMode:x?.execution_mode,
    quoteAge:x?.quoteAge};
  }
 }catch(error){reports[path]={error:String(error)}}
}
console.log('NABD_LIVE_E2E_READINESS '+JSON.stringify(reports));
