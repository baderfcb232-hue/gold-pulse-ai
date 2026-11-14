// Historical PAPER validation is intentionally NOT the live MT5 Demo gate.
// Broker OHLC provenance is user-declared, the bid/ask are modeled and all
// judgments remain offline research only. Never accept live feeds or orders here.
const validNumber=n=>typeof n==='number'&&Number.isFinite(n);
const frames={M5:300,M15:900,H1:3600,H4:14400};
export function validateHistoricalResearchContext(ctx,now){
 const reasons=[];
 if(!ctx||typeof ctx!=='object'||Array.isArray(ctx))
   return {status:'BLOCKED',reasons:['NO_HISTORICAL_CONTEXT'],tradeAllowed:false,order:null};
 if(!['XAUUSD','BTCUSD'].includes(ctx.symbol))reasons.push('UNKNOWN_SYMBOL');
 if(ctx.feedType!=='MT5_HISTORICAL_PAPER_REPLAY'||
    ctx.priceKind!=='MODELED_FROM_CLOSED_M5'||
    ctx.provenanceStatus!=='USER_DECLARED_UNVERIFIED')
   reasons.push('HISTORICAL_MODE_REQUIRED');
 if(!Number.isSafeInteger(now)||now<=0||ctx.observedAt!==now)
   reasons.push('HISTORICAL_CLOCK_MISMATCH');
 if(!validNumber(ctx.bid)||!validNumber(ctx.ask)||ctx.bid<=0||ctx.ask<=ctx.bid)
   reasons.push('INVALID_MODELED_BID_ASK');
 if(!validNumber(ctx.spreadLimit)||ctx.spreadLimit<=0||
    (validNumber(ctx.ask)&&validNumber(ctx.bid)&&ctx.ask-ctx.bid>ctx.spreadLimit))
   reasons.push('HISTORICAL_SPREAD_TOO_WIDE');
 if(ctx.accountType!=='PAPER'||ctx.news?.classification!=='NONE')
   reasons.push('PAPER_NO_NEWS_ONLY');
 if(ctx.candlesVerified!==true||ctx.multiTimeframeVerified!==true)
   reasons.push('UNVERIFIED_HISTORICAL_CONTEXT');
 for(const [tf,seconds] of Object.entries(frames)){
   const bars=ctx['candles'+tf],features=ctx.technicalEvidence?.[tf];
   if(!Array.isArray(bars)||bars.length<24||bars.length>60||
      bars.some((bar,i)=>!bar||!Number.isSafeInteger(bar.time)||
       bar.time+seconds>now||
       !['open','high','low','close'].every(k=>validNumber(bar[k])&&bar[k]>0)||
       bar.high<Math.max(bar.open,bar.close)||
       bar.low>Math.min(bar.open,bar.close)||
       (i>0&&bar.time<=bars[i-1].time))||
      features?.ema200Verified!==true)
     reasons.push('INVALID_AS_OF_'+tf);
 }
 return {status:reasons.length?'BLOCKED':'RESEARCH_CONTEXT_READY',
   reasons,tradeAllowed:false,order:null};
}
