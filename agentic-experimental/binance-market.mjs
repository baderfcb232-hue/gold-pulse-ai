// NABD EXPERIMENTAL: public BTCUSDT spot reference market feed, never broker execution data.
export const BTC_REFERENCE_SOURCE = 'BINANCE_SPOT_BTCUSDT_REFERENCE_ONLY';
const BASE = 'https://data-api.binance.vision';
const PERIODS = Object.freeze({M5:['5m',300],M15:['15m',900],H1:['1h',3600],H4:['4h',14400]});
function validPrice(n){return Number.isFinite(n)&&n>0;}
async function readJSON(fetcher, path){
  const response=await fetcher(BASE+path,{method:'GET',headers:{accept:'application/json'},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('REFERENCE_FEED_HTTP_'+response.status);
  return response.json();
}
export function parseKlines(raw,period,now){
  if(!Array.isArray(raw)||raw.length<3||raw.length>1000)throw Error('INVALID_KLINES');
  const candles=raw.map(row=>{
    if(!Array.isArray(row)||row.length<7)throw Error('INVALID_KLINE_ROW');
    const t=Number(row[0]),end=Number(row[6]);
    const [open,high,low,close]=[row[1],row[2],row[3],row[4]].map(Number);
    if(!Number.isSafeInteger(t)||t%1000!==0||!Number.isSafeInteger(end)||
      end!==t+period*1000-1||![open,high,low,close].every(validPrice)||
      low>Math.min(open,close)||high<Math.max(open,close)||low>high)throw Error('INVALID_KLINE_ROW');
    return {time:t/1000,open,high,low,close};
  });
  for(let i=1;i<candles.length;i++)if(candles[i].time-candles[i-1].time!==period)throw Error('KLINE_GAP');
  const closed=candles.filter(c=>c.time+period<=now);
  if(closed.length<2)throw Error('NOT_ENOUGH_CLOSED_BARS');
  if(now-(closed.at(-1).time+period)>period+90)throw Error('STALE_CANDLES');
  return closed;
}
export function parseBookTicker(book,now){
  const bid=Number(book?.bidPrice),ask=Number(book?.askPrice);
  if(!validPrice(bid)||!validPrice(ask)||ask<bid)throw Error('INVALID_BID_ASK');
  // No native quote timestamp on this endpoint. Timestamp is local observation, not exchange quote age.
  return {bid,ask,time:now,timestampKind:'local_observed_at'};
}
export async function fetchBtcReference({fetcher=fetch,now=Math.floor(Date.now()/1000)}={}){
  if(!Number.isSafeInteger(now)||now<=0)throw Error('INVALID_NOW');
  const names=Object.entries(PERIODS);
  const paths=names.map(([,v])=>'/api/v3/klines?symbol=BTCUSDT&interval='+v[0]+'&limit=5');
  const data=await Promise.all([...paths,'/api/v3/ticker/bookTicker?symbol=BTCUSDT'].map(p=>readJSON(fetcher,p)));
  const bars={};
  names.forEach(([name,[,seconds]],i)=>{bars[name]=parseKlines(data[i],seconds,now);});
  return {symbol:'BTCUSD',marketSymbol:'BTCUSDT',source:BTC_REFERENCE_SOURCE,
    executable:false,brokerCompatible:false,newsCoverage:'NOT_CONNECTED',
    now,quote:parseBookTicker(data.at(-1),now),bars};
}
