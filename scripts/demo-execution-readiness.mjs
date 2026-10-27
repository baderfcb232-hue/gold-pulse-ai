const base='https://gold-pulse-ai.onrender.com';
const urls=['/healthz','/api/state','/api/market'];
const now=new Date().toISOString();
const report={time:now};
for(const path of urls){
 try{
  const r=await fetch(base+path,{signal:AbortSignal.timeout(15000),headers:{Accept:'application/json'}});
  const data=await r.json();
  if(path==='/healthz'){
   report.health={http:r.status,mt5:data.mt5,market:data.markets?.XAUUSD,
     costs:data.publication?.costs,publication:data.publication?.reason,
     telegram:data.publication?.telegram?.verification?.state,
     bridge:data.websiteBridge};
  }else if(path==='/api/state'){
   report.state={http:r.status,connection:data.connection,quoteAge:data.quoteAge,
     websiteExecution:data.websiteExecution,bridge:data.websiteBridge,
     strategy:data.strategy,signal:data.currentSignal?{
       side:data.currentSignal.side,strategy:data.currentSignal.strategy,issued_at:data.currentSignal.issued_at,
       expires_at:data.currentSignal.expires_at,bar_time:data.currentSignal.bar_time,status:data.currentSignal.status
     }:null,execution:data.execution?{
       demo:data.execution.demo,enabled:data.execution.enabled,paused:data.execution.paused,
       main_connected:data.execution.main_connected,website_recommendations:data.execution.website_recommendations,
       demo_recommendations:data.execution.demo_recommendations,remote_control:data.execution.remote_control,
       news_filter:data.execution.news_filter,
       risk_percent:data.execution.risk_percent,max_daily_loss_percent:data.execution.max_daily_loss_percent,
       website_since:data.execution.website_since
     }:null};
  }else{
   const m=data.markets?.XAUUSD;
   report.market={http:r.status,connection:m?.connection,quoteAge:m?.quoteAge,
     status:m?.analysis?.status,reason:m?.analysis?.reason,strategy:m?.analysis?.strategy,
     execution:m?.execution,signal:m?.currentSignal?{
       side:m.currentSignal.side,strategy:m.currentSignal.strategy,issued_at:m.currentSignal.issued_at,
       expires_at:m.currentSignal.expires_at,bar_time:m.currentSignal.bar_time,status:m.currentSignal.status
     }:null,
     recent:m?.recentSignals?.slice(0,10).map(p=>({side:p.side,strategy:p.strategy,status:p.status,
       issued_at:p.issued_at,expires_at:p.expires_at,bar_time:p.bar_time,reported_at:p.reported_at}))};
  }
 }catch(e){report[path]={error:String(e)}}
}
console.log('NABD_LIVE_DEMO_CHAIN '+JSON.stringify(report));
