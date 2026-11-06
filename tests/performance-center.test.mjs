import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildPerformanceCenter,verifiedClosedPositions,validatePerformanceFilters} from '../performance-center.mjs';
import {createApplication} from '../server.mjs';

const NOW=1794000000;
const deal=(ticket,position_id,entry_type,volume,profit,commission=0,extra={})=>({
 ticket:String(ticket),position_id:String(position_id),time:NOW-450+ticket*10,
 side:'BUY',entry_type,volume,price:2100,
 profit,commission,swap:0,fee:0,...extra
});
const source=(symbol='XAUUSD',demo=true,currency='USD')=>({
 symbol,received_at:NOW-1,account:{currency,balance:5000},execution:{demo},
 positions:[{ticket:'303',position_id:'303'}],
 deals:[
  deal(1,101,'IN',1,0,-1),deal(2,101,'OUT',1,12,-1),
  deal(3,202,'IN',.5,0,-.5),deal(4,202,'OUT',.5,-4,-.5),
  deal(5,303,'IN',1,0),deal(6,404,'IN',1,0),deal(7,404,'OUT',.4,5),
  deal(8,505,'OUT',1,10),deal(9,606,'INOUT',1,99),
  deal(2,101,'OUT',1,12,-1) // duplicate broker ticket
 ]
});
test('phase 10 uses completed broker positions only, including commissions and split entries',()=>{
 const extracted=verifiedClosedPositions({...source(),mode:'DEMO',currency:'USD',now:NOW});
 assert.equal(extracted.trades.length,2);
 assert.deepEqual(extracted.trades.map(t=>t.net),[10,-5]);
 assert.ok(extracted.excluded>=3);
 const report=buildPerformanceCenter({sources:[source()],filters:{symbol:'XAUUSD',mode:'DEMO',period:'ALL'},now:NOW});
 const m=report.summary;
 assert.equal(m.count,2);
 assert.equal(m.wins,1);assert.equal(m.losses,1);
 assert.equal(m.winRatePercent,50);
 assert.equal(m.net,5);
 assert.equal(m.profitFactor,2);
 assert.equal(m.averageWin,10);assert.equal(m.averageLoss,-5);
 assert.equal(m.maxClosedPnlDrawdown,5);
 assert.equal(m.averageRiskReward,null);
 assert.equal(report.currency,'USD');assert.equal(report.kind,'MT5_FULLY_CLOSED_POSITIONS_ONLY');
 assert.equal(m.equityCurve.length,3);
 assert.ok(report.incompleteHistory);
});
test('no verified source, missing account mode, or missing deal details means no invented performance',()=>{
 const noEvidence=buildPerformanceCenter({sources:[
  {...source(),account:null}, {...source('BTCUSD'),execution:{demo:null}},
  {...source('BTCUSD'),deals:[]}
 ],now:NOW});
 assert.equal(noEvidence.summary.count,0);
 assert.equal(noEvidence.summary.net,null);
 assert.equal(noEvidence.summary.winRatePercent,null);
 assert.equal(noEvidence.summary.profitFactor,null);
 assert.equal(noEvidence.summary.averageRiskReward,null);
 assert.equal(noEvidence.bySymbol.BTCUSD.count,0);
});
test('gold versus bitcoin and Demo versus Live never combine incompatible account totals',()=>{
 const demo=source('XAUUSD',true),live=source('BTCUSD',false);
 const result=buildPerformanceCenter({sources:[demo,live],now:NOW});
 assert.equal(result.mixedMode,true);
 assert.equal(result.summary.count,4);
 assert.equal(result.summary.net,null);
 assert.equal(result.summary.profitFactor,null);
 assert.equal(result.summary.equityCurve.length,0);
 assert.equal(result.bySymbol.XAUUSD.net,5);
 assert.equal(result.bySymbol.BTCUSD.net,5);
 const gold=buildPerformanceCenter({sources:[demo,live],filters:{symbol:'XAUUSD',mode:'DEMO'},now:NOW});
 assert.equal(gold.summary.count,2);assert.equal(gold.mixedMode,false);assert.equal(gold.summary.net,5);
 const differentCurrencies=buildPerformanceCenter({sources:[demo,source('BTCUSD',true,'EUR')],now:NOW});
 assert.equal(differentCurrencies.mixedCurrency,true);
 assert.equal(differentCurrencies.summary.net,null);
 assert.equal(differentCurrencies.summary.equityCurve.length,0);
});
test('performance filters and zero-sample result are correctly bounded',()=>{
 assert.throws(()=>validatePerformanceFilters({symbol:'ETHUSD'}),RangeError);
 assert.throws(()=>validatePerformanceFilters({period:'190D'}),RangeError);
 assert.throws(()=>validatePerformanceFilters({mode:'PAPER'}),RangeError);
 const report=buildPerformanceCenter({sources:[source()],filters:{period:'7D'},now:NOW+20*86400});
 assert.equal(report.summary.count,0);
 assert.equal(report.summary.net,null);
});
test('performance API is operator-only, browser routes and assets exist without leaking the ledger',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'nabd-perf-10-')),token='T'.repeat(40);
 const app=createApplication({dataDir:dir,dashboardToken:token});
 await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;
 assert.equal((await fetch(base+'/api/performance-center')).status,403);
 const permitted=await fetch(base+'/api/performance-center',{headers:{Authorization:'Bearer '+token}});
 assert.equal(permitted.status,200);
 const body=await permitted.json();
 assert.equal(body.privacy,'OPERATOR_ONLY');
 assert.equal(body.summary.count,0);
 assert.equal(body.summary.net,null);
 assert.equal((await fetch(base+'/api/performance-center?symbol=ETHUSD',{headers:{Authorization:'Bearer '+token}})).status,400);
 const page=await fetch(base+'/performance-center');
 assert.equal(page.status,200);
 assert.match(await page.text(),/id="performance-main"/);
 for(const [route,type]of [['/performance-center.css','text/css'],['/performance-center.js','javascript']]){
  const res=await fetch(base+route);
  assert.equal(res.status,200);
  assert.match(res.headers.get('content-type'),new RegExp(type));
 }
});
test('marketing never publishes account-specific stats, and chart UI uses real protected metrics',()=>{
 const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
 const client=read('public/performance-center.js');
 const html=read('public/performance-center.html'),server=read('server.mjs'),dashboard=read('public/index.html');
 assert.match(server,/if\(!operator\(req\)\)return send\(req,res,403/);
 assert.match(client,/requestJson\('\/api\/performance-center\?'/);
 assert.match(html,/data-i18n="disclaimer"/);
 assert.match(html,/id="market"/);assert.match(html,/id="period"/);assert.match(html,/id="mode"/);
 assert.match(dashboard,/href="\/performance-center"/);
 assert.doesNotMatch(client,/\/api\/commands|OrderSend|\/api\/bridge\/next|\/api\/risk-settings/);
 assert.doesNotMatch(read('public/landing.html'),/\/api\/performance-center/);
 assert.doesNotMatch(read('public/landing-en.html'),/\/api\/performance-center/);
});
