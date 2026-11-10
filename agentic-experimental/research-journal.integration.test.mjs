import test from 'node:test';
import assert from 'node:assert/strict';
import {connectResearchJournal} from './research-journal-pg.mjs';
const url=process.env.NABD_TEST_RESEARCH_DATABASE_URL;
test('isolated Postgres actually migrates, persists and rejects revised forecast', {skip:!url},async()=>{
 let connection=await connectResearchJournal({url});
 assert.equal(connection.status,'CONNECTED');
 const journal=connection.journal;
 const scheduledAt=1800000000;
 const provider='CI_TEST_'+process.pid;
 const id='ONE';
 try{
  const first=await journal.saveForecast({provider,id,scheduledAt,observedAt:scheduledAt-100,raw:'3.2%'});
  assert.deepEqual(first,{inserted:true});
  const revised=await journal.saveForecast({provider,id,scheduledAt,observedAt:scheduledAt-50,raw:'4.0%'});
  assert.deepEqual(revised,{inserted:false});
  assert.deepEqual(await journal.firstForecast({provider,id,scheduledAt}),{raw:'3.2%',observedAt:scheduledAt-100});
  assert.deepEqual(await journal.saveActual({provider,id,scheduledAt,observedAt:scheduledAt+30,raw:'3.4%'}),{inserted:true});
  await connection.close();connection=null;
  const reopened=await connectResearchJournal({url});assert.equal(reopened.status,'CONNECTED');
  try{assert.deepEqual(await reopened.journal.firstForecast({provider,id,scheduledAt}),{raw:'3.2%',observedAt:scheduledAt-100});}
  finally{await reopened.close();}
 }finally{if(connection)await connection.close();}
});
test('production-name URL rejected before migrations', {skip:!url},async()=>{
 const parsed=new URL(url);parsed.pathname='/postgres';
 const result=await connectResearchJournal({url:parsed.toString()});
 assert.notEqual(result.status,'CONNECTED');
});
