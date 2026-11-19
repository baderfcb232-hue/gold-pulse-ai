import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
test('phase14 adds dashboard reports only inside pre-existing admin-MFA guarded page',()=>{
 const html=read('./public/accounts.html'),auth=read('./auth.mjs'),server=read('./server.mjs');
 assert.match(html,/id="admin-ops-panel"/);
 assert.match(html,/id="admin-content" hidden/);
 assert.match(auth,/const adminPrincipal = path\.startsWith\('\/api\/admin\/'\) \? await authenticated\(req, req\.method === 'POST', true\)/);
 assert.match(auth,/\/api\/admin\/operations\/audit/);
 assert.match(auth,/\/api\/admin\/operations\/hosting/);
 assert.match(server,/\/admin-operations-ui\.js/);
 assert.match(server,/\/admin-operations\.css/);
});
test('phase14 exports formula-safe bounded CSV and contains no trading controls',()=>{
 const ui=read('./public/admin-operations-ui.js'),backend=read('./admin-operations.mjs');
 assert.match(ui,/\^\[\\s\\t\\r\\n\]\*\[=\+@-\]/);
 assert.match(ui,/textContent=text/);
 assert.match(ui,/credentials:'same-origin'/);
 assert.match(ui,/if\(location\.pathname==='\/admin'/);
 assert.match(backend,/verifiedBrokerConnections:null,tradeExecutionEnabled:false/);
 assert.match(backend,/LIMIT \? OFFSET \?/);
 for(const source of [ui,backend]){
   assert.doesNotMatch(source,/\/api\/(?:bridge\/next|trade\/|commands)/);
   assert.doesNotMatch(source,/order_send\(|g_trade\.Buy\(/);
 }
});
