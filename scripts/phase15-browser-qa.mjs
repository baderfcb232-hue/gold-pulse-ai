// Phase15 isolated browser visual QA. Fixture results are synthetic UI data ONLY,
// not market performance. No broker or production network access.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createApplication} from '../server.mjs';
const dir='qa-artifacts/phase15';await mkdir(dir,{recursive:true});
const app=createApplication({accountOptions:{env:{}}});
await app.accounts.ready;
await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
const base='http://127.0.0.1:'+app.server.address().port;
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const bucket={'< -2R':0,'-2..-1R':1,'-1..0R':3,'0..1R':1,'1..2R':2,'>= 2R':0};
const summary={trades:7,winRate:0.428571,profitFactor:1.4,maxDrawdownR:3.1,
 netR:0.6,meanDurationSeconds:780,meanPlannedRR:2.1,netPerLotCurrency:33,distribution:bucket};
const report={kind:'NABD_OFFLINE_STRATEGY_LAB_V1',symbol:'XAUUSD',brokerSymbol:'XAUUSD.m',
 inputSha256:'a'.repeat(64),quality:{broker:'JustMarkets',server:'Demo',provenanceStatus:'DECLARED_NOT_INDEPENDENTLY_VERIFIED'},
 assumptions:{spreadPoints:15,slippagePoints:3,roundTripCommissionPerLot:8,tradingEnabled:false},
 results:{development:{start:1700000000,end:1740000000,baseline:summary,experimental:{...summary,trades:9}},
 outOfSample:{start:1740000000,end:1760000000,baseline:summary,experimental:{...summary,trades:10},
  stress:{multiplier:1.5,baseline:{...summary,netR:-1.6},experimental:{...summary,netR:-2.2}}}},
 warnings:['Synthetic UI fixture; no historical trading claim']};
const agenticReport={
 kind:'NABD_AGENTIC_HISTORICAL_PAPER_DIAGNOSTIC_V1',symbol:'BTCUSD',brokerSymbol:'BTCUSD.m',
 brain:{model:'mock-only',actualModelInvoked:false,invocationCount:0,noOrders:true},
 folds:[{fold:1,sampled:1,modelCompleted:0,directionalHypotheses:0,modeledFavorableShare:null},
  {fold:2,sampled:1,modelCompleted:0,directionalHypotheses:0,modeledFavorableShare:null}],
 samples:[{fold:1,asOf:1750000000,symbol:'BTCUSD',stance:'WAIT',confidence:null,
  thesis:'<img src=x onerror=alert(1)>',evidence:[],blockedReason:'MODEL_NOT_RUN_OPT_IN_REQUIRED',
  contextSha256:'c'.repeat(64),forward:null,order:null,executionAllowed:false},
  {fold:2,asOf:1760000000,symbol:'BTCUSD',stance:'WAIT',confidence:null,
   thesis:null,evidence:[],blockedReason:'MODEL_NOT_RUN_OPT_IN_REQUIRED',
   contextSha256:'b'.repeat(64),forward:null,order:null,executionAllowed:false}],
 warnings:['Only a simulated UI fixture. No AI inference and no trades.'],
 tradingEnabled:false,executionPermission:false
};
async function run(width,height){
 const context=await browser.newContext({viewport:{width,height},acceptDownloads:true});
 const page=await context.newPage(),posts=[];
 page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});
 await page.goto(base+'/strategy-lab',{waitUntil:'domcontentloaded'});
 assert.equal(await page.locator('#lab-results').isVisible(),false);
 await page.locator('#lab-file').setInputFiles({name:'fixture-report.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(report))});
 await page.locator('#lab-results').waitFor({state:'visible',timeout:10000});
 assert.match(await page.locator('#lab-result-title').innerText(),/الذهب/);
 assert.equal(await page.locator('#lab-comparison tr').count(),8);
 await page.locator('#lab-cost').selectOption('stress');
 assert.match(await page.locator('#lab-result-title').innerText(),/تكاليف أعلى/);
 await page.locator('#lab-period').selectOption('development');
 assert.match(await page.locator('#lab-result-title').innerText(),/تطوير الاستراتيجية/);
 const download=page.waitForEvent('download');
 await page.locator('#lab-download').click();
 assert.equal((await download).suggestedFilename(),'NABD_Strategy_Lab_Report.json');
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
 assert.ok(overflow<=12,'Unexpected horizontal overflow '+overflow);
 assert.deepEqual(posts,[],'File uploads and POST calls must not occur');
 await page.screenshot({path:dir+'/dashboard-'+width+'x'+height+'.png',fullPage:true});
 await page.locator('#lab-file').setInputFiles({
   name:'agentic-paper-fixture.json',mimeType:'application/json',
   buffer:Buffer.from(JSON.stringify(agenticReport))});
 await page.locator('#lab-agentic-results').waitFor({state:'visible',timeout:10000});
 assert.equal(await page.locator('#lab-results').isVisible(),false);
 assert.match(await page.locator('#lab-agentic-heading').innerText(),/بيتكوين/);
 assert.equal(await page.locator('#lab-agentic-folds tr').count(),2);
 assert.equal(await page.locator('#lab-agentic-decisions details').count(),2);
 await page.locator('#lab-agentic-fold-filter').selectOption('2');
 assert.equal(await page.locator('#lab-agentic-decisions details').count(),1);
 await page.locator('#lab-agentic-fold-filter').selectOption('1');
 await page.locator('#lab-agentic-decisions summary').click();
 assert.equal(await page.locator('#lab-agentic-decisions img').count(),0,'Never render model output as HTML');
 assert.match(await page.locator('#lab-agentic-decisions').innerText(),/onerror=alert/);
 assert.match(await page.locator('#lab-agentic-source').innerText(),/لم يتم استدعاء نموذج AI/);
 assert.equal(await page.locator('#lab-download').isEnabled(),true);
 assert.deepEqual(posts,[],'No report is ever uploaded');
 const aiOverflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
 assert.ok(aiOverflow<=12,'Unexpected AI report horizontal overflow '+aiOverflow);
 await page.screenshot({path:dir+'/agentic-'+width+'x'+height+'.png',fullPage:true});
 await context.close();
}
try{await run(1440,900);await run(390,844);console.log('Phase15 offline report UI: PASS');}
finally{await browser.close();await app.close();}
