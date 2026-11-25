// Pure shadow-only event scheduler. No network access, MT5, or trading actions.
export class HybridScheduler {
  constructor({dailyLimit=60,perSymbolLimit=35,minGapSec=60,newsCooldownSec=180,paced=false}={}) {
    this.config={dailyLimit,perSymbolLimit,minGapSec,newsCooldownSec,paced};
    this.slotsPerSymbol=paced?Math.min(perSymbolLimit,Math.floor(dailyLimit/2),288):null;
    if(paced&&(!Number.isSafeInteger(this.slotsPerSymbol)||this.slotsPerSymbol<1))throw Error('INVALID_PACED_BUDGET');
    this.diagnostics={};
    this.day=null;this.total=0;this.counts={};this.state=new Map();
  }
  consider({symbol,now,quote,bars,news=[],atrM5}={}) {
    const stop=(reason)=>{if(['XAUUSD','BTCUSD'].includes(symbol)&&Number.isSafeInteger(now)&&now>0)this.diagnostics[symbol]={reason,at:now};return {callAI:false,reason};};
    if(!['XAUUSD','BTCUSD'].includes(symbol))return stop('UNSUPPORTED_SYMBOL');
    if(!Number.isSafeInteger(now)||now<=0)return stop('INVALID_TIME');
    if(!quote||![quote.bid,quote.ask].every(Number.isFinite)||quote.bid<=0||
        quote.ask<quote.bid||!Number.isSafeInteger(quote.time)||
        quote.time>now||now-quote.time>8)return stop('INVALID_OR_STALE_QUOTE');
    for(const [tf,secs] of Object.entries({M5:300,M15:900,H1:3600,H4:14400})){
      const a=bars?.[tf];
      if(!Array.isArray(a)||a.length<2)return stop('MISSING_'+tf);
      if(a.some((b,i)=>!Number.isSafeInteger(b.time)||b.time<=0||
        b.time+secs>now||!['open','high','low','close'].every(k=>Number.isFinite(b[k])&&b[k]>0)||
        b.low>Math.min(b.open,b.close)||b.high<Math.max(b.open,b.close)||
        (i>0&&b.time<=a[i-1].time)))return stop('INVALID_'+tf);
      if(a.at(-1).time-a.at(-2).time!==secs||
          now-a.at(-1).time-secs>secs+90)return stop('STALE_'+tf);
    }
    const day=new Date(now*1000).toISOString().slice(0,10);
    if(day!==this.day){this.day=day;this.total=0;this.counts={};}
    const prior=this.state.get(symbol)||{};
    const last=bars.M5.at(-1),m5=last.time;
    const freshM5=prior.m5!==m5;
    const verified=news.filter(n=>n&&typeof n.id==='string'&&n.id.length<=128&&
      Number.isSafeInteger(n.publishedAt)&&n.publishedAt<=now&&now-n.publishedAt<=600&&
      n.highImpact===true&&n.verified===true&&(n.symbol===symbol||n.symbol==='ALL'));
    const event=verified.find(n=>!(prior.seen||[]).includes(n.id));
    const spike=Number.isFinite(atrM5)&&atrM5>0&&
      last.high-last.low>=1.8*atrM5;
    const spikeKey=spike?m5+':'+Math.floor((last.high-last.low)/atrM5*10):null;
    const newSpike=spike&&prior.spike!==spikeKey;
    const reason=event?'HIGH_IMPACT_NEWS':freshM5?'M5_CLOSED':newSpike?'VOLATILITY_SPIKE':null;
    if(!reason)return stop('NO_NEW_TRIGGER');
    // Equal non-transferable UTC slots; missed slots expire, never accumulate.
    // With 30 per market, each gets one opportunity every 48 minutes.
    const dayStart=Math.floor(now/86400)*86400;
    const slot=this.config.paced?Math.floor((now-dayStart)*this.slotsPerSymbol/86400):null;
    const slotStart=this.config.paced?dayStart+Math.ceil(slot*86400/this.slotsPerSymbol):null;
    if(this.config.paced&&prior.slotStart===slotStart)return stop('PACED_SLOT_USED');
    if(this.total>=this.config.dailyLimit||(this.counts[symbol]||0)>=this.config.perSymbolLimit)
      return stop('DAILY_BUDGET_EXHAUSTED');
    if(prior.lastCall!=null&&now-prior.lastCall<this.config.minGapSec)return stop('RATE_LIMITED');
    if(event&&prior.lastNewsCall!=null&&now-prior.lastNewsCall<this.config.newsCooldownSec&&
       !freshM5)return stop('NEWS_COOLDOWN');
    this.total++;this.counts[symbol]=(this.counts[symbol]||0)+1;
    this.state.set(symbol,{m5,slotStart,lastCall:now,lastNewsCall:event?now:prior.lastNewsCall,
      seen:[...(prior.seen||[]),...verified.map(e=>e.id)].slice(-100),
      spike:spikeKey||prior.spike});
    this.diagnostics[symbol]={reason,at:now};
    return {callAI:true,reason,symbol,slotStart,referenceOnly:true,tradingEnabled:false,
      closedBarTime:m5,dataAsOf:now,requestsToday:this.counts[symbol]};
  }
  report(){
    return {experimental:true,tradingEnabled:false,marketAdapter:'not_connected',
      newsAdapter:'not_connected',analysisMode:'shadow_only',
      scheduling:'event_driven',dailyLimit:this.config.dailyLimit,
      perSymbolLimit:this.config.perSymbolLimit,callsToday:this.total,utcDay:this.day,counts:{...this.counts},
      paced:this.config.paced,slotsPerSymbol:this.slotsPerSymbol,slotSeconds:this.config.paced?86400/this.slotsPerSymbol:null,
      lastBySymbol:{...this.diagnostics},durableReservationRequired:this.config.paced};
  }
}
