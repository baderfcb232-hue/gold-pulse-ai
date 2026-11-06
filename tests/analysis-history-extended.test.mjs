import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {analysisHistoryCsv,createAnalysisHistory} from '../analysis-history.mjs';
import {historyQuery,historyChartLink} from '../public/analysis-history.js';
import {chartHistoryContext} from '../public/chart-pages.js';
import {createApplication} from '../server.mjs';

const NOW=Math.floor(Date.now()/1000);
const sample=(symbol,status,reason)=>({
 symbol,source_id:'MT5:private-user-id',broker_symbol:symbol+'.m',
 quote:{time:NOW-3,price:4025},received_at:NOW-3,quoteTtl:15,connection:'LIVE',
 analysis:{status,decision:'WAIT',strategy:'FUSION',reason_label:reason,
 frames:{M15:{direction:'SELL'},H1:{direction:'NEUTRAL'}},
 score:72,checks:[{name:'EMA M15',pass:false}],
 entrySafetyChecks:[{name:'Stop distance',pass:false}]},
 account_ref:'123456789',password:'must-never-leak'
});
const state=m=>({markets:{[m.symbol]:m}});

test('server-side exact-substring history search supports Arabic and rejects unbounded queries',()=>{
 let time=NOW;
 const db=new DatabaseSync(':memory:');
 const h=createAnalysisHistory({db,clock:()=>time,storagePersistent:true});
 const gold=sample('XAUUSD','SCANNING','انتظار توافق الاتجاه');
 const btc=sample('BTCUSD','BLOCKED','RSI gate rejected');
 assert.equal(h.capture(state(gold)),1);
 time+=60;btc.quote.time=time-3;btc.received_at=time-3;
 assert.equal(h.capture(state(btc)),1);
 assert.equal(h.list({query:'انتظار'}).items.length,1);
 assert.equal(h.list({query:'rsi'}).items.length,1);
 assert.equal(h.list({query:'RSI',symbol:'XAUUSD'}).items.length,0);
 assert.equal(h.list({query:'%'}).items.length,0); // literal, not a LIKE wildcard
 assert.throws(()=>h.list({query:'a'.repeat(101)}),RangeError);
 assert.throws(()=>h.list({query:'\n'}),RangeError);
 const csv=h.exportCsv({query:'انتظار'});
 assert.match(csv,/XAUUSD/);
 assert.doesNotMatch(csv,/BTCUSD|123456789|must-never-leak/);
 db.close();
});

test('CSV quotes values, blocks formula execution, and never labels analyses as fills',()=>{
 const csv=analysisHistoryCsv([{
  recorded_at:NOW,symbol:'XAUUSD',status:'BLOCKED',source_type:'MT5',
  decision:'WAIT',score:45,strategy:'FUSION',
  reason:'=HYPERLINK("https://unsafe.example","run")',
  frames:{M15:'SELL'},indicator_checks:[],readiness_checks:[],
  entry_checks:[{label:'-cmd|bad',pass:false}]
 }]);
 assert.ok(csv.startsWith('\uFEFFrecorded_at,'));
 assert.match(csv,/"'=HYPERLINK\(""https:\/\/unsafe\.example"",""run""\)"/);
 assert.match(csv,/"'-cmd\|bad"/);
 assert.match(csv,/ANALYSIS_OBSERVATION/);
 assert.doesNotMatch(csv,/DEAL_CONFIRMED|ticket|account_ref|profit/);
});

test('history search and CSV endpoint remain member-gated, pagination source-safe, and CSV-limited',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'nabd-hist-ext-'));
 const app=createApplication({dataDir:dir});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;
 assert.equal((await fetch(base+'/api/analysis-history.csv')).status,401);
 assert.equal((await fetch(base+'/api/analysis-history?q=FUSION')).status,401);
 const enabled=createApplication({dataDir:join(dir,'public'),config:{membersOnlySignals:false}});
 await new Promise(resolve=>enabled.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await enabled.close();});
 const host='http://127.0.0.1:'+enabled.server.address().port;
 const g=sample('XAUUSD','BLOCKED','Spread check failed');
 enabled.analysisHistory.capture(state(g));
 const good=await fetch(host+'/api/analysis-history?q=Spread');
 assert.equal(good.status,200);
 assert.equal((await good.json()).items.length,1);
 assert.equal((await fetch(host+'/api/analysis-history?q='+encodeURIComponent('\n'))).status,400);
 const exported=await fetch(host+'/api/analysis-history.csv?q=Spread');
 assert.equal(exported.status,200);
 assert.match(exported.headers.get('content-type'),/text\/csv/);
 assert.match(exported.headers.get('content-disposition'),/nabd-analysis-history\.csv/);
 const body=await exported.text();
 assert.match(body,/Spread check failed/);
 assert.doesNotMatch(body,/private-user-id|account_ref|password|123456789/);
 assert.equal((await fetch(host+'/api/analysis-history.csv?symbol=ETHUSD')).status,400);
});

test('historical links navigate only to real MT5 chart paths with verified timestamp and timeframe',()=>{
 const path=historyChartLink({
  symbol:'XAUUSD',source_type:'MT5',recorded_at:NOW,frames:{M15:'BUY'}
 });
 assert.equal(path,'/charts/gold?at='+NOW+'&tf=M15');
 assert.equal(historyChartLink({symbol:'BTCUSD',source_type:'REFERENCE',recorded_at:NOW}),null);
 assert.equal(historyChartLink({symbol:'ETHUSD',source_type:'MT5',recorded_at:NOW}),null);
 assert.equal(historyChartLink({symbol:'BTCUSD',source_type:'MT5',recorded_at:NOW,frames:{H1:'SELL'}}),
  '/charts/bitcoin?at='+NOW+'&tf=H1');
 assert.deepEqual(chartHistoryContext('?at='+NOW+'&tf=M15','XAUUSD',NOW+1),{at:NOW,tf:'M15'});
 assert.equal(chartHistoryContext('?at=1&tf=M15','XAUUSD',NOW),null);
 assert.equal(chartHistoryContext('?at='+NOW+'&tf=M1','XAUUSD',NOW),null);
 assert.equal(chartHistoryContext('?at='+NOW+'&tf=M15','ETHUSD',NOW),null);
});
test('history-to-chart feature shows source and time context without backfilling or modifying trading',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 const history=read('public/analysis-history.js'),html=read('public/analysis-history.html');
 const broker=read('public/broker-chart.js'),chart=read('public/chart-pages.js');
 assert.match(html,/id="history-search"/);
 assert.match(html,/id="history-export"/);
 assert.match(history,/query:\$\('history-search'\)\.value\.trim\(\)/);
 assert.match(history,/historyChartLink\(item\)/);
 assert.match(history,/\.replace\('\/api\/analysis-history\?','\/api\/analysis-history\.csv\?'\)/);
 assert.match(broker,/highlightAt/);
 assert.match(broker,/return highlighted/);
 assert.match(chart,/chartHistoryContext/);
 assert.match(chart,/historicalMissing/);
 assert.match(chart,/brokerChartFresh/);
 for(const source of [history,chart]){
  assert.doesNotMatch(source,/\/api\/commands|OrderSend|\/api\/bridge\/next|\/api\/risk-settings/);
 }
});
