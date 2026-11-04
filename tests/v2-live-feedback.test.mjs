import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {priceMovement,createPriceFeedback} from '../public/price-feedback.js';
import {createToastCenter} from '../public/toast-ui.js';
import {createApplication} from '../server.mjs';

const read=name=>readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
function domNode(){
  return {dataset:{},children:[],attrs:{},parentNode:null,
    setAttribute(k,v){this.attrs[k]=v;},
    append(...nodes){for(const n of nodes){n.parentNode=this;this.children.push(n);}},
    prepend(n){n.parentNode=this;this.children.unshift(n)},
    remove(){if(!this.parentNode)return;const group=this.parentNode.children;const i=group.indexOf(this);if(i>=0)group.splice(i,1);this.parentNode=null},
    get lastElementChild(){return this.children.at(-1)}
  };
}
test('source-confirmed price flash follows actual quotes; ignores stale and invented values',()=>{
 assert.equal(priceMovement(100,101),'up');
 assert.equal(priceMovement(101,100),'down');
 assert.equal(priceMovement(100,100),'none');
 assert.equal(priceMovement(null,101),'none');
 const element={animate(){this.animationCalls=(this.animationCalls||0)+1;return {cancel(){}};}};
 const root={hidden:false,getElementById:id=>id==='live-price'?element:null,documentElement:{getAttribute:()=> 'light'}};
 const feedback=createPriceFeedback({root,reducedMotion:()=>false});
 assert.equal(feedback.observe('live-price',4000,{symbol:'XAUUSD',time:100,sourceId:'broker-a'}),'none');
 assert.equal(feedback.observe('live-price',4001,{symbol:'XAUUSD',time:101,sourceId:'broker-a'}),'up');
 assert.equal(feedback.observe('live-price',3990,{symbol:'XAUUSD',time:99,sourceId:'broker-a'}),'none');
 assert.equal(feedback.observe('live-price',3999,{symbol:'XAUUSD',time:102,sourceId:'broker-a'}),'down');
 assert.equal(feedback.observe('live-price',2000,{symbol:'BTCUSD',time:102,sourceId:'broker-b'}),'none');
 assert.equal(feedback.observe('live-price',3998,{symbol:'XAUUSD',time:103,sourceId:'broker-c'}),'none');
 assert.equal(feedback.observe('live-price',3999,{symbol:'XAUUSD',time:104,sourceId:'broker-c'}),'up');
 assert.equal(feedback.observe('live-price',NaN,{symbol:'XAUUSD',time:105}),'none');
 assert.equal(element.animationCalls,3);
 const reduced=createPriceFeedback({root,reducedMotion:()=>true});
 reduced.observe('live-price',3000,{time:100});
 reduced.observe('live-price',3001,{time:101});
 assert.equal(element.animationCalls,3,'reduced motion must not animate');
});
test('toast events cap at three, dedupe for 18 seconds, and retain bounded in-session history',()=>{
 const host=domNode(),history=domNode(),factory=(tag,cls,txt)=>{const e=domNode();e.tag=tag;e.className=cls;e.textContent=txt||'';return e;};
 let clock=1000;
 const center=createToastCenter({getContainer:()=>host,getHistory:()=>history,createNode:factory,clock:()=>clock});
 assert.equal(center.push('Broker connection lost',{kind:'error',eventKey:'conn'}),true);
 assert.equal(center.push('Broker connection lost',{kind:'error',eventKey:'conn'}),false);
 clock+=18000;
 assert.equal(center.push('Broker connection lost',{kind:'error',eventKey:'conn'}),true);
 for(let i=0;i<51;i++){clock+=19000;center.push('Event '+i,{kind:'error',eventKey:'id'+i});}
 assert.equal(host.children.length,3);
 assert.equal(history.children.length,40);
 assert.equal(center.history().length,40);
 assert.equal(host.children.at(-1).dataset.kind,'error');
});
test('live toasts are only driven by observed signal and broker candle revisions',()=>{
 const live=read('live.js'),app=read('app.js'),mini=read('mini-spark.js'),style=read('live-feedback.css');
 assert.match(live,/older\?\.history_revision>0&&item.history_revision>older.history_revision/);
 assert.match(live,/item\.connection==='LIVE'&&fresh\(item\)/);
 assert.match(live,/eventKey:'signal:'/);
 assert.match(live,/priceFeedback\?\.observe/);
 assert.match(mini,/onQuote\('mini-market-last'/);
 assert.match(app,/toastCenter\.push/);
 assert.match(style,/prefers-reduced-motion:reduce/);
 assert.doesNotMatch(read('price-feedback.js'),/Math\.random|fetch\(|OrderSend/);
 assert.equal((style.match(/\{/g)||[]).length,(style.match(/\}/g)||[]).length);
});
test('site serves toast and price animations without enabling any trading action',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'nabd-motion-'));
 const app=createApplication({dataDir:dir});
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;
 const dash=await fetch(base+'/dashboard');
 assert.equal(dash.status,200);
 assert.match(await dash.text(),/live-feedback\.css\?v=v2-1/);
 for(const path of ['/toast-ui.js','/price-feedback.js','/live-feedback.css'])assert.equal((await fetch(base+path)).status,200);
 assert.equal((await fetch(base+'/api/account')).status,401);
 assert.equal((await (await fetch(base+'/healthz')).json()).ok,true);
});
