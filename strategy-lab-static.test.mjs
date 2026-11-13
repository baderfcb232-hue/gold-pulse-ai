import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
test('Strategy Lab is separate from trading, has a local report viewer and no network uploads',()=>{
 const html=read('./public/strategy-lab.html'),ui=read('./public/strategy-lab-ui.js'),
  api=read('./server.mjs'),engine=read('./strategy-lab.mjs');
 assert.match(html,/id="lab-file"/);
 assert.match(html,/id="lab-comparison"/);
 assert.match(html,/type="file"/);
 assert.match(ui,/entry\.text\(\)/);
 assert.match(ui,/textContent=text/);
 assert.doesNotMatch(ui,/\bfetch\(|XMLHttpRequest|WebSocket|localStorage/);
 assert.doesNotMatch(engine,/order_send|\/api\/bridge|telegram|mt5\.(?:Buy|Sell)/i);
 assert.match(api,/'\/strategy-lab':'strategy-lab\.html'/);
 assert.match(api,/'\/strategy-lab-ui\.js':'strategy-lab-ui\.js'/);
});
test('Engine uses forward-only closed-bar cursors, and CLI saves without overwriting reports',()=>{
 const backtest=read('./backtest.mjs'),cli=read('./strategy-lab-cli.mjs');
 assert.match(backtest,/historyCursor/);
 assert.match(backtest,/rows\[cursor\]\.time\+step<=at/);
 assert.match(cli,/flag:'wx'/);
 assert.match(cli,/createHash\('sha256'\)/);
 assert.doesNotMatch(cli,/WebRequest|order_send|\bfetch\(/);
});
