import {analyze,ema,rsi,atr,defaults,TF_SECONDS} from '../engine.mjs';

// Gold-only broker OHLC scalping recommendations. No network, account action or execution.
export const GOLD_SCALP_STRATEGY='NABD-GOLD-SCALP-M5M15-V1';
const aligned=(price,spec,mode='nearest')=>{
  const calc=mode==='up'?Math.ceil:mode==='down'?Math.floor:Math.round;
  return Number((calc(price/spec.tick_size)*spec.tick_size).toFixed(spec.digits));
};
const isBuy=x=>x==='BUY';
export function analyzeGoldScalp(snapshot,now=Date.now()/1000,settings=defaults){
  const cfg={...defaults,...settings},legacy=analyze(snapshot,now,cfg);
  const state={...legacy,strategy:GOLD_SCALP_STRATEGY,decision:'WAIT',checks:[],score:null,
    reasons:[],plan:null,risk:'CAUTION'};
  if(!snapshot || legacy.connection!=='LIVE')
    return {...state,risk:'BLOCKED',reasons:legacy.reasons};
  const frames=legacy.frames;
  if(Object.values(frames).some(f=>f.direction==='UNKNOWN'))
    return {...state,reasons:['بانتظار 220 شمعة مغلقة لكل فريم.']};
  if(Object.entries(TF_SECONDS).some(([tf,step])=>{
    const last=snapshot.candles[tf].at(-1);
    return !last||now-(last.time+step)>step+120;
  })) return {...state,reasons:['بيانات الشموع متأخرة؛ لن نصدر إشارة سكالبينغ.']};
  const spread=(snapshot.ask-snapshot.bid)/snapshot.spec.point;
  if(!Number.isFinite(spread)||spread>cfg.maxSpreadPoints)
    return {...state,risk:'BLOCKED',reasons:['السبريد أعلى من الحد المسموح.']};
  const cal=snapshot.calendar;
  if(cal?.status!=='ok'||!cal.updated_at||now-cal.updated_at>cfg.calendarTtl)
    return {...state,risk:'BLOCKED',reasons:['فلتر الأخبار غير متاح أو قديم.']};
  const news=cal.events.find(e=>e.currency==='USD'&&e.importance===3
    &&e.time-cfg.newsBefore<=now&&e.time+cfg.newsAfter>=now);
  if(news)return {...state,risk:'BLOCKED',news_block:news,
    reasons:['خبر دولار عالي الأهمية يمنع الدخول: '+news.name]};

  const m5=snapshot.candles.M5,m15=snapshot.candles.M15;
  const last=m5.at(-1),prev=m5.at(-2),recent=m5.slice(-4,-1);
  const closes5=m5.map(c=>c.close),closes15=m15.map(c=>c.close);
  const e8=ema(closes5,8),e21=ema(closes5,21),e15fast=ema(closes15,8),e15slow=ema(closes15,21);
  const v=atr(m5,14),strength=rsi(closes5,14);
  if(!(v>0))return {...state,reasons:['ATR غير صالح.']};
  // EMA200 is deliberately not a mandatory M15/H1 agreement requirement.
  const side=e15fast>e15slow&&m15.at(-1).close>e15slow?'BUY':
    e15fast<e15slow&&m15.at(-1).close<e15slow?'SELL':null;
  if(!side)return {...state,reasons:['انتظار اتجاه واضح على M15.']};
  const buy=isBuy(side),counterTrend=frames.H4.direction===(buy?'SELL':'BUY');
  const trend5=buy?e8>e21&&last.close>e8:e8<e21&&last.close<e8;
  const momentum=buy?strength>=50&&strength<=80:strength>=20&&strength<=50;
  // Closed M5 break above/below recent candle levels; stricter on H4 countertrend.
  const previousBoundary=buy?Math.max(...recent.map(c=>c.high)):Math.min(...recent.map(c=>c.low));
  const breaks=buy?last.close> (counterTrend?previousBoundary:prev.high) :
    last.close<(counterTrend?previousBoundary:prev.low);
  const candle=buy?last.close>last.open:last.close<last.open;
  const confirm=candle&&breaks&&Math.abs(last.close-last.open)>=v*(counterTrend?.20:.12);
  const near=Math.abs((buy?snapshot.ask:snapshot.bid)-last.close)<=v*.6;
  const costs=(snapshot.ask-snapshot.bid)<=v*.25&&spread<=cfg.maxSpreadPoints;
  const counterMomentum=!counterTrend||(buy?strength>=55:strength<=45);
  const checks=[
    {name:'توجه EMA8/21 على M15',pass:true,weight:20},
    {name:'تأكيد EMA8/21 على M5',pass:trend5,weight:20},
    {name:'اختراق شمعة M5 مغلقة',pass:confirm,weight:25},
    {name:'زخم RSI5 ملائم',pass:momentum&&counterMomentum,weight:15},
    {name:'السعر قريب من إغلاق الإشارة',pass:near,weight:10},
    {name:'سبريد ملائم بالنسبة إلى ATR',pass:costs,weight:10}
  ];
  const score=checks.reduce((n,c)=>n+(c.pass?c.weight:0),0);
  const assessed={...state,checks,score,
    reasons:checks.filter(c=>!c.pass).map(c=>c.name),
    risk:counterTrend?'CAUTION':'ASSESSED'};
  if(checks.some(c=>!c.pass))return assessed;
  const entry=aligned(buy?snapshot.ask:snapshot.bid,snapshot.spec);
  const swing=buy?Math.min(...m5.slice(-5).map(c=>c.low)):Math.max(...m5.slice(-5).map(c=>c.high));
  const tick=snapshot.spec.tick_size,stops=(snapshot.spec.stops_points*snapshot.spec.point)+tick;
  const distance=Math.max(v*.8,buy?entry-swing+v*.12:swing-entry+v*.12,
    stops+snapshot.ask-snapshot.bid);
  if(distance>v*2.5)return {...assessed,risk:'CAUTION',
    reasons:['مسافة وقف الخسارة كبيرة مقارنة بتذبذب M5.']};
  const sl=aligned(entry+(buy?-distance:distance),snapshot.spec,buy?'down':'up');
  const riskDistance=Math.abs(entry-sl);
  if(!(riskDistance>tick&&sl>0))return {...assessed,reasons:['مستويات وقف خسارة غير صالحة.']};
  const sign=buy?1:-1;
  const tp1=aligned(entry+sign*riskDistance,snapshot.spec);
  const tp2=aligned(entry+sign*riskDistance*1.5,snapshot.spec);
  const plan={strategy:GOLD_SCALP_STRATEGY,symbol:snapshot.symbol,side,
    bar_time:last.time,issued_at:Math.floor(now),expires_at:Math.floor(now+300),
    timeframe:'M5',entry,sl,tp1,tp2,risk_distance:riskDistance,score,
    reason:'سكالبينغ EMA8/21 + إغلاق M5 مؤكد'+(counterTrend?' (عكس اتجاه H4؛ مخاطرة أعلى)':''),
    tracking:'VIRTUAL',tp1_hit:false,status:'TRACKING'};
  return {...assessed,decision:side,plan,reasons:[plan.reason]};
}
