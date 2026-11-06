import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {explainNabdRecommendation,safeExecutionStatus,EXPLAINER_SYMBOLS,EXPLAINER_QUESTIONS} from '../public/recommendation-explainer.js';
import {linkExecutionTrace,describeEaRejection,recommendationCode} from '../execution-trace.mjs';

const NOW=1793980800;
const m=(symbol='XAUUSD',overrides={})=>({
 symbol,connection:'LIVE',candle_kind:'BROKER_OHLC',received_at:NOW-3,quoteTtl:20,
 quote:{time:NOW-3,price:2000},
 analysis:{status:'SCANNING',reason_label:'FUSION: M15/H1 trend mismatch',
  score:82,checks:[{name:'EMA agreement',pass:false},{name:'Spread',pass:true}],
  entrySafetyChecks:[{name:'Stop distance',pass:false}],
  readinessChecks:[{name:'Broker candle freshness',pass:true}],
  frames:{M15:{direction:'BUY'},H1:{direction:'SELL'}}},
 ...overrides
});
const explain=(opts={})=>explainNabdRecommendation({
 symbol:'XAUUSD',question:'WHY',market:m(),serverTime:NOW,now:NOW,locale:'en',
 ...opts
});
test('Phase 9 explanation stays tied to current broker facts and does not issue new signals',()=>{
 const why=explain();
 assert.equal(why.fresh,true);
 assert.match(why.lines.join(' '),/FUSION: M15\/H1 trend mismatch/);
 assert.match(why.lines.join(' '),/MT5 broker candles/);
 assert.match(why.lines.join(' '),/No confirmed new published signal/);
 assert.equal(why.chart,'/charts/gold');
 const btc=explain({symbol:'BTCUSD',market:m('BTCUSD')});
 assert.equal(btc.chart,'/charts/bitcoin');
 assert.deepEqual(EXPLAINER_SYMBOLS,['XAUUSD','BTCUSD']);
 assert.deepEqual(EXPLAINER_QUESTIONS,['WHY','CHECKS','EXECUTION']);
});
test('question about conditions shows real gate failure, not a profit probability',()=>{
 const result=explain({question:'CHECKS'});
 assert.ok(result.lines.some(x=>x.includes('M15: BUY')&&x.includes('H1: SELL')));
 assert.ok(result.lines.some(x=>x.includes('82/100')&&x.includes('not profit probability')));
 assert.ok(result.lines.some(x=>x.includes('Stop distance')));
 assert.ok(result.lines.some(x=>x.includes('EMA agreement')));
});
test('stale quote cannot masquerade as current analysis or a new recommendation',()=>{
 const stale=explain({market:m('XAUUSD',{quote:{time:NOW-400,price:2000},
  analysis:{status:'READY',score:100,reason_label:'All gates pass',checks:[{name:'EMA',pass:true}]}})});
 assert.equal(stale.fresh,false);
 assert.doesNotMatch(stale.lines.join(' '),/All gates pass|100\/100/);
 assert.match(stale.lines.join(' '),/stale/);
 const missing=explain({market:null});
 assert.match(missing.lines.join(' '),/Waiting/);
});
test('unverified execution status is explicit even if order is SUBMITTED, FILLED without a deal, or absent',()=>{
 assert.equal(safeExecutionStatus(null,'en').confirmed,false);
 assert.equal(safeExecutionStatus({execution_trace:{status:'SUBMITTED',broker_deal_ticket:'8888'}},'en').confirmed,false);
 assert.equal(safeExecutionStatus({execution_trace:{status:'FILLED',broker_fill_confirmed:false,broker_deal_ticket:'8888'}},'en').confirmed,false);
 assert.equal(safeExecutionStatus({execution_trace:{status:'FILLED',broker_fill_confirmed:true,broker_deal_ticket:'bad'}},'en').confirmed,false);
 const confirmed=safeExecutionStatus({execution_trace:{status:'FILLED',broker_fill_confirmed:true,broker_deal_ticket:'12345'}},'en');
 assert.equal(confirmed.confirmed,true);
 assert.match(confirmed.message,/12345/);
 const reject=safeExecutionStatus({execution_trace:{status:'REJECTED',reason:'Volume rejected by broker'}},'ar');
 assert.match(reject.message,/رفض MT5/);
});
test('member-only recommendations and latest broker trace are not simulated as confirmed deals',()=>{
 const published={id:'gold-plan-1',symbol:'XAUUSD',issued_at:NOW-12,side:'BUY',
  recommendation_code:'AB12CD34EF56',status:'TRACKING'};
 const pending=explain({question:'EXECUTION',signals:[published],market:null});
 assert.match(pending.lines.join(' '),/AB12CD34EF56/);
 assert.match(pending.lines.join(' '),/No confirmed execution record/);
 assert.doesNotMatch(pending.lines.join(' '),/Broker fill confirmed/);
 const unknown=explain({question:'EXECUTION',signals:null});
 assert.match(unknown.lines.join(' '),/history unavailable/);
 const mixed=explain({question:'EXECUTION',signals:[{...published,symbol:'BTCUSD'},published]});
 assert.match(mixed.lines.join(' '),/AB12CD34EF56/);
});
test('phase 9 UI reuses market SSE and existing member-gated signals without new trading API',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 const html=read('public/index.html'),js=read('public/recommendation-explainer.js');
 const app=read('public/app.js'),live=read('public/live.js'),css=read('public/recommendation-explainer.css'),server=read('server.mjs');
 assert.match(html,/id="recommendation-explainer"/);
 assert.match(html,/recommendation-explainer\.css\?v=phase9-1/);
 assert.match(html,/recommendations=phase9-1/);
 assert.match(app,/initRecommendationExplainer\(\)/);
 assert.match(app,/recommendationAssistant\.updateSignals\(signals\)/);
 assert.match(app,/recommendationAssistant\.updateSignals\(null\)/);
 assert.match(app,/onMarket:market=>recommendationAssistant\.updateMarket\(market\)/);
 assert.match(live,/onMarket\(next\)/);
 assert.match(app,/safeExecutionStatus\(s,currentLocale\(\)\)/);
 assert.match(app,/signal-context-link/);
 assert.match(server,/'\/recommendation-explainer\.js':'recommendation-explainer\.js'/);
 assert.match(server,/'\/recommendation-explainer\.css':'recommendation-explainer\.css'/);
 assert.match(css,/@media\(max-width:680px\)/);
 assert.match(js,/nabd:language-change/);
 assert.doesNotMatch(js,/\/api\/commands|OrderSend|\/api\/bridge\/next|\/api\/risk-settings|eval\(/);
});

test('actual logged MT5 rejection code 109 is reported as daily-loss guard, never as a fill',()=>{
 const plan={id:'example-plan-id',symbol:'XAUUSD',source:'MT5 · JustMarkets',side:'BUY',
  issued_at:NOW-20,expires_at:NOW+60,status:'TRACKING'};
 const record={plan_id:plan.id,symbol:plan.symbol,status:'REJECTED',reason_code:109,time:NOW-1};
 const [traced]=linkExecutionTrace([plan],[record],[],{});
 assert.equal(traced.execution_trace.status,'REJECTED');
 assert.equal(traced.execution_trace.broker_fill_confirmed,false);
 assert.equal(traced.execution_trace.broker_deal_ticket,null);
 assert.match(describeEaRejection(109),/بلوغ حد الخسارة اليومية/);
 const shown=safeExecutionStatus(traced,'ar');
 assert.equal(shown.confirmed,false);
 assert.match(shown.message,/بلوغ حد الخسارة اليومية/);
 const display=explainNabdRecommendation({symbol:'XAUUSD',question:'EXECUTION',signals:[traced],
  market:null,locale:'ar',now:NOW});
 assert.ok(display.lines.some(s=>s.includes('بلوغ حد الخسارة اليومية')));
 assert.ok(display.lines.some(s=>s.includes(recommendationCode(plan.id))));
});
test('broker deal ticket can be a verified string or safe number but never a rounded unsafe number',()=>{
 const make=ticket=>({execution_trace:{
  status:'FILLED',broker_fill_confirmed:true,broker_deal_ticket:ticket
 }});
 const digits=1212470004550;
 assert.equal(safeExecutionStatus(make(digits),'ar').confirmed,true);
 assert.match(safeExecutionStatus(make(digits),'en').message,/1212470004550/);
 assert.equal(safeExecutionStatus(make(String(digits)),'en').confirmed,true);
 assert.equal(safeExecutionStatus(make(Number.MAX_SAFE_INTEGER+10),'en').confirmed,false);
 assert.equal(safeExecutionStatus(make('NaN'),'en').confirmed,false);
 assert.equal(safeExecutionStatus(make(0),'en').confirmed,false);
 assert.equal(safeExecutionStatus(make(null),'en').confirmed,false);
});
test('reference market and access-restricted member data are explicitly not MT5 execution proof',()=>{
 const plan={id:'btc-sample',symbol:'BTCUSD',issued_at:NOW-8,
  source:'Coinbase · BTC-USD',side:'BUY',status:'TRACKING'};
 const display=explainNabdRecommendation({symbol:'BTCUSD',question:'EXECUTION',
  signals:[plan],locale:'en',now:NOW});
 assert.ok(display.lines.some(s=>s.includes('reference signal')));
 assert.ok(display.lines.every(s=>!s.includes('Broker fill confirmed')));
 const restricted=explainNabdRecommendation({symbol:'BTCUSD',question:'EXECUTION',
  signals:[{...plan,source:'MT5_EA'}],locale:'en',now:NOW});
 assert.ok(restricted.lines.some(s=>s.includes('operator verification')));
});
