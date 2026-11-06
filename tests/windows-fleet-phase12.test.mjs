import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>readFileSync(resolve(root,path),'utf8');

test('phase 12 Python preflight runs two-tenant and tampering checks',t=>{
 const program=process.platform==='win32'?'py':'python3';
 const args=process.platform==='win32'
   ? ['-3','-m','unittest','discover','-s','windows','-p','test_mt5_fleet_preflight.py','-v']
   : ['-m','unittest','discover','-s','windows','-p','test_mt5_fleet_preflight.py','-v'];
 const res=spawnSync(program,args,{cwd:root,encoding:'utf8',timeout:20000,
   env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 if(res.error?.code==='ENOENT'){t.skip('Python is missing on this runner');return;}
 assert.equal(res.error,undefined,res.error?.message);
 assert.equal(res.status,0,String(res.stderr)+'\n'+String(res.stdout));
 assert.match(res.stderr,/Ran 7 tests/);
});

test('phase 12 Windows launcher handles read-only monitoring tokens through DPAPI only',()=>{
 const ps=read('windows/NABD-Monitor.ps1');
 const python=read('windows/nabd_mt5_fleet_preflight.py');
 const monitor=read('windows/nabd_mt5_readonly_monitor.py');
 const doc=read('WINDOWS_MT5_FLEET_PHASE12_AR.md');
 assert.match(ps,/Read-Host.*-AsSecureString/);
 assert.match(ps,/ConvertFrom-SecureString/);
 assert.match(ps,/ConvertTo-SecureString/);
 assert.match(ps,/ZeroFreeBSTR/);
 assert.match(ps,/Set-Acl/);
 assert.match(ps,/NABD_MONITOR_TOKEN/);
 assert.match(ps,/nabd_mt5_readonly_monitor\.py/);
 assert.match(python,/duplicate.*forbidden/);
 assert.match(python,/OWNER_MISMATCH/);
 assert.match(python,/tradeAllowed.*False/);
 assert.match(doc,/Windows VPS/);
 assert.match(doc,/tradeAllowed/);
 assert.match(doc,/100/);
 for(const source of [ps,python,monitor]){
  assert.doesNotMatch(source,/mt5\.(?:order_send|order_check|positions_get|history_deals_get)\s*\(/);
  assert.doesNotMatch(source,/\/api\/(?:commands|bridge\/next|signals)/);
  assert.doesNotMatch(source,/NABD_(?:GOLD|BTC)_.*AUTOTRADE/);
 }
});
