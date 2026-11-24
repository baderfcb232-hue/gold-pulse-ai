// Research only. No MT5 calls, no position modifications, no live execution.
// Input prices must be executable-side quotes, not midpoint or future bars.
const positive=x=>Number.isFinite(x)&&x>0;
const deny=reason=>({action:'WAIT',reason,executionPermission:false});
export function adaptiveStopPlan({side,entry,atr,spread,structure,regime}={}){
 if(!['BUY','SELL'].includes(side)||![entry,atr,spread].every(positive)||spread>atr*.25)return deny('INVALID_OR_WIDE_SPREAD');
 if(!['TREND_UP','TREND_DOWN','RANGE_OR_MIXED'].includes(regime))return deny('REGIME_UNSUITABLE');
 if(regime==='TREND_UP'&&side!=='BUY'||regime==='TREND_DOWN'&&side!=='SELL')return deny('TREND_CONFLICT');
 const sign=side==='BUY'?1:-1;
 if(!positive(structure)||sign*(entry-structure)<=0)return deny('STRUCTURE_UNVERIFIED');
 const distance=Math.max(1.5*atr,4*spread,sign*(entry-structure)+.25*atr);
 if(distance>3*atr)return deny('STOP_TOO_DISTANT');
 const stop=entry-sign*distance,target=entry+sign*3*distance;
 if(!positive(stop)||!positive(target))return deny('INVALID_LEVELS');
 return {action:'RESEARCH_PLAN',side,entry,stop,target,initialRiskDistance:distance,riskPct:.4,rewardRisk:3,executionPermission:false};
}
// State is immutable until caller confirms actual fills. Never infer a partial fill.
export function smartExit({side,entry,initialStop,currentStop,target,quote,atr,partialConfirmed=false,volume,minVolume,volumeStep,breakEvenBuffer,brokerMinDistance}={}){
 if(!['BUY','SELL'].includes(side)||![entry,initialStop,currentStop,target,quote,atr,volume,minVolume,volumeStep].every(positive)||![breakEvenBuffer,brokerMinDistance].every(x=>Number.isFinite(x)&&x>=0))return deny('INVALID_POSITION_OR_QUOTE');
 const sign=side==='BUY'?1:-1,risk=sign*(entry-initialStop),reward=sign*(target-entry),progress=sign*(quote-entry);
 if(risk<=0||Math.abs(reward/risk-3)>.01||sign*(currentStop-initialStop)<0||sign*(target-currentStop)<=0)return deny('INVALID_OR_WIDENED_INITIAL_RISK');
 if(progress>=reward||sign*(quote-currentStop)<=0)return deny('BROKER_PROTECTION_REACHED');
 if(progress<reward/2)return deny('BELOW_HALF_TARGET');
 const safe=entry+sign*breakEvenBuffer;
 const trail=quote-sign*1.5*atr;
 const candidate=sign===1?Math.max(currentStop,safe,partialConfirmed?trail:initialStop):Math.min(currentStop,safe,partialConfirmed?trail:initialStop);
 if(sign*(quote-candidate)<=brokerMinDistance||sign*(target-candidate)<=0)return deny('BROKER_DISTANCE_GUARD');
 const improves=sign*(candidate-currentStop)>0;
 if(!partialConfirmed){
  const units=Math.floor((volume/2)/volumeStep+1e-9),close=units*volumeStep;
  if(close+1e-9<minVolume||volume-close+1e-9<minVolume)return deny('PARTIAL_VOLUME_UNSUPPORTED');
  return {action:'RESEARCH_PARTIAL_THEN_PROTECT',closeVolume:close,stopAfterConfirmedFill:improves?candidate:currentStop,executionPermission:false};
 }
 return improves?{action:'RESEARCH_TIGHTEN_STOP',stop:candidate,executionPermission:false}:deny('NO_TIGHTER_STOP');
}
