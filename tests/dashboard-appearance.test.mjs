import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {createApplication} from '../server.mjs';

const source=readFileSync(new URL('../public/ui-theme.js',import.meta.url),'utf8');
const theme=readFileSync(new URL('../public/dashboard-premium.css',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');

test('dashboard defaults to accessible light, supports dark and automatic mode',()=>{
  assert.match(html,/src="\/ui-theme\.js\?v=20261104-1"/);
  assert.match(html,/href="\/dashboard-premium\.css\?v=20261104-1"/);
  assert.match(html,/id="theme-select"/);
  assert.match(html,/<option value="auto">حسب الجهاز/);
  assert.match(theme,/:root:not\(\[data-theme="dark"\]\)/);
  assert.match(theme,/html\[data-theme="dark"\]/);
  assert.match(theme,/--bg:#F8FAFC/);
  assert.match(theme,/--bg:#0B1220/);
  assert.match(theme,/\.card/);
  assert.match(theme,/@media\(max-width:470px\)/);
  assert.match(theme,/prefers-reduced-motion:reduce/);
  assert.doesNotMatch(source,/\/api\/|fetch\(|OrderSend|\.submit\(/);
  assert.equal((theme.match(/\{/g)||[]).length,(theme.match(/\}/g)||[]).length);
});

function simulation(saved){
  let ready, onChange, mediaChange, persisted=null;
  const root={dataset:{},style:{}};
  const color={content:'',setAttribute(name,value){if(name==='content')this.content=value;}};
  const select={value:'light',addEventListener(name,cb){if(name==='change')onChange=cb;}};
  const doc={
    readyState:'loading',documentElement:root,
    addEventListener(name,cb){if(name==='DOMContentLoaded')ready=cb;},
    getElementById(id){return id==='theme-select'?select:null;},
    querySelector(name){return name==='meta[name="theme-color"]'?color:null;}
  };
  const m={matches:true,addEventListener(name,cb){mediaChange=cb;}};
  const win={matchMedia:()=>m,localStorage:{getItem:()=>saved,setItem:(k,v)=>{persisted=v;}}};
  vm.runInNewContext(source,{document:doc,window:win});
  ready();
  return{root,color,select,choose:(v)=>{select.value=v;onChange();},media:(v)=>{m.matches=v;mediaChange();},getPersisted:()=>persisted};
}
test('default light is safe; selection persists and auto responds to device settings',()=>{
  const ui=simulation(null);
  assert.equal(ui.root.dataset.theme,'light');
  assert.equal(ui.select.value,'light');
  ui.choose('dark');
  assert.equal(ui.root.dataset.theme,'dark');
  assert.equal(ui.getPersisted(),'dark');
  assert.equal(ui.color.content,'#0B1220');
  ui.choose('auto');
  assert.equal(ui.root.dataset.theme,'dark');
  ui.media(false);
  assert.equal(ui.root.dataset.theme,'light');
  assert.equal(ui.getPersisted(),'auto');
  assert.equal(simulation('dark').root.dataset.theme,'dark');
  assert.equal(simulation('garbage').root.dataset.theme,'light');
});
test('appearance endpoints are static; market and execution API paths preserved',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'nabd-ui-theme-'));
  const app=createApplication({dataDir:dir});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+app.server.address().port;
  for(const p of ['/dashboard-premium.css','/ui-theme.js']){
    const r=await fetch(base+p);assert.equal(r.status,200);
    assert.match(r.headers.get('content-type'),p.endsWith('.js')?/text\/javascript/:/text\/css/);
  }
  const dashboard=await fetch(base+'/dashboard');
  assert.equal(dashboard.status,200);assert.match(await dashboard.text(),/id="theme-select"/);
  const welcome=await fetch(base+'/');
  assert.equal(welcome.status,200);assert.doesNotMatch(await welcome.text(),/dashboard-premium/);
  const health=await fetch(base+'/healthz');
  assert.equal(health.status,200);assert.equal((await health.json()).ok,true);
});
