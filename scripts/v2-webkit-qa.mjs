/* Real WebKit engine in CI; mobile emulation is not physical Apple hardware. */
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {webkit} from 'playwright';
import {createApplication} from '../server.mjs';
const dir=mkdtempSync(join(tmpdir(),'nabd-v2-webkit-'));
const app=createApplication({dataDir:dir});
let browser;
const screenshots='qa-webkit-artifacts';mkdirSync(screenshots,{recursive:true});
const results=[],errors=[];
try{
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.server.address().port;
 browser=await webkit.launch({headless:true});
 for(const width of [375,390])for(const lang of ['ar','en'])for(const theme of ['light','dark'])
 for(const route of ['/dashboard','/account','/']){
   const context=await browser.newContext({viewport:{width,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
   await context.addInitScript(({lang,theme})=>{
     localStorage.setItem('nabd:dashboard:language',lang);
     localStorage.setItem('nabd-marketing-language',lang);
     localStorage.setItem('nabd:dashboard:theme',theme);
   },{lang,theme});
   const page=await context.newPage();
   const id=route.replace(/\//g,'')||'home';
   try{
     const target=route==='/'&&lang==='en'?'/en':route;
     const response=await page.goto(base+target,{waitUntil:'domcontentloaded',timeout:30000});
     assert.equal(response?.status(),200);
     await page.waitForTimeout(260);
     if(route==='/dashboard'||route==='/account'){
       await page.waitForFunction(expected=>document.documentElement.lang===expected,lang,{timeout:12000});
       assert.equal(await page.locator('html').getAttribute('dir'),lang==='en'?'ltr':'rtl');
       assert.equal(await page.locator('html').getAttribute('data-nabd-theme'),theme);
     }
     const overflow=await page.evaluate(()=>Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-document.documentElement.clientWidth);
     assert.ok(overflow<=5,'horizontal overflow '+overflow+'px');
     if(route==='/dashboard'){
       assert.equal(await page.locator('#mini-market-chart').count(),1);
       await page.locator('#mini-market-chart').tap({timeout:5000});
       const controls=await page.locator('link[rel="manifest"]').getAttribute('href');
       assert.equal(controls,'/manifest.webmanifest');
     }
     if(route==='/account')assert.equal(await page.locator('link[rel="apple-touch-icon"]').count(),1);
     if(route==='/'){
       await page.locator('.market-motion').waitFor({timeout:8000});
       assert.equal(await page.locator('.market-motion').count(),1);
     }
     results.push({width,lang,theme,route,overflow,pass:true});
   }catch(error){
     errors.push({width,lang,theme,route,error:String(error)});
     try{await page.screenshot({path:join(screenshots,id+'-'+width+'-'+lang+'-'+theme+'.png'),fullPage:true,timeout:5000})}catch{}
   }finally{await context.close();}
 }
 writeFileSync(join(screenshots,'report.json'),JSON.stringify({checks:results.length,errors,results},null,2));
 console.log('NABD WebKit mobile QA:',JSON.stringify({checks:results.length,failures:errors.length,engines:'WebKit',widths:[375,390]}));
 if(errors.length)throw Error(JSON.stringify(errors));
}finally{
 await browser?.close();await app.close();rmSync(dir,{recursive:true,force:true});
}
