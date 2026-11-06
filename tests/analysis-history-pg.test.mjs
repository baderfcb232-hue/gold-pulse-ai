import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createPgAnalysisArchive,analysisArchiveKey} from '../analysis-history-pg.mjs';
import {createAnalysisHistory} from '../analysis-history.mjs';
const NOW=1793980800;
const fixture={
 symbol:'XAUUSD',recorded_at:NOW,quote_at:NOW,status:'SCANNING',
 decision:'WAIT',score:70,source_type:'MT5',
 reason:'EMA alignment pending',strategy:'FUSION',frames:{M15:'BUY',H1:'NEUTRAL'},
 indicator_checks:[],readiness_checks:[],entry_checks:[],kind:'ANALYSIS_OBSERVATION'
};
test('PostgreSQL archive stores only sanitized observations and validates filters',async()=>{
 const calls=[];
 const pool={async query(sql,args=[]){
  calls.push({sql,args});
  if(sql.startsWith('SELECT MIN'))return {rows:[{first:null}]};
  return {rows:[]};
 }};
 const archive=await createPgAnalysisArchive({pool});
 assert.ok(archive);
 archive.enqueue(fixture);
 await archive.flush();
 assert.equal(archive.status().state,'READY');
 const insert=calls.find(x=>x.sql.startsWith('INSERT INTO nabd_analysis_observations('));
 assert.ok(insert);
 assert.equal(insert.args[1],'XAUUSD');
 assert.equal(insert.args[3],analysisArchiveKey(fixture));
 assert.ok(insert.args[4].includes('EMA alignment'));
 assert.equal((await archive.list({symbol:'BTCUSD',status:'SCANNING',query:'EMA'})).items.length,0);
 const select=calls.find(x=>x.sql.startsWith('SELECT id,recorded_at,data FROM nabd_analysis_observations'));
 assert.ok(select.sql.includes('symbol=$1'));
 assert.ok(select.sql.includes('status=$2'));
 assert.ok(select.sql.includes('ILIKE'));
 await assert.rejects(archive.list({query:'!'.repeat(81)}),RangeError);
 await assert.rejects(archive.list({symbol:'ETHUSD'}),RangeError);
 await archive.close();
});
test('SQLite observations can be migrated into PostgreSQL without containing account or trade data',async()=>{
 const sqlite=new DatabaseSync(':memory:');let time=NOW;
 const h=createAnalysisHistory({db:sqlite,clock:()=>time});
 const row={symbol:'XAUUSD',quote:{time},received_at:time,quoteTtl:20,connection:'LIVE',
  source_id:'MT5:sensitive-hash',account_ref:'SECRET-ACCOUNT-REF',
  analysis:{status:'READY',strategy:'FUSION',reason:'Signal checks aligned',score:85,
  frames:{M15:{direction:'BUY'}},checks:[],entrySafetyChecks:[],readinessChecks:[],
  plan:{entry:4050,sl:4020,tp:4100}}};
 h.capture({markets:{XAUUSD:row}});
 const calls=[];
 const pool={async query(sql,args=[]){calls.push({sql,args});return {rows:[]};}};
 const archive=await createPgAnalysisArchive({pool});
 await archive.bootstrapFromSqlite(sqlite);
 const imported=calls.find(x=>x.sql.includes('jsonb_array_elements'));
 assert.ok(imported);
 assert.ok(!JSON.stringify(imported.args).includes('SECRET-ACCOUNT-REF'));
 assert.ok(!JSON.stringify(imported.args).includes('4050'));
 assert.ok(!JSON.stringify(imported.args).includes('sensitive-hash'));
 sqlite.close();await archive.close();
});
test('failed PostgreSQL initialization does not prevent normal SQLite startup',async()=>{
 const archive=await createPgAnalysisArchive({pool:{async query(){throw new Error('DB unavailable');}}});
 assert.equal(archive,null);
});
