import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../server.mjs';
import {initMiniSparkline} from '../public/mini-spark.js';
const read=p=>readFileSync(new URL('../public/'+p,import.meta.url),'utf8');
test('mobile layouts keep controls reachable in both directions',()=>{
 const css=read('mobile-polish.css'),html=read('index.html');
 for(const token of ['@media(max-width:760px)','@media(max-width:420px)','grid-template-columns:minmax(0,1fr)','min-height:44px','.mini-market-chart:focus-visible','touch-action:pan-y'])
   assert.ok(css.includes(token),'missing '+token);
 assert.match(html,/mobile-polish\.css\?v=compact-20261105/);
 assert.match(html,/id="mini-market-chart" tabindex="0" role="group" aria-describedby="mini-market-hover"/);
 assert.doesNotMatch(css,/OrderSend|\/api\/|fetch\(/);
 assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length);
});
test('mini chart accepts touch press, mouse movement and keyboard without changing market data',()=>{
 const handlers={};
 const element=()=>({hidden:true,attrs:{},style:{setProperty(){}},setAttribute(k,v){this.attrs[k]=v;}});
 const line=element(),guide=element(),dot=element(),empty=element(),caption=element(),label=element(),last=element();
 const svg={getBoundingClientRect:()=>({left:0,top:0,width:320,height:100})};
 const stage={querySelector:sel=>sel==='svg'?svg:null,addEventListener:(key,fn)=>{handlers[key]=fn;}};
 const card={style:{setProperty(){} }};
 const values=new Map([['mini-market-card',card],['mini-market-chart',stage],['mini-market-line',line],['mini-market-guide',guide],['mini-market-dot',dot],['mini-market-empty',empty],['mini-market-hover',caption],['mini-market-source',label],['mini-market-last',last]]);
 const previousDocument=globalThis.document,previousWindow=globalThis.window;
 globalThis.document={documentElement:{lang:'en'}};
 globalThis.window={matchMedia:()=>({matches:false})};
 try{
  const mini=initMiniSparkline({$:id=>values.get(id),formatPrice:p=>p.toFixed(2)});
  mini.update({symbol:'XAUUSD',price:4000,time:100,source:'MT5',sourceId:'real'});
  mini.update({symbol:'XAUUSD',price:4001,time:101,source:'MT5',sourceId:'real'});
  assert.equal(typeof handlers.pointerdown,'function');
  assert.equal(typeof handlers.keydown,'function');
  handlers.pointerdown({clientX:315,pointerType:'touch'});
  assert.match(caption.textContent,/4001\.00/);
  assert.equal(dot.hidden,false);
  let prevented=0;
  handlers.keydown({key:'ArrowLeft',preventDefault(){prevented++;}});
  assert.match(caption.textContent,/4000\.00/);
  handlers.keydown({key:'ArrowRight',preventDefault(){prevented++;}});
  assert.match(caption.textContent,/4001\.00/);
  assert.equal(prevented,2);
  handlers.pointercancel({});
  assert.equal(dot.hidden,true);
  mini.update({symbol:'XAUUSD',price:9999,time:99,source:'MT5',sourceId:'real'});
  assert.equal(last.textContent,'4001.00');
 }finally{
  if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;
  if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;
 }
});
test('mobile CSS is served without changes to protected endpoints',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'nabd-mobile-'));const app=createApplication({dataDir:dir});
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;
 const r=await fetch(base+'/mobile-polish.css');assert.equal(r.status,200);
 assert.equal((await fetch(base+'/api/account')).status,401);
});
