// Shadow review only; never grants, denies or changes execution authorization.
export function reviewDecision(ctx,plan){
 const flags=[];
 const valid=plan&&['BUY_WATCH','SELL_WATCH','WAIT'].includes(plan.stance)&&Number.isFinite(plan.confidence)&&plan.confidence>=0&&plan.confidence<=1;
 if(!valid)return {version:'CRITIC_V1',status:'UNAVAILABLE',flags:['INVALID_PLAN'],executionPermission:false};
 const direction=plan.stance==='BUY_WATCH'?'UP':plan.stance==='SELL_WATCH'?'DOWN':null;
 const frames=ctx?.technicalEvidence;
 const a=ctx?.fusionEvidence?.adaptive;
 const m=a?.frames?.M5;
 if(!ctx?.candlesVerified||!ctx?.multiTimeframeVerified||!frames||['M5','M15','H1','H4'].some(tf=>frames[tf]?.status!=='INDICATORS_AVAILABLE'))flags.push('INCOMPLETE_TECHNICAL_EVIDENCE');
 if(!a||a.regime==='UNVERIFIED')flags.push('REGIME_UNVERIFIED');
 if(a?.regime==='CONFLICT')flags.push('REGIME_CONFLICT');
 if(a?.regime==='VOLATILITY_EXPANSION')flags.push('VOLATILITY_EXPANSION');
 if(direction){
  const opposite=direction==='UP'?'DOWN':'UP';
  if(['M15','H1','H4'].some(tf=>frames?.[tf]?.emaDirection===opposite))flags.push('HIGHER_FRAME_COUNTERTREND');
  if(a?.regime==='TREND_'+opposite)flags.push('OPPOSITE_MARKET_REGIME');
  if(direction==='UP'?m?.rejectedHigh:m?.rejectedLow)flags.push('PRICE_REJECTION_AGAINST_STANCE');
  if(!Array.isArray(plan.evidence)||!plan.evidence.length)flags.push('MISSING_MODEL_EVIDENCE');
  if(typeof plan.counterThesis!=='string'||!plan.counterThesis.trim())flags.push('MISSING_COUNTER_THESIS');
  if(typeof plan.invalidation!=='string'||!plan.invalidation.trim())flags.push('MISSING_INVALIDATION');
  const spread=ctx?.ask-ctx?.bid,atr=frames?.M5?.atr14;
  if(!Number.isFinite(spread)||spread<=0||!Number.isFinite(atr)||atr<=0||!Number.isFinite(ctx?.spreadLimit)||spread>ctx.spreadLimit||spread>atr*.25)flags.push('SPREAD_OR_ATR_UNFAVORABLE');
 }
 if(ctx?.news?.classification!=='REALTIME')flags.push('LIVE_NEWS_NOT_AVAILABLE');
 return {version:'CRITIC_V1',status:'REVIEWED',flags,stance:plan.stance,confidenceCalibrated:false,executionPermission:false};
}
