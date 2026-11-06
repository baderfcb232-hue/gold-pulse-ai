import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../server.mjs';

const theme=readFileSync(new URL('../public/dashboard-terminal.css',import.meta.url),'utf8');
const dashboard=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');

test('visual theme is isolated from trade logic and supports responsive controls',()=>{
  assert.match(dashboard,/href="\/styles\.css\?v=stable-close-1"/);
  assert.match(dashboard,/href="\/dashboard-terminal\.css\?v=phase3-1"/);
  assert.match(theme,/--bg:#0b1015/);
  assert.match(theme,/--green:#73d7b3/);
  assert.match(theme,/--red:#fb9496/);
  assert.match(theme,/@media\(max-width:680px\)/);
  assert.match(theme,/prefers-reduced-motion:reduce/);
  assert.equal((theme.match(/\{/g)||[]).length,(theme.match(/\}/g)||[]).length);
  assert.doesNotMatch(theme,/\/api\/|OrderSend|fetch\(/);
  assert.match(dashboard,/id="market-symbols"/);
  assert.match(dashboard,/id="pause-bot"/);
  assert.match(dashboard,/id="live-chart-card"/);
});

test('terminal style only loads on /dashboard; homepage and API stay intact',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'nabd-phase3-'));
  const app=createApplication({dataDir:dir});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+app.server.address().port;
  const dash=await fetch(base+'/dashboard');
  assert.equal(dash.status,200);
  assert.match(await dash.text(),/dashboard-terminal\.css/);
  const css=await fetch(base+'/dashboard-terminal.css');
  assert.equal(css.status,200);
  assert.match(css.headers.get('content-type'),/text\/css/);
  assert.match(await css.text(),/--bg:#0b1015/);
  const home=await fetch(base+'/');
  assert.equal(home.status,200);
  assert.doesNotMatch(await home.text(),/dashboard-terminal\.css/);
  const health=await fetch(base+'/healthz');
  assert.equal((await health.json()).ok,true);
});


test('phase 3 workspace shortcuts only target existing panels and keep private account data gated',()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const css=readFileSync(new URL('../public/dashboard-terminal.css',import.meta.url),'utf8');
  assert.match(html,/class="phase3-workspace"/);
  const shortcut=html.match(/<div class="phase3-shortcuts"[\s\S]*?<\/div>/)?.[0];
  assert.ok(shortcut);
  const targets=[...shortcut.matchAll(/data-goto="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(targets,['overview','signals','positions','results','news','settings']);
  for(const target of targets) assert.ok(html.includes('data-panel="'+target+'"'),'missing panel '+target);
  assert.match(html,/href="\/account"/);
  assert.match(css,/\.phase3-shortcuts/);
  assert.match(css,/@media\(max-width:600px\)/);
  assert.doesNotMatch(shortcut,/balance|equity|password|account_number/i);
});
