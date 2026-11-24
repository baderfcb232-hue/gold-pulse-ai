// Advisory only. Historical V2 associations are not calibrated probabilities.
export function selectiveEvidence(symbol,frames,adaptive){
 const m=frames?.M5;
 const valid=m?.status==='RESEARCH_EVIDENCE_ONLY'&&adaptive?.frames?.M5?.status==='AVAILABLE';
 const hypothesis=symbol==='XAUUSD'?'TREND_PULLBACK':symbol==='BTCUSD'?'TREND_ALIGNED_BOLLINGER_REENTRY':null;
 return {version:'SELECTIVE_V2_V4_V5_1',advisoryOnly:true,executionPermission:false,
  historicalEvidence:{hypothesis,independentlyValidated:false,individualFeatureBenefitProven:false,
   holdingPeriodMinutes:symbol==='XAUUSD'?720:symbol==='BTCUSD'?360:null,
   historicalAtrStopMultiple:2.5,historicalCooldownMinutes:symbol==='XAUUSD'?60:symbol==='BTCUSD'?180:null,
   note:'Historical technical proxy only; not instructions, not live risk settings or model results.'},
  currentContext:valid?{emaDirection:m.trend.emaDirection,rsi:m.trend.rsi14,macdHistogram:m.macd?.histogram??null,
   vwap:m.vwap??null,bollinger:m.bollinger20,regime:adaptive.regime,
   volatilityRatio:adaptive.frames.M5.volatilityRatio,priorHigh:adaptive.frames.M5.priorHigh,priorLow:adaptive.frames.M5.priorLow,
   rejectedHigh:adaptive.frames.M5.rejectedHigh,rejectedLow:adaptive.frames.M5.rejectedLow,
   breakout:adaptive.frames.M5.breakout,retest:adaptive.frames.M5.retest}:null,
  excludeFromExecution:['V4_AUTOMATIC_REGIME_ENTRY','V4_ADAPTIVE_STOP','V4_PARTIAL_TRAILING'],
  caution:'Assess evidence conflicts; never convert historical hypothesis or breakout candidate into automatic entry.'};
}
