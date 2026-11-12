// Pure isolated risk calculation for a PAPER/DEMO shadow plan. No execution commands.
const finite=n=>typeof n==='number'&&Number.isFinite(n);
export function reviewShadowRisk({symbol,side,accountType,balance,riskPercent,entry,stop,target,
 spread,spreadLimit,quoteAgeSeconds,positionsForSymbol=0,dailyEntries=null,modelPlan=null}={}){
 const reasons=[];
 if(!['XAUUSD','BTCUSD'].includes(symbol))reasons.push('UNSUPPORTED_SYMBOL');
 if(!['BUY','SELL'].includes(side))reasons.push('INVALID_SIDE');
 if(!['DEMO','PAPER'].includes(accountType))reasons.push('DEMO_ONLY');
 if(!finite(balance)||balance<=0)reasons.push('INVALID_BALANCE');
 if(!finite(riskPercent)||riskPercent<=0||riskPercent>0.5)reasons.push('RISK_CAP_EXCEEDED');
 if(![entry,stop,target].every(finite)||entry<=0||stop<=0||target<=0)
  reasons.push('INVALID_LEVELS');
 else if(side==='BUY'&&!(stop<entry&&entry<target)||
    side==='SELL'&&!(target<entry&&entry<stop))reasons.push('INVALID_STOP_TARGET_SIDE');
 if(!finite(spread)||!finite(spreadLimit)||spreadLimit<=0||spread<0||spread>spreadLimit)
  reasons.push('SPREAD_NOT_ACCEPTABLE');
 if(!finite(quoteAgeSeconds)||quoteAgeSeconds<0||quoteAgeSeconds>2)
  reasons.push('STALE_BROKER_QUOTE');
 const maxPositions=symbol==='BTCUSD'?2:1;
 if(!Number.isSafeInteger(positionsForSymbol)||positionsForSymbol<0||positionsForSymbol>=maxPositions)
  reasons.push('POSITION_LIMIT');
 if(symbol==='BTCUSD'){
  if(riskPercent>0.4)reasons.push('BTC_RISK_CAP_EXCEEDED');
  if(!Number.isSafeInteger(dailyEntries)||dailyEntries<0||dailyEntries>=6)
   reasons.push('BTC_DAILY_ENTRY_LIMIT_OR_UNVERIFIED_COUNT');
 }
 if(!modelPlan||!['BUY_WATCH','SELL_WATCH','WAIT'].includes(modelPlan.stance)||
    modelPlan.stance!==(side==='BUY'?'BUY_WATCH':'SELL_WATCH'))
  reasons.push('AI_HYPOTHESIS_NOT_ALIGNED');
 const riskAmount=finite(balance)&&finite(riskPercent)?balance*riskPercent/100:null;
 const rewardRisk=[entry,stop,target].every(finite)&&entry!==stop?
  Math.abs(target-entry)/Math.abs(entry-stop):null;
 if(!finite(rewardRisk)||rewardRisk<(symbol==='BTCUSD'?3:1.5))reasons.push('REWARD_RISK_TOO_LOW');
 // Position sizing needs actual broker tick_size/tick_value and contract details.
 // A percentage risk alone cannot establish a valid MT5 lot size.
 return {status:reasons.length?'BLOCKED':'SHADOW_RISK_ACCEPTABLE',
  reasons,riskAmount,rewardRisk,lotSize:null,
  brokerContractVerified:false,positionSizingVerified:false,
  executionAllowed:false,order:null,tradingEnabled:false};
}
