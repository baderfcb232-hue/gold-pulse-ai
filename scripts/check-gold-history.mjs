// Public feed availability only. This diagnostic cannot place orders, read private
// account data, or substitute short histories for a broker backtest.
const base='https://gold-pulse-ai.onrender.com';
const seconds={M5:300,M15:900,H1:3600,H4:14400};
const info={};
for(const [tf,step] of Object.entries(seconds)){
  try {
    const response=await fetch(base+'/api/market/candles?symbol=XAUUSD&tf='+tf,
      {signal:AbortSignal.timeout(15000),headers:{Accept:'application/json'}});
    if(!response.ok)throw new Error('HTTP_'+response.status);
    const item=await response.json();
    const rows=item.candles;
    if(!Array.isArray(rows))throw new Error('No candle array');
    const valid=rows.every((c,i)=>Number.isFinite(c.time)&&Number.isFinite(c.close)
      && c.close>0&&(i===0||c.time>rows[i-1].time)
      && c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close));
    info[tf]={bars:rows.length,valid,first:rows[0]?.time,last:rows.at(-1)?.time,
      daysOfCoverage:rows.length*step/86400,source:item.source||null};
  }catch(error){info[tf]={error:String(error?.message||error)}}
}
console.log('PUBLIC_BROKER_CANDLE_COVERAGE '+JSON.stringify(info));
const m5=info.M5;
const months=m5?.daysOfCoverage/30||0;
// Genuine multi-regime performance evaluation needs many weeks/months,
// trading costs and high-impact news archive, not a rolling 320-candle window.
const qualifies=Boolean(m5?.valid&&months>=3&&info.M15?.valid&&info.H1?.valid&&info.H4?.valid);
console.log('PRODUCTION_SWITCH_ELIGIBLE '+qualifies);
if(!qualifies)console.log('HISTORICAL_DATA_INSUFFICIENT: Keep existing Demo strategy unchanged.');


// Inspect current indicator directions without creating an order.
try {
  const response=await fetch(base+'/api/market',{signal:AbortSignal.timeout(15000)});
  const data=await response.json();
  const market=data.markets?.XAUUSD;
  const frames=market?.analysis?.frames||{};
  const trends=Object.fromEntries(Object.entries(frames).map(([tf,f])=>[tf,{
    direction:f.direction,ema8:f.ema8,ema21:f.ema21,ema200:f.ema200,atr14:f.atr14,close:f.close
  }]));
  console.log('CURRENT_MARKET_TRENDS '+JSON.stringify({
    connection:market?.connection,status:market?.analysis?.status,
    reason:market?.analysis?.reason,frames:trends
  }));
} catch(error){console.log('CURRENT_MARKET_TRENDS_UNAVAILABLE '+String(error?.message||error));}
