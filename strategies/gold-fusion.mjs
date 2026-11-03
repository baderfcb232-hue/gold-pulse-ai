// GOLD ONLY. Regime-aware M5/M15 signals from closed MT5 candles.
// Indicator votes are heuristics, NOT win probabilities. No broker/order API.
import {analyze,ema,rsi,atr,candleZones,TF_SECONDS,defaults} from '../engine.mjs';
import {goldNewsWindow,goldNewsScalpShadow} from './gold-news-scalp.mjs';

export const GOLD_FUSION_STRATEGY='NABD-GOLD-REGIME-FUSION-V1';
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
const ext=(bars,key)=>key==='high'?Math.max(...bars.map(b=>b.high)):Math.min(...bars.map(b=>b.low));
const round=(n,spec,mode='nearest')=>{
  const op=mode==='down'?Math.floor:mode==='up'?Math.ceil:Math.round;
  return Number((op(n/spec.tick_size)*spec.tick_size).toFixed(spec.digits));
};
const sideOf=(fast,slow,price)=>fast>slow&&price>slow?'BUY':fast<slow&&price<slow?'SELL':'WAIT';
const span=(bars,n)=>({high:ext(bars.slice(-n),'high'),low:ext(bars.slice(-n),'low')});
const oscillator=(bars,n=14)=>{
  const {high,low}=span(bars,n);
  return high>low?100*(bars.at(-1).close-low)/(high-low):50;
};
const bands=(closes,n=20,k=2)=>{
  const x=closes.slice(-n),avg=mean(x);
  const variance=mean(x.map(p=>(p-avg)**2));
  return {middle:avg,upper:avg+k*Math.sqrt(variance),lower:avg-k*Math.sqrt(variance)};
};
const vwap=(bars,n=40)=>{
  let value=0,volume=0;
  for(const b of bars.slice(-n)){
    const v=Number.isFinite(b.tick_volume)?b.tick_volume:0;
    value+=((b.high+b.low+b.close)/3)*v;volume+=v;
  }
  return volume>0?value/volume:null; // broker tick-volume proxy, not exchange VWAP.
};
const macd=(closes)=>{
  if(closes.length<55)return {histogram:null,cross:null};
  const history=[];
  for(let i=35;i<closes.length;i++) {
    const x=closes.slice(0,i+1);
    history.push(ema(x,12)-ema(x,26));
  }
  const signal=ema(history,9),priorSignal=ema(history.slice(0,-1),9);
  const histogram=history.at(-1)-signal;
  const previous=history.at(-2)-priorSignal;
  return {histogram,cross:previous<=0&&histogram>0?'BUY':
    previous>=0&&histogram<0?'SELL':null};
};
const adx=(bars,n=14)=>{
  if(bars.length<n*3)return null;
  const dx=[];
  let tr=0,plus=0,minus=0;
  for(let i=1;i<bars.length;i++) {
    const c=bars[i],p=bars[i-1],up=c.high-p.high,down=p.low-c.low;
    const range=Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close));
    const plusDm=up>down&&up>0?up:0,minusDm=down>up&&down>0?down:0;
    if(i<=n){tr+=range;plus+=plusDm;minus+=minusDm;}
    else {tr=tr-tr/n+range;plus=plus-plus/n+plusDm;minus=minus-minus/n+minusDm;}
    if(i<n)continue;
    const pdi=tr?plus/tr*100:0,mdi=tr?minus/tr*100:0;
    dx.push(pdi+mdi?100*Math.abs(pdi-mdi)/(pdi+mdi):0);
  }
  let result=mean(dx.slice(0,n));
  for(const v of dx.slice(n))result=((n-1)*result+v)/n;
  return result;
};
const supertrend=(bars,period=14,multiplier=2)=>{
  if(bars.length<period+2)return 'WAIT';
  let atrValue=null,upper=0,lower=0,trend='WAIT';
  let ranges=[];
  for(let i=1;i<bars.length;i++) {
    const b=bars[i],p=bars[i-1];
    const range=Math.max(b.high-b.low,Math.abs(b.high-p.close),Math.abs(b.low-p.close));
    ranges.push(range);
    if(i<period)continue;
    if(i===period)atrValue=mean(ranges.slice(0,period));
    else atrValue=(atrValue*(period-1)+range)/period;
    const mid=(b.high+b.low)/2;
    const basicU=mid+multiplier*atrValue,basicL=mid-multiplier*atrValue;
    if(i===period){upper=basicU;lower=basicL;trend=b.close>=mid?'BUY':'SELL';continue;}
    const oldUpper=upper,oldLower=lower;
    upper=basicU<oldUpper||p.close>oldUpper?basicU:oldUpper;
    lower=basicL>oldLower||p.close<oldLower?basicL:oldLower;
    if(trend==='BUY'&&b.close<oldLower)trend='SELL';
    else if(trend==='SELL'&&b.close>oldUpper)trend='BUY';
  }
  return trend;
};
const cloud=(bars)=>{
  const mid=n=>{const s=span(bars,n);return(s.high+s.low)/2};
  if(bars.length<52)return null;
  const tenkan=mid(9),kijun=mid(26),senkouA=(tenkan+kijun)/2,senkouB=mid(52);
  return {tenkan,kijun,upper:Math.max(senkouA,senkouB),lower:Math.min(senkouA,senkouB)};
};
const candleSignals=(bars)=>{
  const b=bars.at(-1),p=bars.at(-2),body=Math.abs(b.close-b.open);
  const engulfBuy=b.close>b.open&&p.close<p.open&&b.close>=p.open&&b.open<=p.close;
  const engulfSell=b.close<b.open&&p.close>p.open&&b.open>=p.close&&b.close<=p.open;
  const lower=Math.min(b.close,b.open)-b.low,upper=b.high-Math.max(b.close,b.open);
  return {engulfBuy,engulfSell,pinBuy:lower>=body*2&&upper<=body,
    pinSell:upper>=body*2&&lower<=body,inside:b.high<p.high&&b.low>p.low};
};
const dailyContext=rows=>{
  if(!Array.isArray(rows)||rows.length<56)return {turtle20:'UNAVAILABLE',turtle55:'UNAVAILABLE',pivots:null};
  const previous=rows.at(-1),before=rows.slice(-56,-1);
  const turtle55=previous.close>ext(before,'high')?'BUY':
    previous.close<ext(before,'low')?'SELL':'NEUTRAL';
  const prior20=rows.slice(-21,-1);
  const turtle20=previous.close>ext(prior20,'high')?'BUY':
    previous.close<ext(prior20,'low')?'SELL':'NEUTRAL';
  const {high:h,low:l,close:c}=previous,pivot=(h+l+c)/3,range=h-l;
  return {turtle20,turtle55,pivots:{classic:pivot,r1:2*pivot-l,s1:2*pivot-h,
    camarillaR3:c+range*1.1/4,camarillaS3:c-range*1.1/4}};
};
const fibLevels=(bars)=>{
  const {high,low}=span(bars,34),width=high-low;
  return width>0?[.382,.5,.618].map(n=>low+n*width):[];
};
const fvg=(bars)=>{
  const c=bars.slice(-3);
  return c[2].low>c[0].high?'BUY':c[2].high<c[0].low?'SELL':'NONE';
};
const volumeProfile=(bars,bins=12)=>{
  const rows=bars.slice(-64),{high,low}=span(rows,rows.length),width=(high-low)/bins;
  if(width<=0)return null;
  const byBin=Array(bins).fill(0);
  for(const b of rows) {
    const index=Math.max(0,Math.min(bins-1,Math.floor(((b.high+b.low+b.close)/3-low)/width)));
    byBin[index]+=b.tick_volume||0;
  }
  const max=byBin.indexOf(Math.max(...byBin));
  return low+(max+.5)*width; // tick-volume-derived POC proxy.
};
const nyHour=seconds=>new Intl.DateTimeFormat('en-US',{
  timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23',
  year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(seconds*1000));
const openingRangeProxy=bars=>{
  const latest=nyHour(bars.at(-1).time).split(',')[0];
  const first=bars.filter(b=>nyHour(b.time).split(',')[0]===latest &&
    /, 08:(00|05|10)$/.test(nyHour(b.time)) /* not authoritative exchange session */);
  // ORB is descriptive-only until broker session boundaries are supplied.
  return first.length>=3?{high:ext(first.slice(0,3),'high'),low:ext(first.slice(0,3),'low'),validated:false}:null;
};

export function analyzeGoldFusion(snapshot,now=Date.now()/1000,settings=defaults) {
  const base=analyze(snapshot,now,settings);
  const empty={...base,strategy:GOLD_FUSION_STRATEGY,decision:'WAIT',
    plan:null,score:null,checks:[],risk:'CAUTION',regime:'WAIT',reasons:[]};
  const wait=(code,risk='CAUTION',extra={})=>({...empty,risk,reasons:[code],...extra});
  if(!/^XAUUSD(?:[._#][A-Za-z0-9._#-]+)?$/i.test(snapshot?.symbol||''))
    return wait('GOLD_ONLY', 'BLOCKED');
  if(base.connection!=='LIVE')return wait('STALE_OR_DISCONNECTED_GOLD_FEED','BLOCKED');
  if(Object.values(base.frames).some(x=>x.direction==='UNKNOWN'))
    return wait('NEED_220_CLOSED_M5_M15_H1_H4','BLOCKED');
  for(const tf of Object.keys(TF_SECONDS)) {
    const last=snapshot.candles?.[tf]?.at(-1),step=TF_SECONDS[tf];
    if(!last || now-(last.time+step)>step+120 || last.time+step>now+2)
      return wait('STALE_'+tf,'BLOCKED');
  }
  const spec=snapshot.spec,spread=snapshot.ask-snapshot.bid;
  if(!(spec?.point>0&&spec?.tick_size>0&&snapshot.bid>0&&snapshot.ask>=snapshot.bid))
    return wait('INVALID_GOLD_QUOTE_OR_CONTRACT','BLOCKED');
  const m5=snapshot.candles.M5,m15=snapshot.candles.M15,last=m5.at(-1),prev=m5.at(-2);
  const closes=m5.map(x=>x.close),atr5=atr(m5,14);
  const maxPoints=Math.min(settings.maxSpreadPoints||80,snapshot.ea?.settings?.max_spread_points||80);
  if(!(atr5>0) || spread/spec.point>maxPoints || spread>atr5*.20)
    return wait('GOLD_SPREAD_OR_ATR_UNSAFE','BLOCKED');
  if(Math.abs((snapshot.ask+snapshot.bid)/2-last.close)>atr5*.6)
    return wait('GOLD_PRICE_MOVED_FROM_CLOSED_BAR','BLOCKED');
  const news=goldNewsWindow(snapshot.calendar,now,{calendarTtl:settings.calendarTtl||900});
  if(news.blocked){
    const shadow=goldNewsScalpShadow(snapshot,now,news);
    return wait(news.code,'BLOCKED',{news_block:news.event,
      news_shadow:shadow,regime:'NEWS',
      reasons:['Scheduled USD event: '+news.code+'. News scalp is SHADOW-ONLY until MT5 Demo validation.']});
  }
  const m15Side=sideOf(ema(m15.map(x=>x.close),8),ema(m15.map(x=>x.close),21),m15.at(-1).close);
  const ma8=ema(closes,8),ma21=ema(closes,21),trend=sideOf(ma8,ma21,last.close);
  const mom=macd(closes),rel=rsi(closes,14),sto=oscillator(m5,14);
  const bb=bands(closes),volumeVwap=vwap(m5),adx5=adx(m5),st=supertrend(m5);
  const ich=cloud(m5),pattern=candleSignals(m5),daily=dailyContext(snapshot.daily_candles);
  const turtle20=daily.turtle20,turtle55=daily.turtle55,
    fib=fibLevels(m5),zones=candleZones(m5),fvgSide=fvg(m5),poc=volumeProfile(m5);
  const volumeAvg=mean(m5.slice(-21,-1).map(x=>x.tick_volume||0));
  const volumeConfirmed=volumeAvg>0&&last.tick_volume>=volumeAvg*1.15;
  const prior20=m5.slice(-21,-1),brBuy=last.close>ext(prior20,'high'),
    brSell=last.close<ext(prior20,'low');
  const breakout=volumeConfirmed && (brBuy||brSell) && adx5>=20;
  const regime=breakout?'BREAKOUT':adx5>=22&&m15Side!=='WAIT'?'TREND':
    adx5<19?'RANGE':'TRANSITION';
  if(regime==='TRANSITION')return wait('REGIME_TRANSITION_NO_ENTRY','CAUTION',{regime,indicators:{adx:adx5}});
  let side='WAIT',checks=[];
  const add=(name,pass,weight)=>checks.push({name,pass:Boolean(pass),weight});
  if(regime==='BREAKOUT') {
    side=brBuy?'BUY':brSell?'SELL':'WAIT';
    const buy=side==='BUY';
    add('20-bar M5 breakout with closed candle',side!=='WAIT',25);
    add('Tick-volume expansion',volumeConfirmed,20);
    add('ADX confirms momentum',adx5>=20,15);
    add('M15 does not oppose breakout',m15Side==='WAIT'||m15Side===side,15);
    add('MACD confirms direction',buy?mom.histogram>0:mom.histogram<0,15);
    add('Candle body versus ATR',Math.abs(last.close-last.open)>=atr5*.15,10);
  } else if(regime==='TREND') {
    side=m15Side;
    const buy=side==='BUY';
    add('M15 EMA trend',side!=='WAIT',20);
    add('M5 EMA trend alignment',trend===side,20);
    add('MACD histogram',buy?mom.histogram>0:mom.histogram<0,15);
    add('Supertrend',st===side,15);
    add('Ichimoku cloud',buy?last.close>ich.upper:last.close<ich.lower,10);
    add('RSI trend momentum',buy?rel>=50&&rel<78:rel<=50&&rel>22,10);
    add('Candle/level/volume confirmation',buy?
      (pattern.engulfBuy||pattern.pinBuy||last.close>prev.high||last.close>poc):
      (pattern.engulfSell||pattern.pinSell||last.close<prev.low||last.close<poc),10);
  } else if(regime==='RANGE') {
    const up=last.low<bb.lower&&last.close>bb.lower&&rel<42&&sto<40;
    const down=last.high>bb.upper&&last.close<bb.upper&&rel>58&&sto>60;
    side=up?'BUY':down?'SELL':'WAIT';
    const buy=side==='BUY';
    add('Bollinger rejection',side!=='WAIT',35);
    add('RSI and Stochastic extremes',buy?rel<42&&sto<40:rel>58&&sto>60,25);
    add('Volume-weighted mean-reversion target',volumeVwap!=null&&(buy?volumeVwap>last.close:volumeVwap<last.close),15);
    add('Candle rejection or engulfing',buy?pattern.pinBuy||pattern.engulfBuy:pattern.pinSell||pattern.engulfSell,15);
    add('No strong opposing higher timeframe',m15Side==='WAIT'||m15Side===side,10);
  }
  const score=checks.reduce((v,x)=>v+(x.pass?x.weight:0),0);
  const context={adx:adx5,macd:mom.histogram,supertrend:st,ichimoku:ich,
    bollinger:bb,rsi:rel,stochastic:sto,tickVwap:volumeVwap,
    turtle20Daily:turtle20,turtle55Daily:turtle55,
    pivots:daily.pivots,volumeProfilePocProxy:poc,
    fibRetracements:fib,fvgThreeBar:fvgSide,orderBlockProxy:zones,
    openingRangeProxy:openingRangeProxy(m5)};
  const partial={...empty,regime,checks,score,indicators:context,risk:'ASSESSED',
    reasons:checks.filter(x=>!x.pass).map(x=>x.name)};
  if(side==='WAIT' || score<75 || checks.filter(x=>x.pass).length<4)
    return {...partial,risk:'CAUTION',reasons:side==='WAIT'?['NO_REGIME_ENTRY_SETUP']:
      ['INSUFFICIENT_INDEPENDENT_CONFIRMATION']};
  const buy=side==='BUY';
  if(m15Side!=='WAIT' && m15Side!==side && regime!=='RANGE')
    return {...partial,risk:'CAUTION',reasons:['OPPOSING_M15_DIRECTION']};
  const entry=round(buy?snapshot.ask:snapshot.bid,spec);
  const swing=buy?ext(m5.slice(-8),'low'):ext(m5.slice(-8),'high');
  const distance=Math.max(atr5*(regime==='RANGE'?.9:1.1),
    buy?entry-swing+atr5*.12:swing-entry+atr5*.12,
    spec.stops_points*spec.point+spec.tick_size*2+spread);
  if(distance>atr5*3)return {...partial,risk:'CAUTION',reasons:['EXCESSIVE_ATR_STOP']};
  const sl=round(entry+(buy?-distance:distance),spec,buy?'down':'up'),
    riskDistance=Math.abs(entry-sl),sign=buy?1:-1;
  if(!(sl>0&&riskDistance>spec.tick_size))
    return {...partial,risk:'BLOCKED',reasons:['INVALID_SL_LEVEL']};
  const tp1=round(entry+sign*riskDistance,spec),
    tp2=round(entry+sign*riskDistance*(regime==='RANGE'?1.25:1.5),spec);
  const plan={strategy:GOLD_FUSION_STRATEGY,side,symbol:snapshot.symbol,
    bar_time:last.time,issued_at:Math.floor(now),expires_at:Math.floor(now+180),
    entry,sl,tp1,tp2,risk_distance:riskDistance,score,
    timeframe:'M5',regime,reason:'Gold '+regime+' multi-family votes (not predictive accuracy)',
    tracking:'VIRTUAL',tp1_hit:false,status:'TRACKING'};
  return {...partial,decision:side,plan,reasons:[plan.reason]};
}
