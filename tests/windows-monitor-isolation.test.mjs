import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>readFileSync(resolve(root,path),'utf8');

test('Windows Demo monitor refuses shared terminal folders and implicit default MT5 profiles',()=>{
 const guard=read('windows/nabd_mt5_instance_guard.py');
 const worker=read('windows/nabd_mt5_readonly_monitor.py');
 assert.match(guard,/O_CREAT \| os\.O_EXCL/);
 assert.match(guard,/msvcrt\.LK_NBLCK/);
 assert.match(guard,/def bind_identity\(/);
 assert.match(guard,/terminal_directory/);
 assert.match(guard,/def terminal_profile_matches\(/);
 assert.match(worker,/InstanceLease\(TERMINAL_PATH, identity\)/);
 assert.match(worker,/terminal_profile_matches\(terminal, TERMINAL_PATH\)/);
 assert.match(worker,/mt5\.initialize\(path=TERMINAL_PATH, portable=True/);
 assert.match(worker,/mt5\.shutdown\(\)/);
 assert.match(worker,/lease\.release\(\)/);
 assert.match(worker,/exc\.code in \(401, 403, 409\)/);
 for(const content of [worker,guard]){
  assert.doesNotMatch(content,/mt5\.(?:order_send|order_check|positions_get|history_deals_get)\s*\(/);
  assert.doesNotMatch(content,/\/api\/(?:commands|bridge\/next|risk-settings|signals)/);
  assert.doesNotMatch(content,/password\s*=\s*["']/i);
 }
});

test('Python isolation unit tests reject two account IDs sharing one MT5 executable',t=>{
 const program=process.platform==='win32'?'py':'python3';
 const result=spawnSync(program,['-m','unittest','discover','-s','windows',
    '-p','test_mt5_instance_guard.py','-v'],{
   cwd:root,encoding:'utf8',timeout:20000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}
 });
 if(result.error?.code==='ENOENT'){t.skip('Python is not installed in this CI environment');return;}
 assert.equal(result.error,undefined,result.error?.message);
 assert.equal(result.status,0,String(result.stdout)+'\n'+String(result.stderr));
 assert.match(result.stderr,/Ran 6 tests/);
});

test('Windows deployment remains explicit operator-controlled read-only Demo',()=>{
 const guide=read('WINDOWS_MT5_MULTI_INSTANCE_ISOLATION_AR.md');
 assert.match(guide,/JustMarkets Demo/);
 assert.match(guide,/terminal64\.exe/);
 assert.match(guide,/\/portable/);
 assert.match(guide,/NABD_MONITOR_TOKEN/);
 assert.match(guide,/Windows VPS/);
 assert.match(guide,/tradeAllowed=false/);
 assert.match(guide,/لا.*كلمة مرور/);
});
