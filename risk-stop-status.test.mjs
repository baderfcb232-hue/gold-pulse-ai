import test from 'node:test';
import assert from 'node:assert/strict';
import {stopStatus,STOP_STATUS} from './risk-stop-status.mjs';
const at=900;
const p=()=>({ownerId:'owner-a',accountId:'account-a',symbol:'BTCUSD',paused:true});
const ack=()=>({ownerId:'owner-a',accountId:'account-a',symbol:'BTCUSD',state:'PAUSED',brokerConfirmed:true,confirmedAt:899});
test('stored preference alone never proves an MT5 stop',()=>{
 const result=stopStatus({preference:p(),ownerId:'owner-a',accountId:'account-a',symbol:'BTCUSD',now:at});
 assert.equal(result.status,STOP_STATUS.STOP_REQUESTED_UNVERIFIED);
 assert.equal(result.confirmed,false);
 assert.equal(result.mayOpenNewTrades,false);
 assert.equal(result.closePositions,false);
});
test('only fresh source-matched account-specific evidence can be marked confirmed',()=>{
 const values={preference:p(),ownerId:'owner-a',accountId:'account-a',symbol:'BTCUSD',now:at};
 assert.equal(stopStatus({...values,acknowledgement:ack()}).status,STOP_STATUS.STOP_CONFIRMED);
 for(const alter of [x=>x.ownerId='owner-b',x=>x.accountId='account-b',x=>x.symbol='XAUUSD',
  x=>x.state='RUNNING',x=>x.brokerConfirmed=false,x=>x.confirmedAt=800,x=>x.confirmedAt=901]){
  const a=ack();alter(a);
  assert.equal(stopStatus({...values,acknowledgement:a}).confirmed,false);
 }
 assert.equal(stopStatus({...values,ownerId:'owner-b',acknowledgement:ack()}).confirmed,false);
});
test('unpaused staged preference cannot enable execution or confirm stop',()=>{
 const x=p();x.paused=false;
 const result=stopStatus({preference:x,ownerId:'owner-a',accountId:'account-a',symbol:'BTCUSD',now:at,acknowledgement:ack()});
 assert.equal(result.status,STOP_STATUS.PREFERENCE_SAVED);
 assert.equal(result.executionEnabled,false);
 assert.equal(result.mayOpenNewTrades,false);
});
