/* NABD V2: isolated browser-device emulation; no live broker calls or MT5 orders. */
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium,webkit,devices} from 'playwright';
import {createApplication} from '../server.mjs';

const cases=[
 {name:'iPhone 13 Safari',browser:'webkit',device:'iPhone 13'},
 {name:'iPad Mini Safari',browser:'webkit',device:'iPad Mini'},
 {name:'Pixel 7 Android Chrome',browser:'chromium',device:'Pixel 7'}
];
const languages=['ar','en'],themes=['light','dark'],routes=['/dashboard','/account'];
const temp=mkdtempSync(join(tmpdir(),'nabd-v2-device-')),artifacts='qa-device-artifacts';
mkdirSync(artifacts,{recursive:true});
const app=createApplication({dataDir:temp});
const browsers={};let completed=0;const failures=[],checks=[];
try{
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 const base='http://127.0.0.1:'+app.server.address().port;
 for(const spec of cases){
  const engine=spec.browser==='webkit'?webkit:chromium;
  browsers[spec.browser]??=await engine.launch({headless:true,args:spec.browser==='chromium'?['--no-sandbox','--disable-dev-shm-usage']:[]});
  for(const lang of languages)for(const theme of themes)for(const route of routes){
   const ctx=await browsers[spec.browser].newContext({...devices[spec.device],reducedMotion:'reduce'});
   await ctx.addInitScript(({lang,theme})=>{
    try{
     localStorage.setItem('nabd:dashboard:language',lang);
     localStorage.setItem('nabd-marketing-language',lang);
     localStorage.setItem('nabd:dashboard:theme',theme);
    }catch{}
   },{lang,theme});
   const page=await ctx.newPage();
   const tag=[spec.browser,spec.device.replaceAll(' ','-'),lang,theme,route.slice(1)].join('-');
   try{
    const res=await page.goto(base+route,{waitUntil:'domcontentloaded',timeout:30000});
    assert.equal(res?.status(),200,tag+' HTTP status');
    await page.waitForFunction(v=>document.documentElement.lang===v,lang,{timeout:12000});
    assert.equal(await page.locator('html').getAttribute('dir'),lang==='en'?'ltr':'rtl');
    assert.equal(await page.locator('html').getAttribute('data-nabd-theme'),theme);
    const measurements=await page.evaluate(()=>{
     const root=document.documentElement,body=document.body;
     return {viewport:root.clientWidth,scroll:Math.max(root.scrollWidth,body.scrollWidth),
       width:window.innerWidth,lang:root.lang,dir:root.dir,
       manifest:Boolean(document.querySelector('link[rel="manifest"]')),
       appleIcon:Boolean(document.querySelector('link[rel="apple-touch-icon"]')),
       pwaRegister:Boolean(document.querySelector('script[src*="pwa-register.js"]'))};
    });
    assert.ok(measurements.scroll-measurements.viewport<=5,tag+' horizontal overflow '+JSON.stringify(measurements));
    assert.equal(measurements.manifest,true);
    assert.equal(measurements.appleIcon,true);
    assert.equal(measurements.pwaRegister,true);
    if(route==='/dashboard'){
     const chart=page.locator('#mini-market-chart');
     await chart.waitFor();
     assert.equal(await chart.getAttribute('tabindex'),'0');
     assert.equal(await chart.getAttribute('role'),'group');
     if(lang==='en'){
      const text=(await page.locator('#live-update-age').innerText()).trim();
      assert.doesNotMatch(text,/[\u0600-\u06FF]/,tag+' untranslated quote status');
     }
     // Functional switching must work in touch browsers as well as desktop.
     const picker=page.locator('#dashboard-language-choice');
     await picker.selectOption(lang==='ar'?'en':'ar');
     await page.waitForFunction(v=>document.documentElement.lang===v,lang==='ar'?'en':'ar',{timeout:12000});
     await picker.selectOption(lang);
     await page.waitForFunction(v=>document.documentElement.lang===v,lang,{timeout:12000});
    }
    completed++;checks.push({tag,viewport:measurements.viewport,overflow:measurements.scroll-measurements.viewport});
   }catch(e){
    failures.push(tag+': '+String(e));
    try{await page.screenshot({path:join(artifacts,tag+'.png'),fullPage:true,timeout:8000})}catch{}
   }finally{await ctx.close()}
  }
  // The marketing motion must respect reduced-motion accessibility in every engine.
  const ctx=await browsers[spec.browser].newContext({...devices[spec.device],reducedMotion:'reduce'});
  const page=await ctx.newPage(),tag=spec.device.replaceAll(' ','-')+'-reduced-motion';
  try{
   assert.equal((await page.goto(base+'/en',{waitUntil:'domcontentloaded'}))?.status(),200);
   const pulse=page.locator('.market-motion-pulse');
   assert.equal(await pulse.count(),1);
   assert.equal(await pulse.evaluate(el=>getComputedStyle(el).animationName),'none');
   completed++;checks.push({tag,reducedMotion:true});
  }catch(e){failures.push(tag+': '+String(e))}
  finally{await ctx.close()}
 }
 writeFileSync(join(artifacts,'summary.json'),JSON.stringify({completed,failures,checks},null,2));
 console.log('NABD mobile browser engines:',JSON.stringify({passed:completed,failures:failures.length,engines:['webkit','chromium'],devices:cases.map(x=>x.name),combos:24}));
 if(failures.length)throw Error(failures.join('\n'));
}finally{
 await Promise.all(Object.values(browsers).map(browser=>browser.close()));
 await app.close();
 rmSync(temp,{recursive:true,force:true});
}
