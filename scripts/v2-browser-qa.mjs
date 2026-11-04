/* NABD UI browser audit: local isolated server, never connects to Demo/Live brokers or places orders. */
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createApplication} from '../server.mjs';

const dir=mkdtempSync(join(tmpdir(),'nabd-browser-audit-'));
const screenshots='qa-artifacts';
mkdirSync(screenshots,{recursive:true});
const app=createApplication({dataDir:dir});
let browser,checks=0;
const results=[],failures=[];
try{
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.server.address().port;
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const widths=[320,390,768,1280];
 for(const width of widths)for(const lang of ['ar','en'])for(const theme of ['light','dark'])for(const route of ['/dashboard','/account']){
   const ctx=await browser.newContext({viewport:{width,height:850},deviceScaleFactor:1,isMobile:width<500,hasTouch:width<500});
   await ctx.addInitScript(({lang,theme})=>{
     try{
       localStorage.setItem('nabd:dashboard:language',lang);
       localStorage.setItem('nabd-marketing-language',lang);
       localStorage.setItem('nabd:dashboard:theme',theme);
     }catch{}
   },{lang,theme});
   const page=await ctx.newPage();
   const title=[route.slice(1),width,lang,theme].join('-');
   try{
     const response=await page.goto(base+route,{waitUntil:'domcontentloaded',timeout:30000});
     assert.equal(response?.status(),200,title+' page status');
     await page.waitForFunction(expected=>document.documentElement.lang===expected,lang,{timeout:10000});
     await page.waitForTimeout(160);
     assert.equal(await page.locator('html').getAttribute('dir'),lang==='en'?'ltr':'rtl',title+' direction');
     assert.equal(await page.locator('html').getAttribute('data-nabd-theme'),theme,title+' appearance');
     const metrics=await page.evaluate(()=>{
       const root=document.documentElement,body=document.body;
       const viewport=root.clientWidth,scroll=Math.max(root.scrollWidth,body.scrollWidth);
       const offenders=[...document.querySelectorAll('body *')].filter(el=>{
         if(el.closest('[hidden]'))return false;
         const rc=el.getBoundingClientRect();
         return rc.width>0&&(rc.right>window.innerWidth+5||rc.left< -5);
       }).slice(0,5).map(el=>el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+(el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\s+/)[0]:''));
       return {viewport,scroll,overflow:Math.max(0,scroll-viewport),offenders,
         transfer:performance.getEntriesByType('resource').reduce((total,x)=>total+(x.transferSize||0),0),
         nodes:document.getElementsByTagName('*').length};
     });
     assert.ok(metrics.overflow<=5,title+' document overflow '+JSON.stringify(metrics));
     assert.ok(metrics.transfer<6_000_000,title+' assets exceed browser transfer budget');
     if(route==='/dashboard'){
       await page.locator('#mini-market-chart').focus();
       assert.equal(await page.locator('#mini-market-chart').getAttribute('tabindex'),'0');
       const select=page.locator('#dashboard-language-choice');
       await select.selectOption(lang==='ar'?'en':'ar');
       await page.waitForFunction(value=>document.documentElement.lang===value,lang==='ar'?'en':'ar',{timeout:10000});
       await select.selectOption(lang);
       await page.waitForFunction(value=>document.documentElement.lang===value,lang,{timeout:10000});
     }
     checks++;results.push({title,...metrics});
   }catch(err){
     const shot=join(screenshots,title+'.png');
     try{await page.screenshot({path:shot,fullPage:true,timeout:10000});}catch{}
     failures.push(title+': '+String(err));
   }finally{await ctx.close();}
 }
 for(const path of ['/','/en']){
   const ctx=await browser.newContext({viewport:{width:390,height:850}});
   const page=await ctx.newPage();
   try{
     const res=await page.goto(base+path,{waitUntil:'domcontentloaded'});
     assert.equal(res?.status(),200);
     assert.equal(await page.locator('.market-motion').count(),1);
     checks++;results.push({title:path+' marketing',ok:true});
   }catch(e){failures.push(path+': '+String(e));}
   finally{await ctx.close();}
 }
 // Offline test is intentionally navigation-only: no market payload or bot command is replayed.
 const ctx=await browser.newContext({viewport:{width:390,height:850},serviceWorkers:'allow'});
 const page=await ctx.newPage();
 try{
   await page.goto(base+'/dashboard',{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>Boolean(navigator.serviceWorker?.controller),null,{timeout:20000});
   await ctx.setOffline(true);
   await page.goto(base+'/dashboard',{waitUntil:'domcontentloaded',timeout:15000});
   const notice=await page.locator('body').innerText();
   assert.match(notice,/لا يوجد اتصال بالإنترنت/);
   assert.match(notice,/Live prices, signals and MT5 execution status are unavailable/);
   checks++;results.push({title:'offline navigation',ok:true});
 }catch(e){failures.push('offline navigation: '+String(e));}
 finally{await ctx.close();}
 writeFileSync(join(screenshots,'summary.json'),JSON.stringify({checks,failures,results},null,2));
 const samples=results.filter(x=>Number.isFinite(x.transfer));
 const totalBytes=samples.reduce((n,x)=>n+x.transfer,0);
 console.log('NABD browser QA',JSON.stringify({checks,failures:failures.length,viewports:widths,locales:['ar','en'],themes:['light','dark'],avgTransferKB:samples.length?Math.round(totalBytes/samples.length/1024):null}));
 if(failures.length)throw new Error(failures.join('\n'));
}finally{
 await browser?.close();
 await app.close();
 rmSync(dir,{recursive:true,force:true});
}
