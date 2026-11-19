import test from 'node:test';
import assert from 'node:assert/strict';
import {createResearchBrain} from './research-brain.mjs';
import {validateHistoricalResearchContext} from './historical-replay-context.mjs';
import {validateResearchContext} from './research-brain.mjs';
import {buildHistoricalBrainContext,replayHistoricalAgentic,
 validateHistoricalReplayDataset} from './agentic-historical-lab.mjs';

const END=1800000000;
function makeBars(count,seconds){
 return Array.from({length:count},(_,i)=>{
  const p=3900+i*.025+Math.sin(i/11)*.32;
  return {time:END-(count-i)*seconds,open:p,
   high:p+.5,low:p-.5,close:p+.05,tick_volume:30};
 });
}
function history(symbol='XAUUSD'){
 return {symbol,broker_symbol:symbol+'.m',
  provenance:{format:'MT5_HISTORY_EXPORT',broker:'JustMarkets',
   server:'JustMarkets-Demo2',exportedAt:END+10},
  spec:{point:0.01,tick_size:0.01,tick_value_loss:.1},
  spread_points:14,slippage_points:3,commission_per_lot:7,
  candles:{M5:makeBars(1350,300),M15:makeBars(900,900),
   H1:makeBars(400,3600),H4:makeBars(300,14400)}};
}
const plan={
 stance:'BUY_WATCH',confidence:.64,
 thesis:'Closed candles show a hypothetical upward structure',
 counterThesis:'Momentum could reverse at resistance',
 evidence:['Only as-of broker-export candle features are supplied'],
 invalidation:'Price loses support',riskNotes:'Costs and gaps may invalidate',
 timeHorizonMinutes:15
};
function response(){
 return {ok:true,json:async()=>({status:'completed',
  output:[{content:[{type:'output_text',text:JSON.stringify(plan)}]}]})};
}

test('historical brain uses EXACT nonexecuting research model in explicit PAPER mode',async()=>{
 const data=history(),idx=1100,at=data.candles.M5[idx].time+300;
 const ctx=buildHistoricalBrainContext(data,at);
 assert.equal(ctx.feedType,'MT5_HISTORICAL_PAPER_REPLAY');
 assert.equal(ctx.news.classification,'NONE');
 assert.equal(ctx.priceKind,'MODELED_FROM_CLOSED_M5');
 assert.equal(validateHistoricalResearchContext(ctx,at).status,'RESEARCH_CONTEXT_READY');
 assert.equal(validateResearchContext(ctx,at).status,'BLOCKED');
 for(const [tf,seconds] of Object.entries({M5:300,M15:900,H1:3600,H4:14400}))
  assert.ok(ctx['candles'+tf].every(bar=>bar.time+seconds<=at));
 assert.equal(ctx.technicalEvidence.M5.ema200Verified,true);
 let calls=0;
 const brain=createResearchBrain({key:'local-mock-only',clock:()=>at,
  contextMode:'HISTORICAL_PAPER',fetcher:async(_url,options)=>{
   calls++;
   const sent=JSON.parse(JSON.parse(options.body).input);
   assert.equal(sent.observedAt,at);
   assert.equal(sent.news.classification,'NONE');
   assert.equal(JSON.parse(options.body).store,false);
   return response();
  }});
 const r=await brain.analyze(ctx);
 assert.equal(calls,1);
 assert.equal(r.status,'RESEARCH_ANALYSIS_ONLY');
 assert.equal(r.plan.stance,'BUY_WATCH');
 assert.equal(r.plan.executionPermission,false);
 assert.equal(r.plan.signal,'WAIT');
 assert.equal(r.tradeAllowed,false);
 assert.equal(r.order,null);
 // Live API mode is unchanged: cannot reuse historical PAPER for a live trade.
 let unexpected=0;
 const live=createResearchBrain({key:'test',clock:()=>at,fetcher:async()=>{unexpected++;return response();}});
 const rejected=await live.analyze(ctx);
 assert.equal(rejected.status,'BLOCKED');
 assert.equal(unexpected,0);
});
test('future candles do not influence as-of AI context; future news/live account fail closed',()=>{
 const ds=history(),at=ds.candles.M5[900].time+300;
 const before=buildHistoricalBrainContext(ds,at);
 // Modify only price bars strictly AFTER as-of, retaining valid OHLC.
 const future=ds.candles.M5[1150];
 future.open+=400;future.high+=400;future.low+=400;future.close+=400;
 assert.deepEqual(buildHistoricalBrainContext(ds,at),before);
 const tampered={...before,
  candlesM5:[...before.candlesM5,{...before.candlesM5.at(-1),time:at}]};
 assert.equal(validateHistoricalResearchContext(tampered,at).status,'BLOCKED');
 assert.ok(validateHistoricalResearchContext({...before,news:{classification:'REALTIME'}},at).reasons.includes('PAPER_NO_NEWS_ONLY'));
 assert.ok(validateHistoricalResearchContext({...before,accountType:'LIVE'},at).reasons.includes('PAPER_NO_NEWS_ONLY'));
 assert.ok(validateHistoricalResearchContext({...before,observedAt:at+300},at).reasons.includes('HISTORICAL_CLOCK_MISMATCH'));
 assert.throws(()=>buildHistoricalBrainContext(ds,at+150),/NOT_A_M5_CANDLE_CLOSE/);
});
test('paper replay defaults to ZERO model requests and never claims orders or guaranteed PnL',async()=>{
 const ds=history('BTCUSD');
 const report=await replayHistoricalAgentic(ds,{folds:3,maxCalls:9,runModel:false});
 assert.equal(report.kind,'NABD_AGENTIC_HISTORICAL_PAPER_DIAGNOSTIC_V1');
 assert.equal(report.brain.actualModelInvoked,false);
 assert.equal(report.brain.invocationCount,0);
 assert.equal(report.samples.length,9);
 assert.equal(report.folds.length,3);
 assert.equal(report.executionPermission,false);
 assert.equal(report.tradingEnabled,false);
 assert.equal(report.autoApproveStrategy,false);
 assert.ok(report.samples.every(x=>x.stance==='WAIT'&&x.order===null&&x.executionAllowed===false));
 assert.ok(report.samples.every(x=>x.contextSha256?.length===64));
 assert.ok(report.samples.every(x=>x.blockedReason==='MODEL_NOT_RUN_OPT_IN_REQUIRED'));
 assert.ok(report.warnings.some(x=>x.includes('post-period knowledge')));
 const periods=report.folds;
 for(let i=1;i<periods.length;i++)
  assert.ok(periods[i-1].evaluationTo<periods[i].evaluationFrom);
});
test('bounded opt-in calls route through real brain schema and produce audited hypothetical outcomes',async()=>{
 const ds=history(),packets=[];
 const report=await replayHistoricalAgentic(ds,{
  runModel:true,key:'mock-only',maxCalls:6,folds:3,
  fetcher:async(_url,opts)=>{
   const packet=JSON.parse(opts.body),ctx=JSON.parse(packet.input);
   packets.push(ctx);
   assert.equal(packet.store,false);
   assert.equal(ctx.accountType,'PAPER');
   assert.equal(ctx.news.classification,'NONE');
   for(const [tf,seconds] of Object.entries({M5:300,M15:900,H1:3600,H4:14400}))
    assert.ok(ctx['candles'+tf].every(bar=>bar.time+seconds<=ctx.observedAt));
   return response();
  }});
 assert.equal(packets.length,6);
 assert.equal(report.brain.invocationCount,6);
 assert.equal(report.folds.reduce((n,x)=>n+x.modelCompleted,0),6);
 assert.equal(report.samples.filter(x=>x.stance==='BUY_WATCH').length,6);
 assert.ok(report.samples.every(x=>x.forward?.executed===false&&x.order===null));
 assert.ok(report.samples.every(x=>x.forward?.brokerFillConfirmed===false));
 assert.ok(report.folds.every(x=>x.directionalHypotheses===2));
 assert.ok(report.folds.every(x=>x.modeledFavorableShare!=null));
 assert.throws(()=>createResearchBrain({contextMode:'SNEAK_LIVE'}),/UNSUPPORTED_BRAIN_CONTEXT_MODE/);
});
test('invalid data, missing paid key, runaway sample budget are rejected',async()=>{
 const ds=history();
 assert.equal(validateHistoricalReplayDataset(ds).provenance,'USER_DECLARED_UNVERIFIED');
 await assert.rejects(()=>replayHistoricalAgentic(ds,{runModel:true}),/AI model key/);
 await assert.rejects(()=>replayHistoricalAgentic(ds,{maxCalls:1000}),/safe limits/);
 await assert.rejects(()=>replayHistoricalAgentic(ds,{folds:1}),/safe limits/);
 let altered=history();
 altered.candles.H1[10].time=altered.candles.H1[9].time;
 await assert.rejects(()=>replayHistoricalAgentic(altered),/non-ascending/);
 altered=history();altered.provenance.broker='synthetic fixture';
 await assert.rejects(()=>replayHistoricalAgentic(altered),/broker export/);
 altered=history();altered.spec.tick_value_loss=0;
 await assert.rejects(()=>replayHistoricalAgentic(altered),/tick value/);
});
