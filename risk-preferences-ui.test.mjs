import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {riskPreferencePayload} from './public/risk-preferences-ui.js';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('Staged preference form converts only explicit numbers and never sends commands',()=>{
 const sample={accountId:'11111111-1111-1111-1111-111111111111',symbol:'BTCUSD',
   paused:true,riskPercent:'0.4',maxDailyLoss:'2',maxDailyTrades:'6',
   maxOpenPositions:'2',maxSpread:'80',maxSlippage:'10',quoteMaxAgeSeconds:'5'};
 const payload=riskPreferencePayload(sample);
 assert.equal(payload.riskPercent,0.4);
 assert.equal(payload.maxDailyTrades,6);
 assert.equal(payload.paused,true);
 assert.throws(()=>riskPreferencePayload({...sample,maxDailyLoss:''}));
 assert.throws(()=>riskPreferencePayload({...sample,maxDailyLoss:'NaN'}));
 const script=read('./public/risk-preferences-ui.js');
 assert.match(script,/\/api\/auth\/me/);
 assert.match(script,/\/api\/auth\/mt5-accounts/);
 assert.match(script,/\/api\/auth\/risk-preferences/);
 assert.match(script,/X-NABD-CSRF/);
 assert.doesNotMatch(script,/\/api\/commands|\/api\/bridge\/control-next|\/api\/bridge\/next/);
});
test('Staged risk UI assets are served only as preview and never claim broker pause',()=>{
 const html=read('./public/risk-control-center.html');
 const server=read('./server.mjs');
 assert.match(server,/'\/risk-preferences-ui\.js':'risk-preferences-ui\.js'/);
 assert.match(html,/id="prefs-form"/);
 assert.match(html,/not.*trading controls|لا يوقف MT5/i);
 assert.match(html,/risk-preferences-ui\.js/);
 assert.match(read('./public/risk-control-center.js'),/serverAge<=30/);
});
