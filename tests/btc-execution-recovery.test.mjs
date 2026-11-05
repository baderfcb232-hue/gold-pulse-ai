import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const ea=readFileSync(new URL('../mt5/NABD_BTC_FUSION_V2_4_04_Demo.mq5',import.meta.url),'utf8');
test('BTC 4.04 polls approvals after successful quick tick and refreshes closed-bar history',()=>{
  assert.match(ea,/#property version\s+"4\.04"/);
  const start=ea.indexOf('if(btcOneSecond && g_nb_bootstrap_done && lastBtcFullSend>0');
  const end=ea.indexOf('if(btcOneSecond)lastBtcFullSend=now;',start);
  const quick=ea.slice(start,end);
  assert.match(quick,/NBSendBtcFastQuote\(tick,offset\) && InpNABDAllowRemoteControl/);
  assert.match(quick,/NBProcessWebsiteRecommendation\(\)/);
  assert.match(quick,/iTime\(g_symbol,PERIOD_M5,1\)==lastBtcFullClosedBar/);
  assert.match(ea,/latestClosedBar!=cachedBtcClosedBar/);
  for(const code of [125,126,127,128,129])assert.ok(ea.includes('safety_code='+code));
  assert.ok(ea.includes('SL_loss=%.2f,risk_budget=%.2f'));
  assert.equal(ea.split('{').length,ea.split('}').length);
});
test('BTC fresh-price lot arithmetic stays within budget and refuses an unfundable minimum',()=>{
  const start=ea.indexOf('double BTCRiskCappedVolume('),end=ea.indexOf('\nbool PlaceSignal(',start);
  const fn=ea.slice(start,end).replace(/^double BTCRiskCappedVolume/,'function BTCRiskCappedVolume')
    .replace(/const double /g,'').replace(/\bdouble /g,'let ');
  const cap=vm.runInNewContext(fn+';BTCRiskCappedVolume',{
    MathIsValidNumber:Number.isFinite,MathFloor:Math.floor});
  assert.ok(Math.abs(cap(.03,15,10,.01,.01)-.02)<1e-10);
  assert.equal(cap(.01,12,10,.01,.01),0);
  for(let n=1;n<50;n++)for(let loss=1;loss<100;loss++){
    const requested=n*.01,v=cap(requested,loss,10,.01,.01);
    assert.ok(v>=0 && v<=requested);
    if(v)assert.ok(loss*v/requested<=10+1e-8);
  }
});
