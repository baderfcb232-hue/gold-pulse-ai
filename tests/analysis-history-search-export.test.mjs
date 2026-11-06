import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createAnalysisHistory} from '../analysis-history.mjs';
import {analysisHistoryCsv,exportHistoryRows} from '../analysis-history-csv.mjs';
import {historyQuery} from '../public/analysis-history.js';
import {createApplication} from '../server.mjs';
const NOW=1793980800;
const obs=(reason,ts=NOW)=>({markets:{XAUUSD:{symbol:'XAUUSD',source_id:'MT5:private-hash',
 quote:{time:ts,price:4050},received_at:ts,quoteTtl:20,connection:'LIVE',
 analysis:{status:'BLOCKED',decision:'WAIT',score:80,reason_label:reason,
 strategy:'FUSION',frames:{M5:{direction:'BUY'},M15:{direction:'SELL'}},
 checks:[{name:'EMA',pass:true}],
 entrySafetyChecks:[{name:'Stop distance',pass:false}],
 readinessChecks:[]},account_ref:'sensitive-account-number'}}});
test('analysis journal search is parameterized and only matches recorded reasons or strategy',()=>{
 const db=new DatabaseSync(':memory:');
 let at=NOW;const h=createAnalysisHistory({db,clock:()=>at,minChangeSeconds:10});
 assert.equal(h.capture(obs('Spread too high',at)),1);
 at+=50;assert.equal(h.capture(obs('Risk gate not met',at)),1);
 assert.equal(h.list({query:'Spread'}).items.length,1);
 assert.equal(h.list({query:'Risk'}).items.length,1);
 assert.equal(h.list({query:'FUSION'}).items.length,2);
 assert.equal(h.list({query:'Nonexistent'}).items.length,0);
 assert.throws(()=>h.list({query:'x'.repeat(81)}),RangeError);
 assert.throws(()=>h.list({query:40}),RangeError);
 db.close();
});
test('CSV preserves source information, neutral placeholders and escapes spreadsheet formulas',()=>{
 const db=new DatabaseSync(':memory:');
 let at=NOW;const h=createAnalysisHistory({db,clock:()=>at});
 h.capture(obs('=HYPERLINK("https://bad.example","click")'));
 const rows=exportHistoryRows(h,{symbol:'XAUUSD'});
 assert.equal(rows.length,1);
 const csv=analysisHistoryCsv(rows);
 assert.ok(csv.startsWith('\uFEFF'));
 assert.match(csv,/NOT_VERIFIED_OR_LINKED/);
 assert.match(csv,/ANALYSIS_ONLY_NOT_TRADE_FILL/);
 assert.ok(!csv.includes('sensitive-account-number'));
 assert.ok(!csv.includes('private-hash'));
 assert.ok(csv.includes("'=HYPERLINK"));
 assert.equal(csv.split('\r\n').length,3);
 db.close();
});
test('history endpoint and CSV both require authorization; exports respect source filters',async t=>{
 const dataDir=mkdtempSync(join(tmpdir(),'nabd-phase8-export-'));
 const app=createApplication({dataDir,config:{membersOnlySignals:false}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await app.close();rmSync(dataDir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;
 const time=Math.floor(Date.now()/1000);
 app.analysisHistory.capture(obs('EMA mismatch',time));
 const result=await fetch(base+'/api/analysis-history?query=EMA&status=BLOCKED');
 assert.equal(result.status,200);
 assert.equal((await result.json()).items.length,1);
 const exp=await fetch(base+'/api/analysis-history.csv?query=EMA&symbol=XAUUSD');
 assert.equal(exp.status,200);
 assert.match(exp.headers.get('content-type'),/text\/csv/);
 assert.match(exp.headers.get('content-disposition'),/attachment/);
 assert.match(await exp.text(),/EMA mismatch/);
 assert.equal((await fetch(base+'/api/analysis-history.csv?symbol=ETHUSD')).status,400);
 assert.equal((await fetch(base+'/api/analysis-history?query='+encodeURIComponent('x'.repeat(85)))).status,400);
 const secureDir=mkdtempSync(join(tmpdir(),'nabd-phase8-secure-'));
 const secured=createApplication({dataDir:secureDir});
 await new Promise(resolve=>secured.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await secured.close();rmSync(secureDir,{recursive:true,force:true});});
 assert.equal((await fetch('http://127.0.0.1:'+secured.server.address().port+'/api/analysis-history.csv')).status,401);
});
test('search/export are read-only and do not tamper with strategies or orders',()=>{
 const js=readFileSync(new URL('../public/analysis-history.js',import.meta.url),'utf8');
 const html=readFileSync(new URL('../public/analysis-history.html',import.meta.url),'utf8');
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.match(html,/id="history-search"/);
 assert.match(html,/id="history-export"/);
 assert.match(js,/searchDebounce/);
 assert.match(js,/api\/analysis-history\.csv/);
 assert.match(server,/analysisHistory\.capture\(marketFeed\.publicState\(\)\)/);
 assert.ok((server.match(/analysisHistory\.capture\(marketFeed\.publicState\(\)\)/g)||[]).length>=4);
 for(const contents of [js,html])assert.doesNotMatch(contents,/OrderSend|\/api\/commands|\/api\/risk-settings/);
 const url=historyQuery({symbol:'BTCUSD',status:'SCANNING',query:'EMA',period:'DAY',now:NOW});
 assert.equal(new URL('https://example.com'+url).searchParams.get('query'),'EMA');
});
