// Phase 14: isolated REAL Chromium UI check. API responses are controlled
// fixture data; authorization security is independently tested in HTTP tests.
// NEVER accesses production nor connects to MT5.
import assert from 'node:assert/strict';
import {mkdir,rm} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createApplication} from '../server.mjs';

const dir='qa-artifacts/phase14';
await mkdir(dir,{recursive:true});
const app=createApplication({accountOptions:{env:{}}});
await app.accounts.ready;
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+app.server.address().port;
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const admin={user:{id:'fixture-admin',name:'Admin Test',role:'admin',email:'admin@example.test',mfa:true},
 adminReady:true,csrf:'test-csrf'};
const status={accounts:{backups:{state:'NOT_CONFIGURED',last_success:null}},
 counts:[{status:'active',count:3}],operational:{mt5:'STALE',publication:'NO_DATA',telegram:'DISCONNECTED'}};
const kpis={generatedAt:1794600000,users:{active:3},hosting:{REQUESTED:1},
 monitor:{registered:1,workers:1,freshWorkers:0,reportedOnline:0,
 verifiedBrokerConnections:null,tradeExecutionEnabled:false},lastBackupAt:null};
const audit={events:[{id:'evt-1',time:1794600000,event:'USER_UPDATED',actor:'=HYPERLINK("x")',subject:'test-id'}],
 total:1,nextOffset:null};
const hosting={requests:[{account_id:'acc-1',status:'REQUESTED',member_name:'Sample Member',
 requested_at:1794600000,monitoringOnly:true,tradeAllowed:false,currentObservation:'STALE_OR_UNKNOWN'}]};
async function visit(width,height,authorized){
 const context=await browser.newContext({viewport:{width,height},acceptDownloads:true,locale:'ar'});
 const page=await context.newPage();
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',route=>{
   const url=new URL(route.request().url());
   const name=url.pathname;
   const payload= name==='/api/auth/me' ? authorized?admin:{user:admin.user,adminReady:false,csrf:'test'} :
    name==='/api/admin/overview'?status:
    name==='/api/admin/users'?{users:[],page:0}:
    name==='/api/admin/audit'?{events:[]}:
    name==='/api/admin/mt5-hosting'?{accounts:[]}:
    name==='/api/admin/operations'?kpis:
    name==='/api/admin/operations/audit'?audit:
    name==='/api/admin/operations/hosting'?hosting:
    {error:'Not found'};
   const isAuthorized = !name.startsWith('/api/admin/')||authorized;
   const ok = isAuthorized&&payload.error==null;
   route.fulfill({status:ok?200:isAuthorized?404:403,contentType:'application/json',body:JSON.stringify(payload)});
 });
 await page.goto(base+'/admin',{waitUntil:'domcontentloaded'});
 if(authorized){
   await page.locator('#admin-ops-status').getByText('آخر تحديث:',{exact:false}).waitFor({timeout:12000});
   assert.equal(await page.locator('#admin-ops-panel').isVisible(),true);
   const text=await page.locator('#admin-ops-kpis').innerText();
   assert.match(text,/حسابات مفعلة/);assert.match(text,/غير مفعّل/);
   assert.match(text,/ليس إثبات وسيط/);
   await page.locator('.admin-ops-reports summary').click();
   assert.equal(await page.locator('#admin-ops-audit tbody tr').count(),1);
   assert.equal(await page.locator('#admin-ops-requests tbody tr').count(),1);
   const download=page.waitForEvent('download');
   await page.locator('#admin-ops-csv').click();
   const file=await download;
   assert.equal(file.suggestedFilename(),'nabd-admin-operations.csv');
   const buf=await (await import('node:fs/promises')).readFile(await file.path(),'utf8');
   assert.ok(buf.includes("'=HYPERLINK"));
   assert.ok(!buf.includes('password_hash'));
   await page.screenshot({path:dir+'/'+width+'x'+height+'.png',fullPage:true});
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
   assert.ok(overflow<=10,'Admin page horizontal overflow '+overflow+'px');
 }else{
   assert.equal(await page.locator('#admin-content').isVisible(),false);
   assert.equal(await page.locator('#admin-guard').isVisible(),true);
 }
 assert.equal(errors.filter(x=>x.includes('admin-operations')),0,errors.join('; '));
 await context.close();
}
try{
 await visit(1440,900,true);
 await visit(390,844,true);
 await visit(390,844,false);
 console.log('Phase14 admin Chromium desktop/mobile + MFA gate + CSV: PASS');
}finally{await browser.close();await app.close();}
