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
     // Verify actual computed alert colors, not just static CSS tokens.
     if(width===390 && route==='/dashboard'){
       const colors=await page.evaluate(()=>{
         const box=document.createElement('div');
         box.className='toast-stack';
         box.style.position='static';
         box.style.pointerEvents='none';
         document.body.append(box);
         const values={};
         for(const kind of ['error','success','warning','info']){
           const toast=document.createElement('div');
           toast.className='toast';
           toast.dataset.kind=kind;
           toast.textContent='Test only';
           box.append(toast);
           const computed=getComputedStyle(toast);
           values[kind]={foreground:computed.color,background:computed.backgroundColor};
           toast.remove();
         }
         box.remove();
         return values;
       });
       const brightness=col=>{
         const parts=(col.match(/[\\d.]+/g)||[]).slice(0,3).map(Number);
         assert.equal(parts.length,3,'Missing computed RGB '+col);
         const [red,green,blue]=parts.map(v=>{
           const x=v/255;return x<=0.04045?x/12.92:((x+.055)/1.055)**2.4;
         });
         return red*.2126+green*.7152+blue*.0722;
       };
       for(const [kind,value] of Object.entries(colors)){
         const a=brightness(value.foreground),b=brightness(value.background);
         const contrast=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
         assert.ok(contrast>=4.5,title+' '+kind+' notification contrast '+contrast.toFixed(2));
       }
       results.push({title:title+' alert WCAG AA',pass:true});
       checks++;
     }
     // Report any visible Arabic left in the English shell; user-provided news,
     // brand marks and the Arabic language-switch option are intentionally excluded.
     if(width===390 && lang==='en' && theme==='light'){
       const remaining=await page.evaluate(()=>{
         const seen=new Set();
         for(const el of document.querySelectorAll('body *')){
           if(el.closest('script,style,[hidden],.brand,.brand-word,[lang="ar"],select option[value="ar"]'))continue;
           if(!el.getClientRects().length||getComputedStyle(el).visibility==='hidden')continue;
           for(const node of el.childNodes){
             if(node.nodeType!==3)continue;
             const value=(node.textContent||'').trim();
             if(value && /[\\u0600-\\u06FF]/.test(value))seen.add(value.slice(0,190));
           }
         }
         return [...seen].slice(0,35);
       });
       console.log('NABD English visible-copy audit:',JSON.stringify({page:route,remaining}));
       results.push({title:title+' English copy audit',remaining});
       checks++;
     }

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
 // Chromium must register the installable shell; network-loss fallback is
 // verified deterministically by a unit test because network emulation may
 // be bypassed by service-worker-managed navigation requests in this runner.
 const ctx=await browser.newContext({viewport:{width:390,height:850},serviceWorkers:'allow'});
 const page=await ctx.newPage();
 try{
   await page.goto(base+'/dashboard',{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>Boolean(navigator.serviceWorker?.controller),null,{timeout:20000});
   const scriptUrl=await page.evaluate(()=>navigator.serviceWorker.controller?.scriptURL);
   assert.ok(scriptUrl.endsWith('/sw.js'),'browser PWA controller must be the NABD service worker');
   checks++;results.push({title:'service worker controller',ok:true});
 }catch(e){failures.push('service worker controller: '+String(e));}
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
