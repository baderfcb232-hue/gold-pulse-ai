import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../server.mjs';

const css=readFileSync(new URL('../public/dashboard-contrast-v2.css',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const relativeLuminance=color=>{
  const rgb=color.match(/[\da-f]{2}/gi).map(v=>parseInt(v,16)/255);
  const [r,g,b]=rgb.map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);
  return .2126*r+.7152*g+.0722*b;
};
const contrast=(a,b)=>{
  const x=relativeLuminance(a),y=relativeLuminance(b);
  return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
};

test('all four notification variants have WCAG AA readable foregrounds in both themes',()=>{
  const palettes=[
    [['#FFF1F2','#991B1B'],['#ECFDF5','#065F46'],['#FFFBEB','#92400E'],['#EFF6FF','#1D4ED8']],
    [['#3A1F26','#FECACA'],['#123127','#CCFBF1'],['#3B2B12','#FDE68A'],['#172554','#DBEAFE']]
  ];
  for(const variants of palettes)for(const [background,foreground] of variants){
    assert.ok(contrast(background,foreground)>=4.5,`poor contrast ${foreground} on ${background}: ${contrast(background,foreground)}`);
    assert.ok(css.includes(background)&&css.includes(foreground),'CSS must use the tested pairing');
  }
  for(const type of ['error','success','warning'])assert.ok(css.includes('data-kind="'+type+'"'));
  assert.match(css,/\.toast-stack \.toast button:focus-visible/);
});

test('the asset is loaded last and preserves warning and live broker price distinction',()=>{
  assert.match(html,/dashboard-contrast-v2\.css\?v=20261104/);
  assert.ok(html.indexOf('dashboard-contrast-v2.css')>html.indexOf('dashboard-fixes.css'));
  for(const cls of ['.broker-quote-values>span:first-child','.broker-quote-values>span:nth-child(2)',
    '.broker-quote-values>span:nth-child(3)','.headline-source','.news-card','.broker-workspace>summary'])
    assert.ok(css.includes(cls),'Missing fix '+cls);
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.doesNotMatch(css,/OrderSend|fetch\(|\/api\/|stop_loss|MAX_RISK|InpEnableLiveTrading/);
  assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length);
});

test('production preview route serves contrast styles without changing dashboard and protected APIs',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'nabd-v2-contrast-'));
  const app=createApplication({dataDir:dir});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+app.server.address().port;
  const c=await fetch(base+'/dashboard-contrast-v2.css');
  assert.equal(c.status,200);
  assert.match(c.headers.get('content-type'),/text\/css/);
  assert.match(await c.text(),/--nabd-notice-error-bg/);
  const dash=await fetch(base+'/dashboard');
  assert.equal(dash.status,200);
  assert.match(await dash.text(),/dashboard-contrast-v2\.css/);
  assert.equal((await fetch(base+'/api/account')).status,401);
  assert.equal((await (await fetch(base+'/healthz')).json()).ok,true);
});
