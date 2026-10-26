import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommandTracker,commandProgress,demoExecutionMessage,commandResultMessage} from '../public/command-feedback.js';

test('double confirmation is blocked until the same command gets its terminal MT5 result',()=>{
  const t=createCommandTracker();assert.equal(t.begin('PAUSE','0',100),true);
  assert.equal(t.begin('RESUME','0',101),false);assert.equal(t.busy(),true);
  t.accepted({id:901});
  t.observe([{id:900,action:'PAUSE',ticket:'0',time:90,status:'CONFIRMED'}],103);
  assert.equal(t.get().status,'QUEUED');
  t.observe([{id:901,action:'PAUSE',ticket:'0',time:100,expires:120,status:'REJECTED',result:'Remote control not allowed'}],104);
  assert.equal(t.busy(),false);assert.equal(commandProgress(t.get(),104).result,'Remote control not allowed');
  assert.equal(t.begin('RESUME','0',105),true);
});
test('lost response is reconciled from the journal without another submission',()=>{
  const t=createCommandTracker();t.begin('PARTIAL_CLOSE','123',100);t.failed(new Error('connection lost'));
  assert.equal(t.get().status,'VERIFYING');assert.equal(t.begin('PARTIAL_CLOSE','123',102),false);
  t.observe([{id:902,action:'PARTIAL_CLOSE',ticket:'999',time:101,status:'CONFIRMED'}],103);
  assert.equal(t.get().status,'VERIFYING');
  t.observe([{id:903,action:'PARTIAL_CLOSE',ticket:'123',time:101,status:'CONFIRMED'}],104);
  assert.equal(t.get().id,903);assert.equal(t.get().status,'CONFIRMED');assert.equal(t.busy(),false);
});
test('timeout never becomes success without confirmation; expiry is reported from the server',()=>{
  const t=createCommandTracker();t.begin('CLOSE_ALL','0',100);t.failed(new Error('timeout'));
  t.observe([],110);assert.equal(t.busy(),true);
  t.observe([],126);assert.equal(t.get().status,'UNCERTAIN');
  t.begin('CLOSE_ALL','0',130);t.accepted({id:904});
  assert.match(commandProgress(t.get(),155).detail,/تحديث سجل/);assert.equal(t.busy(),true);
  t.observe([{id:904,time:130,status:'EXPIRED'}],156);
  assert.equal(t.busy(),false);assert.match(commandProgress(t.get(),156).title,/مهلة/);
});
test('HTTP rejection preserves its reason and cannot be overwritten by a similar old command',()=>{
  const t=createCommandTracker();t.begin('RESUME','0',100);t.failed({status:409,message:'local status stale'});
  t.observe([{id:905,action:'RESUME',ticket:'0',time:100,status:'CONFIRMED'}],101);
  assert.equal(t.get().status,'FAILED');assert.equal(commandProgress(t.get(),101).result,'local status stale');
  t.clear();assert.equal(t.get(),null);assert.equal(t.busy(),false);
});
test('Demo setup, pause and submission remain distinct from a confirmed trade',()=>{
  const s={execution:{demo:true,demo_recommendations:false},demoExecution:{reason:'MT5_UPDATE_REQUIRED'}};
  assert.match(demoExecutionMessage(s),/تحديث البوت/);
  s.execution.demo_recommendations=true;s.demoExecution.reason='PLAN_NOT_APPROVED';
  assert.match(demoExecutionMessage(s),/ننتظر توصية/);
  s.execution.paused=true;assert.match(demoExecutionMessage(s),/الدخول موقوف/);
  s.execution.paused=false;s.execution.demo_result='SUBMITTED';assert.match(demoExecutionMessage(s),/تأكيد الصفقة/);
});

test('a server error or invalid response cannot be mistaken for a definite rejection',()=>{
  for(const result of ['error','invalid']){
    const t=createCommandTracker();t.begin('CLOSE_ALL','0',100);
    if(result==='error')t.failed({status:500,message:'Server error'});else t.accepted({});
    assert.equal(t.get().status,'VERIFYING');assert.equal(t.begin('CLOSE_ALL','0',101),false);
    t.observe([{id:906,action:'CLOSE_ALL',ticket:'0',time:100,status:'CONFIRMED'}],102);
    assert.equal(t.get().status,'CONFIRMED');
  }
});

test('known MT5 rejection reasons are readable in Arabic and unknown details are preserved',()=>{
  assert.match(commandResultMessage('Remote control not allowed by the main EA and bridge'),/التحكم عن بُعد/);
  assert.equal(commandResultMessage('Broker retcode 10030'),'Broker retcode 10030');
  assert.match(commandResultMessage('RESUME'),/عند تحقق الشروط/);
});

test('website execution shows the actual polling channel and never treats a submitted request as a confirmed fill',()=>{
  const s={execution:{demo:true,demo_recommendations:true,website_recommendations:true},
    websiteExecution:{reason:'WAITING_WEBSITE_PLAN'},demoExecution:{reason:'WAITING_WEBSITE_PLAN'},
    reasons:['website mode','الاتجاه غير متوافق'],websiteBridge:{connection:'LIVE',lastResult:'SUBMITTED'}};
  assert.match(demoExecutionMessage(s),/يطلب توصيات الموقع فعليًا/);
  assert.match(demoExecutionMessage(s),/الاتجاه غير متوافق/);
  assert.match(demoExecutionMessage(s),/تأكيد الصفقة من Trade\/History/);
  s.websiteBridge={connection:'STALE',lastResult:'REJECTED'};
  assert.match(demoExecutionMessage(s),/توقف طلب التوصيات/);
  assert.match(demoExecutionMessage(s),/منع MT5/);
});
