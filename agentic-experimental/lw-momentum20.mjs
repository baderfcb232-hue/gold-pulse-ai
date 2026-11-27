// Research-only daily volatility breakout, independently observed on closed M5.
import {createHash} from 'node:crypto';
export const LW_POLICY='LW_MOMENTUM20_BIDIRECTIONAL_V1';
const epoch=x=>Number.isSafeInteger(x)&&x>0;
const pos=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const ohlc=b=>b&&epoch(b.time)&&[b.open,b.high,b.low,b.close].every(pos)&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close);
const round=x=>Number(x.toPrecision(10));
// D1 broker position 0 contributes only open/start. Never use its evolving high,
// low, close or volume. A newer observed session start proves prior bars closed.
export function validateDailySession(value,now){
 if(!value||!epoch(now)||!epoch(value.start)||value.start%300!==0||!pos(value.open)||value.start>now||now-value.start>=86400*1.1)return null;
 const a=value.closed;
 if(!Array.isArray(a)||a.length<21||a.length>60||a.some((b,i)=>!ohlc(b)||b.time%300!==0||b.time>=value.start||(i>0&&(b.time-a[i-1].time<20*3600||b.time-a[i-1].time>4*86400))))return null;
 if(value.start-a.at(-1).time<20*3600||value.start-a.at(-1).time>4*86400)return null;
 return {start:value.start,open:value.open,closed:a.slice(-21).map(({time,open,high,low,close})=>({time,open,high,low,close}))};
}
export function lwEvidence(q){
 const base={version:LW_POLICY,advisoryOnly:true,executionPermission:false,thresholdsValidated:false,riskReferencePct:.4};
 if(q?.symbol!=='XAUUSD')return {...base,status:'GOLD_RESEARCH_ONLY'};
 const d=validateDailySession(q.dailySession,q.timestamp);
 if(!d)return {...base,status:'WAITING_VERIFIED_BROKER_D1'};
 const a=q.candlesM5,t=q.timestamp;
 if(!Array.isArray(a)||a.length<2||!epoch(t)||a.slice(-2).some(b=>!ohlc(b)||b.time%300!==0||b.time+300>t))return {...base,status:'WAITING_CLOSED_M5'};
 const last=a.at(-1),prev=a.at(-2);
 if(last.time-prev.time!==300||prev.time<d.start||t-last.time-300>300)return {...base,status:'WAITING_CONTIGUOUS_SESSION_M5'};
 const first=a.find(b=>b.time===d.start);
 if(first&&Math.abs(first.open-d.open)>Math.max(1e-7,Math.abs(d.open)*1e-8))return {...base,status:'D1_M5_OPEN_MISMATCH'};
 const old=d.closed[0],p=d.closed.at(-1),range=p.high-p.low,dist=range*.5;
 if(!(dist>0))return {...base,status:'INVALID_PREVIOUS_RANGE'};
 const buy=d.open+dist,sell=d.open-dist;
 if(!pos(sell-4*dist))return {...base,status:'INVALID_PROJECTED_LEVELS'};
 const momentum=round(p.close-old.close),direction=momentum>0?'UP':momentum<0?'DOWN':'FLAT';
 const cross=prev.close<=buy&&last.close>buy?'BUY':prev.close>=sell&&last.close<sell?'SELL':null;
 const candidate=cross==='BUY'&&direction==='UP'||cross==='SELL'&&direction==='DOWN'?cross:null;
 const stop=candidate==='BUY'?buy-dist:candidate==='SELL'?sell+dist:null;
 const target=candidate==='BUY'?buy+4*dist:candidate==='SELL'?sell-4*dist:null;
 const spread=pos(q.bid)&&pos(q.ask)&&q.ask>q.bid?q.ask-q.bid:null;
 // Current quotes are not the next-bar opening fills assumed in historical replay.
 const fill=candidate==='BUY'?q.ask:candidate==='SELL'?q.bid:null;
 const validFill=candidate&&pos(fill)&&spread!==null&&spread<=2.5&&(candidate==='BUY'?fill>stop&&fill<target:fill<stop&&fill>target);
 return {...base,status:candidate?(validFill?'OBSERVED_CANDIDATE':'CANDIDATE_QUOTE_BLOCKED'):'NO_ALIGNED_CROSS',
   sessionStart:d.start,closedBar:last.time,momentum20:momentum,direction,previousRange:round(range),
   buyLevel:round(buy),sellLevel:round(sell),cross,candidate,stopReference:stop===null?null:round(stop),
   targetReference:target===null?null:round(target),fillVerified:false,spreadGatePassed:!!validFill};
}
export function lwFeedKey(q){
 if(q?.environment!=='EXPERIMENTAL_NABD_AGENTIC'||q.accountType!=='DEMO'||q.executionEnabled!==false||
 typeof q.brokerServer!=='string'||!q.brokerServer.toLowerCase().includes('demo')||!epoch(q.accountLogin)||typeof q.brokerSymbol!=='string'||!q.brokerSymbol)return null;
 return createHash('sha256').update(JSON.stringify([q.brokerServer,q.accountLogin,q.brokerSymbol])).digest('hex');
}
export function createLWStore({query}){
 return {
  async observe(q){const feed=lwFeedKey(q),e=lwEvidence(q);if(!feed||!e.candidate||!e.closedBar)return {inserted:false,status:e.status};
   const r=await query("INSERT INTO agentic_research.lw_momentum20_candidates(feed,closed_bar,side,status,evidence) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING",[feed,e.closedBar,e.candidate,e.status,JSON.stringify(e)]);
   return {inserted:r.rowCount===1,status:e.status,side:e.candidate};
  },
  async report(){const r=await query("SELECT side,status,count(*)::int AS candidates FROM agentic_research.lw_momentum20_candidates GROUP BY side,status ORDER BY side,status",[]);return {version:LW_POLICY,candidates:r.rows,executionPermission:false,profitabilityEstablished:false};}
 };
}
