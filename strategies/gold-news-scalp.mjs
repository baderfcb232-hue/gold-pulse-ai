// GOLD ONLY: deterministic scheduled-event gating. News headlines cannot
// authorize execution; only the timestamped MT5 USD calendar can.
export const GOLD_NEWS_SCALP_VERSION='GOLD-NEWS-SCALP-SHADOW-1';
const highPattern=/\b(?:FOMC|federal funds|fed rate|interest rate decision|non.?farm|NFP|employment situation|consumer price index|\bCPI\b|personal consumption expenditures|\bPCE\b)\b/i;
const mediumPattern=/\b(?:jobless|unemployment claims|retail sales|gross domestic product|\bGDP\b|\bPMI\b|purchasing managers|\bJOLTS\b|\bADP\b)\b/i;

export function classifyGoldCalendarEvent(event) {
  if (!event || event.currency !== 'USD') return 'OTHER';
  const name=String(event.name||'');
  if (event.importance===3 && highPattern.test(name)) return 'HIGH_TARGET';
  if (event.importance===3) return 'HIGH_OTHER';
  if (event.importance===2 && mediumPattern.test(name)) return 'MEDIUM_TARGET';
  return 'OTHER';
}

// All windows use seconds from source event time (no local clock assumption).
// Critical releases have a 30m pre-block; first 2m post-event is never traded;
// 2-15m is experimental SHADOW only, and remaining 15m is also blocked.
// Other high-impact releases stay blocked for 30m post-event.
export function goldNewsWindow(calendar,now,{calendarTtl=900}={}) {
  const stale=calendar?.status!=='ok' || !Number.isFinite(calendar?.updated_at) ||
    calendar.updated_at<=0 || calendar.updated_at>now+5 ||
    now-calendar.updated_at>calendarTtl || !Array.isArray(calendar.events);
  if(stale) return {blocked:true,code:'CALENDAR_UNAVAILABLE',event:null,shadowEligible:false};
  const windows=[];
  for (const e of calendar.events) {
    if(e?.currency!=='USD' || !Number.isFinite(e.time) || e.time>now+1800 ||
      (e.importance!==2 && e.importance!==3))continue;
    const delta=now-e.time,kind=classifyGoldCalendarEvent(e);
    if(e.importance===3 && delta>=-1800 && delta<=1800) {
      const code=delta<0?'HIGH_PRE_RELEASE':delta<120?'HIGH_INITIAL_SHOCK':
        delta<=900 && kind==='HIGH_TARGET'?'HIGH_SHADOW_WINDOW':'HIGH_POST_RELEASE';
      windows.push({blocked:true,code,event:e,shadowEligible:code==='HIGH_SHADOW_WINDOW',kind,delta});
    } else if(kind==='MEDIUM_TARGET' && delta>=-600 && delta<=180) {
      windows.push({blocked:true,code:'MEDIUM_EVENT_BUFFER',event:e,shadowEligible:false,kind,delta});
    }
  }
  if(!windows.length)return {blocked:false,code:'CLEAR',event:null,shadowEligible:false};
  // Overlapping releases must never elevate a candidate to shadow-tradable.
  const priority={HIGH_INITIAL_SHOCK:0,HIGH_PRE_RELEASE:1,HIGH_POST_RELEASE:2,
    MEDIUM_EVENT_BUFFER:3,HIGH_SHADOW_WINDOW:4};
  windows.sort((a,b)=>priority[a.code]-priority[b.code] || Math.abs(a.delta)-Math.abs(b.delta));
  const selected=windows[0];
  const simultaneous=windows.filter(x=>x.event?.id!==selected.event?.id);
  return {...selected,shadowEligible:selected.shadowEligible && simultaneous.length===0};
}

const mean=xs=>xs.reduce((a,b)=>a+b,0)/Math.max(1,xs.length);
export function goldNewsScalpShadow(snapshot,now,window) {
  const wait=(code,details={})=>({version:GOLD_NEWS_SCALP_VERSION,
    mode:'RESEARCH_ONLY_NO_EXECUTION',code,plan:null,...details});
  if(!window?.shadowEligible || window.code!=='HIGH_SHADOW_WINDOW')
    return wait('NEWS_SHADOW_NOT_ALLOWED');
  const m1=snapshot?.candles?.M1;
  if(!Array.isArray(m1)||m1.length<35)return wait('MISSING_M1_CANDLES');
  const last=m1.at(-1),seconds=60;
  if(!last || last.time+seconds>now+2 || now-(last.time+seconds)>120)
    return wait('STALE_M1_CANDLES');
  const eventTime=window.event.time, post=m1.filter(x=>x.time>=eventTime && x.time+60<=now);
  if(post.length<3)return wait('AWAITING_CLOSED_POST_NEWS_M1');
  const setup=post.slice(0,2),candidate=post.at(-1);
  if(candidate.time<=setup.at(-1).time)return wait('AWAITING_M1_BREAKOUT_BAR');
  const high=Math.max(...setup.map(c=>c.high)),low=Math.min(...setup.map(c=>c.low));
  const bull=candidate.close>high && candidate.close>candidate.open;
  const bear=candidate.close<low && candidate.close<candidate.open;
  const side=bull?'BUY':bear?'SELL':null;
  if(!side)return wait('NO_CONFIRMED_M1_BREAKOUT');
  const prev=m1.slice(-21,-1);
  const volumeReference=mean(prev.map(x=>x.tick_volume).filter(Number.isFinite));
  if(volumeReference<=0 || candidate.tick_volume<volumeReference*1.3)
    return wait('NO_TICK_VOLUME_CONFIRMATION');
  const entry=side==='BUY'?snapshot.ask:snapshot.bid;
  const spread=snapshot.ask-snapshot.bid;
  const m5=snapshot.candles?.M5;
  if(!Array.isArray(m5)||m5.length<20 || spread<=0)
    return wait('INVALID_M5_OR_SPREAD');
  const ranges=m5.slice(-14).map(x=>x.high-x.low),atrProxy=mean(ranges);
  if(!(atrProxy>0) || spread>atrProxy*.12 || spread/snapshot.spec.point>80)
    return wait('NEWS_SPREAD_OR_VOLATILITY_UNSAFE');
  if(Math.abs(entry-candidate.close)>atrProxy*.45)
    return wait('NEWS_PRICE_CHASE');
  const distance=Math.max(atrProxy*.75,spread*5,snapshot.spec.stops_points*snapshot.spec.point+
    snapshot.spec.tick_size*2);
  const sign=side==='BUY'?1:-1,round=(n,dir='nearest')=>{
    const op=dir==='down'?Math.floor:dir==='up'?Math.ceil:Math.round;
    return Number((op(n/snapshot.spec.tick_size)*snapshot.spec.tick_size).toFixed(snapshot.spec.digits));
  };
  const price=round(entry),sl=round(price-sign*distance,sign>0?'down':'up'),
    risk=Math.abs(price-sl);
  if(!(sl>0 && risk>snapshot.spec.tick_size))return wait('INVALID_NEWS_STOPS');
  return wait('POST_NEWS_BREAKOUT_SHADOW', {candidate:{
    strategy:GOLD_NEWS_SCALP_VERSION,side,bar_time:candidate.time,entry:price,sl,
    tp1:round(price+sign*risk),tp2:round(price+sign*risk*1.25),
    risk_distance:risk,news_event_id:window.event.id,news_event_name:window.event.name,
    max_holding_seconds:900,risk_percent_ceiling:.15,
    reason:'MT5 M1 post-news confirmed breakout; SHADOW ONLY'}});
}
