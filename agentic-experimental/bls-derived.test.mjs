import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBlsResponse,shiftMonth} from './bls-official-indicators.mjs';
const now=1800000000;
function source(id,data){return {status:'REQUEST_SUCCEEDED',Results:{series:[{seriesID:id,data}]}};}
function row(y,m,value){return {year:String(y),period:'M'+String(m).padStart(2,'0'),value:String(value)};}
test('monthly employment change is calculated from consecutive months, persons not thousands',()=>{
 const id='CES0000000001';
 const result=parseBlsResponse(source(id,[row(2026,11,160250),row(2026,10,160110)]),id,now);
 assert.equal(result.nfpMonthlyChangePersons,140000);
 assert.equal(result.previousPeriod,'2026-10');
 assert.equal(result.forecast,null);
 assert.equal(result.eligibleForTrading,false);
});
test('no adjacent month means no fabricated payroll change',()=>{
 const id='CES0000000001';
 const result=parseBlsResponse(source(id,[row(2026,11,160250),row(2026,9,160000)]),id,now);
 assert.equal(result.nfpMonthlyChangePersons,null);
 assert.equal(result.derivedDataPresent,false);
});
test('CPI year-over-year only with same month twelve months earlier',()=>{
 const id='CUUR0000SA0';
 const result=parseBlsResponse(source(id,[row(2026,11,330),row(2026,10,329),row(2025,11,320)]),id,now);
 assert.ok(Math.abs(result.cpiYearOverYearPercent-3.125)<1e-8);
 assert.equal(result.yearAgoValue,320);
 assert.equal(result.forecast,null);
});
test('CPI year-over-year missing annual baseline stays null',()=>{
 const id='CUUR0000SA0';
 const result=parseBlsResponse(source(id,[row(2026,11,330),row(2026,10,329)]),id,now);
 assert.equal(result.cpiYearOverYearPercent,null);
 assert.equal(result.derivedDataPresent,false);
});
test('period arithmetic crosses year boundaries',()=>{
 assert.equal(shiftMonth('2026-01',-1),'2025-12');
 assert.equal(shiftMonth('2026-11',-12),'2025-11');
 assert.throws(()=>shiftMonth('invalid',-1),/BLS_INVALID_PERIOD/);
});
