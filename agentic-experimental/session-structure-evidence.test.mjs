import test from 'node:test';
import assert from 'node:assert/strict';
import {frameExtras,nySession,sessionStructureEvidence} from './session-structure-evidence.mjs';
import {buildFusionEvidence} from './fusion-evidence.mjs';
const ts=s=>Date.parse(s)/1000;
const make=(start,n,d=300)=>Array.from({length:n},(_,i)=>({time:start+i*d,open:100+i,close:100+i+.5,high:101+i,low:99+i,tickVolume:10}));
test('EMA12, efficiency and raw Chandelier use only completed bars',()=>{
 const a=make(ts('2026-11-27T14:00:00Z'),30),t=a.at(-1).time+300;
 const x=frameExtras(a,300,t);assert.ok(x.ema12<a.at(-1).close);assert.equal(x.kaufmanEfficiency20,1);
 assert.ok(x.chandelier.longReference<a.at(-1).high);assert.equal(frameExtras(a,300,t-1),null);
 assert.equal(frameExtras(a,300,t+901),null);
});
test('NY 09:30 anchor follows DST; range excludes its own evaluation bars',()=>{
 for(const date of ['2026-07-15T13:30:00Z','2026-11-25T14:30:00Z']){
  const anchor=ts(date),a=make(anchor-20*300,24),t=a.at(-1).time+300;
  const x=nySession(a,t);assert.equal(x.status,'AVAILABLE');assert.equal(x.anchor,anchor);
  assert.equal(x.openingRange15.high,a[22].high);assert.equal(x.openingRange15.closeBreak,'ABOVE');
  assert.equal(x.anchoredVwap.volumeSource,'BROKER_TICK_ACTIVITY_PROXY');assert.equal(x.relativeVolumeAtTime,null);
  assert.equal(nySession(a.slice(0,-1),t-300).openingRange15.closeBreak,'NOT_YET_EVALUATED');
  assert.equal(nySession(a.filter(b=>b.time!==anchor+300),t).status,'INCOMPLETE_SESSION_HISTORY');
 }
});
test('missing volumes and daily data are never fabricated',()=>{
 const a=make(ts('2026-11-25T14:30:00Z'),10).map(({tickVolume,...b})=>b),t=a.at(-1).time+300;
 const r=sessionStructureEvidence({timestamp:t,candlesM5:a});assert.equal(r.nySession.anchoredVwap,null);
 assert.equal(r.dailyVolatilityBreakout,null);assert.equal(r.executionPermission,false);
 const f=buildFusionEvidence({timestamp:t,candlesM5:a});assert.equal(f.sessionStructure.version,'SESSION_STRUCTURE_V1');
});
test('relative volume at time requires five prior comparable observations with consistent volume',()=>{
 const anchor=ts('2026-11-25T14:30:00Z');
 const a=[7,6,5,2,1].map(n=>({...make(anchor-n*86400,1)[0],tickVolume:10}));
 a.push({...make(anchor,1)[0],tickVolume:20});
 assert.equal(nySession(a,anchor+300).relativeVolumeAtTime.ratio,2);
});
test('pivot confirmation cannot use the evaluated candle',()=>{
 const a=make(ts('2026-11-25T14:00:00Z'),8).map((b,i)=>({...b,open:100,close:100,high:i===5?110:102,low:99}));
 const t=a.at(-1).time+300;
 assert.equal(frameExtras(a,300,t).structure.priorConfirmedSwingHigh,null);
 a.push({...a.at(-1),time:t,high:112,close:111});assert.equal(frameExtras(a,300,t+300).structure.priorConfirmedSwingHigh,110);
 assert.equal(frameExtras(a,300,t+300).structure.break,'UP');
});
