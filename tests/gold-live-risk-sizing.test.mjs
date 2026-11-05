import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Execute the EA's side-effect-free arithmetic; only translate MQL type syntax.
const ea=readFileSync(new URL('../mt5/NABD_GOLD_4_01.mq5',import.meta.url),'utf8');
const start=ea.indexOf('double GOLDRiskCappedVolume(');
const end=ea.indexOf('\nbool PlaceSignal(',start);
assert.ok(start>=0 && end>start);
const fn=ea.slice(start,end).replace(/^double GOLDRiskCappedVolume/,'function GOLDRiskCappedVolume')
  .replace(/const double /g,'').replace(/\bdouble /g,'let ');
const cap=vm.runInNewContext(fn+';GOLDRiskCappedVolume',{
  MathIsValidNumber:Number.isFinite,MathFloor:Math.floor
});
test('fresh-price loss lowers automatic lot on the broker grid',()=>{
  assert.ok(Math.abs(cap(.03,15,10,.01,.01)-.02)<1e-10);
  assert.equal(cap(.01,12,10,.01,.01),0);
  assert.equal(cap(.02,8,10,.01,.01),.02);
  assert.equal(cap(.02,8,0,.01,.01),0);
  assert.equal(cap(.02,NaN,10,.01,.01),0);
  assert.equal(cap(.02,8,10,.01,0),0);
});
test('risk reduction never increases volume, exceeds budget or rounds up to minimum',()=>{
  for(const step of [.001,.01,.1,1])for(let n=1;n<=30;n++)for(let loss=1;loss<=50;loss++){
    const requested=n*step,budget=10,result=cap(requested,loss,budget,step,step);
    assert.ok(result>=0 && result<=requested);
    if(result>0){
      assert.ok(result>=step-1e-10);
      assert.ok(Math.abs(result/step-Math.round(result/step))<1e-8);
      assert.ok(loss*result/requested<=budget+1e-8);
    }
  }
});
