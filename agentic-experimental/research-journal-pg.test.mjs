import test from 'node:test';
import assert from 'node:assert/strict';
import {createResearchJournal,connectResearchJournal} from './research-journal-pg.mjs';
test('reject production database before any inserts',async()=>{
 let writes=0;
 const j=createResearchJournal({query:async(sql)=>{if(sql.startsWith('SELECT current_database'))return {rows:[{database_name:'nabd_accounts'}]};writes++;return {rowCount:1};}});
 await assert.rejects(()=>j.verify(),/WRONG_DATABASE_FAIL_CLOSED/);
 await assert.rejects(()=>j.saveForecast({provider:'X',id:'1',scheduledAt:2000,observedAt:1000,raw:'2.1%'}),/JOURNAL_NOT_VERIFIED/);
 assert.equal(writes,0);
});
test('isolated database allows only pre-release immutable forecast insert',async()=>{
 let inserts=0;
 const j=createResearchJournal({query:async(sql,params)=>{
   if(sql.startsWith('SELECT current_database'))return {rows:[{database_name:'nabd_agentic_research_test'}]};
   if(sql.startsWith('INSERT')){inserts++;assert.ok(sql.includes('ON CONFLICT DO NOTHING'));assert.equal(params[4],'2.1%');return {rowCount:inserts===1?1:0};}
   return {rows:[{forecast_raw:'2.1%',observed_at:'1000'}]};
 }});
 await j.verify();
 assert.deepEqual(await j.saveForecast({provider:'TE',id:'5',scheduledAt:2000,observedAt:1000,raw:'2.1%'}),{inserted:true});
 assert.deepEqual(await j.saveForecast({provider:'TE',id:'5',scheduledAt:2000,observedAt:1000,raw:'2.1%'}),{inserted:false});
 assert.deepEqual(await j.firstForecast({provider:'TE',id:'5',scheduledAt:2000}),{raw:'2.1%',observedAt:1000});
 assert.equal(j.status().verified,true);
});
test('do not store post-event forecast as point-in-time',async()=>{
 const j=createResearchJournal({query:async()=>({rows:[{database_name:'nabd_agentic_research_test'}]})});
 await j.verify();
 await assert.rejects(()=>j.saveForecast({provider:'TE',id:'1',scheduledAt:2000,observedAt:2000,raw:'2.5%'}),/INVALID_PRE_RELEASE_FORECAST/);
});
test('no database credentials stays not configured',async()=>{
 const r=await connectResearchJournal({url:null});
 assert.equal(r.status,'NOT_CONFIGURED');
});
