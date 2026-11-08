import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeSubscriberDemoCommand as check} from './subscriber-demo-policy.mjs';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', now=1794160000000;
const base=()=>({nowMs:now,
 account:{id,ownerId:'owner-A',enabled:true,deleted:false,environment:'demo',broker:'JustMarkets',login:'12345678',server:'JustMarkets-Demo2'},
 grant:{accountId:id,ownerId:'owner-A',scope:'demo-execute',authorized:true,revoked:false,expiresAtMs:now+60000},
 worker:{accountId:id,authorized:true,monitoringOnly:false,environment:'demo',connected:true,login:'12345678',server:'JustMarkets-Demo2',broker:'JustMarkets'},
 risk:{paused:false,emergencyStop:false,allowNewPositions:true,maxRiskPct:.4,requestedRiskPct:.4,maxOpenPositions:2,openPositions:0,symbol:'BTCUSD'},
 signal:{id:'sig-123',nonce:'1234567890abcdef',accountId:id,symbol:'BTCUSD',side:'BUY',entry:100,sl:99,tp:103,issuedAtMs:now-1000,expiresAtMs:now+10000}
});
const mutate=(section,field,val)=>{const x=base();x[section][field]=val;return x};
test('only explicit authorized Demo passes; defaults deny',()=>{
 assert.equal(check().allowed,false);
 assert.deepEqual(check(base()),{allowed:true,reason:'DEMO_POLICY_OK',dedupeKey:id+':sig-123'});
 for(const [s,k,v] of [
 ['account','environment','real'],['account','enabled',false],['account','deleted',true],
 ['grant','authorized',false],['grant','revoked',true],['grant','scope','monitor'],
 ['grant','ownerId','other'],['grant','accountId',other],['worker','accountId',other],
 ['worker','monitoringOnly',true],['worker','connected',false],['worker','environment','real'],
 ['worker','login','99999999'],['risk','paused',true],['risk','emergencyStop',true],
 ['risk','allowNewPositions',false],['risk','requestedRiskPct',2],['risk','openPositions',2],
 ['signal','accountId',other],['signal','symbol','XAUUSD'],['signal','side','HOLD'],
 ['signal','nonce','weak'],['signal','expiresAtMs',now-1],['signal','sl',101]
 ])assert.equal(check(mutate(s,k,v)).allowed,false,s+'.'+k);
});
test('reject expired grant, stale/future signal, invalid clock and id',()=>{
 assert.equal(check({...base(),nowMs:0}).allowed,false);
 assert.equal(check(mutate('grant','expiresAtMs',now)).allowed,false);
 assert.equal(check(mutate('signal','issuedAtMs',now+2000)).allowed,false);
 assert.equal(check(mutate('signal','expiresAtMs',now+31000)).allowed,false);
 assert.equal(check(mutate('signal','id','bad id')).allowed,false);
});
test('SELL must have protective SL and TP',()=>{
 const x=base();x.signal={...x.signal,side:'SELL',sl:101,tp:97};
 assert.equal(check(x).allowed,true);x.signal.tp=103;assert.equal(check(x).allowed,false);
});
