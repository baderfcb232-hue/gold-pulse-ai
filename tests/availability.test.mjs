import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const workflow=readFileSync(new URL('../.github/workflows/render-availability.yml',import.meta.url),'utf8');
const script=workflow.split("python -c '\n")[1].split("\n          '")[0].split('\n').map(line=>line.slice(10)).join('\n');
const base=()=>({ok:true,accounts:{ready:true},runtimeCheckpoint:{state:'SAVED',lastSavedAt:Date.now()/1000},
  publication:{enabled:true,ready:false,reason:'WAITING_BROKER',telegram:{configured:true,verification:{canPost:true}}}});
const check=body=>spawnSync('python3',['-c',script],{input:JSON.stringify(body),encoding:'utf8'});
test('availability monitor accepts healthy services without MT5 data and a deliberately paused publisher',()=>{
  assert.equal(check(base()).status,0);
  const paused=base();paused.publication={enabled:false};assert.equal(check(paused).status,0);
});
test('HTTP success cannot mask failed accounts, stale or failed backups, or revoked Telegram permission',()=>{
  const cases=[b=>b.accounts.ready=false,b=>b.runtimeCheckpoint.state='ERROR',
    b=>b.runtimeCheckpoint.lastSavedAt-=181,b=>b.runtimeCheckpoint.lastSavedAt+=60,
    b=>b.runtimeCheckpoint.lastSavedAt=null,b=>b.publication.telegram.verification.canPost=false,
    b=>delete b.runtimeCheckpoint,b=>b.ok=false];
  for(const mutate of cases){const b=base();mutate(b);const r=check(b);assert.notEqual(r.status,0,r.stdout);}
  assert.match(workflow,/permissions: \{\}/);assert.doesNotMatch(workflow,/actions\/checkout|secrets\./);
});
