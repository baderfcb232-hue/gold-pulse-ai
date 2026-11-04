import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createApplication} from '../server.mjs';
import {sparklineGeometry} from '../public/mini-spark.js';
import {gazanDay,inSignalDateRange} from '../public/signal-date-filter.js';
const read=path=>readFileSync(new URL('../public/'+path,import.meta.url),'utf8');

test('Gaza-time signal history defaults to today + yesterday without deleting older records',()=>{
 const now=Date.parse('2026-11-04T10:00:00Z')/1000;
 const today=Date.parse('2026-11-04T08:00:00Z')/1000;
 const yesterday=Date.parse('2026-11-03T08:00:00Z')/1000;
 const older=Date.parse('2026-10-30T08:00:00Z')/1000;
 assert.equal(gazanDay(today),'2026-11-04');
 assert.equal(inSignalDateRange(today,'TWO_DAYS',now),true);
 assert.equal(inSignalDateRange(yesterday,'TWO_DAYS',now),true);
 assert.equal(inSignalDateRange(older,'TWO_DAYS',now),false);
 assert.equal(inSignalDateRange(older,'ALL',now),true);
 assert.equal(inSignalDateRange(yesterday,'TODAY',now),false);
 assert.equal(inSignalDateRange(yesterday,'YESTERDAY',now),true);
});

test('sparkline comes only from real positive quotes, never invents missing points',()=>{
 assert.equal(sparklineGeometry([]),null);
 assert.equal(sparklineGeometry([{time:100,price:10}]),null);
 assert.equal(sparklineGeometry([{time:100,price:0},{time:200,price:9}]),null);
 const x=sparklineGeometry([{time:100,price:4043.5},{time:200,price:4045},{time:300,price:4044}]);
 assert.equal(x.points.length,3);
 assert.match(x.path,/^M/);
 assert.equal(x.points[1].price,4045);
});

test('dashboard CSS fixes notifications, live Ask/Bid/spread, news, trading and locale',()=>{
 const html=read('index.html'),css=read('dashboard-fixes.css'),js=read('app.js'),live=read('live.js');
 for(const id of ['mini-market-card','mini-market-line','mini-market-dot','dashboard-language-choice',
   'signal-date-filter','scalp-history-date','trade-sizing-lot','pause-bot','market-symbols'])
   assert.ok(html.includes('id="'+id+'"'),'missing '+id);
 for(const selector of ['.toast.error','.broker-quote-values>span:first-child',
   '.broker-quote-values>span:nth-child(2)','.news-card','.headline-source',
   '.broker-workspace','.signal-budget-form','.nav-footer'])
   assert.ok(css.includes(selector),'missing style '+selector);
 assert.match(js,/sizingForm\.onsubmit=async event/);
 assert.match(js,/api\('\/api\/trade-sizing'/);
 assert.match(js,/LOT_STEP_MISMATCH/);
 assert.match(live,/mini\.update\(/);
 assert.match(live,/inSignalDateRange/);
 assert.match(live,/signal-budget-form/);
 assert.doesNotMatch(css,/OrderSend|POST \/api\/trade-sizing/);
 for(const name of ['app.js','live.js','mini-spark.js','dashboard-locale.js','signal-date-filter.js']){
   const checked=spawnSync(process.execPath,['--check',new URL('../public/'+name,import.meta.url).pathname],{encoding:'utf8'});
   assert.equal(checked.status,0,name+': '+checked.stderr);
 }
});

test('new presentation assets serve on dashboard with protected APIs intact',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'nabd-dashboard-ux-'));
 const app=createApplication({dataDir:dir});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;
 const dash=await fetch(base+'/dashboard');
 assert.equal(dash.status,200);
 assert.match(await dash.text(),/dashboard-fixes\.css/);
 for(const path of ['/dashboard-fixes.css','/dashboard-locale.js','/mini-spark.js','/signal-date-filter.js']){
   const response=await fetch(base+path);
   assert.equal(response.status,200,path);
 }
 assert.equal((await fetch(base+'/api/trade-sizing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol:'XAUUSD',mode:'FIXED',lot:1})})).status,401);
 assert.equal((await (await fetch(base+'/healthz')).json()).ok,true);
});
