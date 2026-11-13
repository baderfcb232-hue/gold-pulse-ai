// Phase 12 — distinguish a staged user preference from a broker-verified stop.
// This module NEVER authorizes an order, MT5 control, or resumed execution.
export const STOP_STATUS=Object.freeze({
  NOT_CONFIGURED:'NOT_CONFIGURED',
  PREFERENCE_SAVED:'PREFERENCE_SAVED',
  STOP_REQUESTED_UNVERIFIED:'STOP_REQUESTED_UNVERIFIED',
  STOP_CONFIRMED:'STOP_CONFIRMED',
  STOP_NOT_CONFIRMED:'STOP_NOT_CONFIRMED'
});
export function stopStatus({preference, acknowledgement, ownerId, accountId, symbol, now}={}){
 const output=(status,confirmed)=>({status,confirmed,executionEnabled:false,mayOpenNewTrades:false,closePositions:false});
 if(!preference)return output(STOP_STATUS.NOT_CONFIGURED,false);
 if(!ownerId||!accountId||!['XAUUSD','BTCUSD'].includes(symbol)||
    preference.ownerId!==ownerId||preference.accountId!==accountId||preference.symbol!==symbol)
    return output(STOP_STATUS.STOP_NOT_CONFIRMED,false);
 if(preference.paused!==true)return output(STOP_STATUS.PREFERENCE_SAVED,false);
 // A staged preference is *not* a command. Accept an acknowledgment as evidence
 // only when a future authenticated account-specific broker path provides one.
 if(!acknowledgement)return output(STOP_STATUS.STOP_REQUESTED_UNVERIFIED,false);
 const fresh=typeof now==='number'&&Number.isFinite(now)&&
  typeof acknowledgement.confirmedAt==='number'&&Number.isFinite(acknowledgement.confirmedAt)&&
  acknowledgement.confirmedAt<=now&&now-acknowledgement.confirmedAt<=10;
 const matches=acknowledgement.ownerId===ownerId&&acknowledgement.accountId===accountId&&
  acknowledgement.symbol===symbol&&acknowledgement.state==='PAUSED'&&
  acknowledgement.brokerConfirmed===true;
 if(!fresh||!matches)return output(STOP_STATUS.STOP_NOT_CONFIRMED,false);
 return output(STOP_STATUS.STOP_CONFIRMED,true);
}
