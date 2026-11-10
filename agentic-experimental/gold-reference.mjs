// Isolated, read-only XAU/USD candle adapter. No broker quote, SL/TP, or trading.
const TF={M5:['5min',300],M15:['15min',900],H1:['1h',3600],H4:['4h',14400]};
function timestamp(s) {
 if(typeof s!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/.test(s))throw Error('GOLD_TIME_FORMAT');
 const n=Date.parse(s.replace(' ','T')+'Z')/1000;
 if(!Number.isSafeInteger(n))throw Error('GOLD_BAD_TIME');
 return n;
}
export function parseGoldTimeSeries(data,seconds,now){
 if(data?.status==='error'||!Array.isArray(data?.values)||data.values.length<3)throw Error('GOLD_PROVIDER_RESPONSE');
 if(data.meta?.symbol!=='XAU/USD')throw Error('GOLD_SYMBOL_MISMATCH');
 const ordered=data.values.map(v=>({time:timestamp(v.datetime),open:Number(v.open),high:Number(v.high),low:Number(v.low),close:Number(v.close)}))
  .sort((a,b)=>a.time-b.time);
 for(let i=0;i<ordered.length;i++){
  const x=ordered[i];
  if(![x.open,x.high,x.low,x.close].every(n=>Number.isFinite(n)&&n>0)||
     x.low>Math.min(x.open,x.close)||x.high<Math.max(x.open,x.close)||
     (i&&x.time<=ordered[i-1].time))throw Error('GOLD_INVALID_CANDLE');
 }
 const closed=ordered.filter(x=>x.time+seconds<=now);
 if(closed.length<2)throw Error('GOLD_NOT_ENOUGH_CLOSED_CANDLES');
 // Gold has session gaps. Require recent consecutive bars before accepting a signal.
 if(closed.at(-1).time-closed.at(-2).time!==seconds)throw Error('GOLD_SESSION_GAP');
 if(now-(closed.at(-1).time+seconds)>seconds+90)throw Error('GOLD_STALE_CANDLES');
 return closed;
}
export async function fetchGoldReference({key,fetcher=fetch,now=Math.floor(Date.now()/1000)}={}){
 if(!key||typeof key!=='string')throw Error('GOLD_PROVIDER_NOT_CONFIGURED');
 const bars={};
 for(const [tf,[interval,seconds]] of Object.entries(TF)){
  const u=new URL('https://api.twelvedata.com/time_series');
  for(const [k,v] of Object.entries({symbol:'XAU/USD',interval,outputsize:'8',timezone:'UTC',apikey:key}))u.searchParams.set(k,v);
  const response=await fetcher(u.toString(),{signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('GOLD_PROVIDER_HTTP_'+response.status);
  bars[tf]=parseGoldTimeSeries(await response.json(),seconds,now);
 }
 return {symbol:'XAUUSD',marketSymbol:'XAU/USD',source:'TWELVE_DATA_REFERENCE',
  executable:false,brokerCompatible:false,hasBrokerBidAsk:false,newsCoverage:'UNVERIFIED',now,bars};
}
