import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFredCsv,fetchFredHistorical,createFredHistoricalMonitor} from './fred-historical-fallback.mjs';
const now=1800000000;
const data=id=>['DATE,'+id,'2026-08-01,100','2026-09-01,102','2026-10-01,103'].join('\n');
test('FRED CSV explicitly marked historic and non executable',()=>{
 const d=parseFredCsv(data('CPIAUCNS'),'CPIAUCNS',now);
 assert.equal(d.source,'FRED_BLS_HISTORICAL_REFERENCE');
 assert.equal(d.seriesId,'CUUR0000SA0');
 assert.equal(d.period,'2026-10');
 assert.equal(d.eligibleForTrading,false);
 assert.equal(d.actualReleaseTimeVerified,false);
});
test('FRED CSV header mismatches and forward data rejected',()=>{
 assert.throws(()=>parseFredCsv('DATE,PAYEMS\n2026-09-01,1','CPIAUCNS',now),/FRED_INVALID_HEADER/);
 assert.throws(()=>parseFredCsv('DATE,CPIAUCNS\n2028-01-01,1\n2028-02-01,2','CPIAUCNS',now),/FRED_FUTURE_OBSERVATION/);
});
test('all three FRED datasets requested from pinned official graph host',async()=>{
 const calls=[];
 const rows=await fetchFredHistorical({now,fetcher:async url=>{
  calls.push(url);const id=new URL(url).searchParams.get('id');
  return {ok:true,headers:{get:()=>''},text:async()=>data(id)};
 }});
 assert.equal(rows.length,3);
 assert.equal(rows[2].fredSeriesId,'PAYEMS');
 assert.deepEqual(calls,[
  'https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCNS',
  'https://fred.stlouisfed.org/graph/fredgraph.csv?id=UNRATE',
  'https://fred.stlouisfed.org/graph/fredgraph.csv?id=PAYEMS'
 ]);
});
test('FRED fallback failure remains visible, not a BLS success',async()=>{
 const monitor=createFredHistoricalMonitor({clock:()=>now,load:async()=>{throw Error('FRED_HTTP_403')}});
 assert.equal((await monitor.poll()).status,'ERROR');
 assert.equal(monitor.report().lastError,'FRED_HTTP_403');
 assert.equal(monitor.report().autoTradingEnabled,false);
});
