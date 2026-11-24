// Experimental intelligence planner. Never signs orders, generates MT5 commands or
// upgrades Binance/indicative quotes to broker evidence.
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const validTime=x=>Number.isSafeInteger(x)&&x>0;
const fail=(reasons)=>({status:'BLOCKED',reasons,plan:null,tradeAllowed:false,order:null});
const maxEvidenceItems=8;
const maxEvidenceLength=240;
const maxNarrativeLength=1000;
// Use bounded error codes; never expose raw provider messages or credentials.
export function classifyResearchFailure(error) {
 const msg=String(error?.message||'');
 if(error?.name==='TimeoutError'||error?.name==='AbortError'||msg.toLowerCase().includes('timeout'))return 'AI_REQUEST_TIMEOUT';
 if(msg==='AI_HTTP_429')return 'AI_RATE_LIMITED';
 if(/^AI_HTTP_(401|403)$/.test(msg))return 'AI_AUTH_FAILED';
 if(/^AI_HTTP_5\d\d$/.test(msg))return 'AI_PROVIDER_UNAVAILABLE';
 if(/^AI_HTTP_\d{3}$/.test(msg))return 'AI_HTTP_REJECTED';
 if(msg==='AI_INCOMPLETE_RESPONSE')return 'AI_INCOMPLETE_RESPONSE';
 if(msg==='AI_EMPTY_RESPONSE')return 'AI_EMPTY_RESPONSE';
 if(msg==='AI_PLAN_INVALID'||error instanceof SyntaxError)return 'AI_RESPONSE_INVALID';
 return 'AI_ANALYSIS_FAILED';
}
export function validateResearchContext(ctx,now){
 const reasons=[];
 if(!ctx||typeof ctx!=='object')return fail(['NO_MARKET_CONTEXT']);
 if(!['XAUUSD','BTCUSD'].includes(ctx.symbol))reasons.push('UNKNOWN_SYMBOL');
 if(ctx.feedType!=='MT5_DEMO_BROKER')reasons.push('BROKER_PRICE_SOURCE_REQUIRED');
 if(!validTime(ctx.observedAt)||!validTime(now)||ctx.observedAt>now||now-ctx.observedAt>5)
  reasons.push('BROKER_MARKET_CONTEXT_STALE');
 if(!finite(ctx.bid)||!finite(ctx.ask)||ctx.bid<=0||ctx.ask<=ctx.bid)
  reasons.push('INVALID_BID_ASK');
 if(!finite(ctx.spreadLimit)||ctx.spreadLimit<=0||
    (finite(ctx.ask)&&finite(ctx.bid)&&ctx.ask-ctx.bid>ctx.spreadLimit))
  reasons.push('BROKER_SPREAD_TOO_WIDE');
 if(!ctx.candlesVerified||!ctx.multiTimeframeVerified)reasons.push('UNVERIFIED_CHART_CONTEXT');
 if(ctx.news?.classification==='REALTIME'){
  if(!ctx.news.authorized||!ctx.news.releaseTimeVerified||
     !ctx.news.preReleaseForecastCaptured)reasons.push('UNVERIFIED_LIVE_NEWS');
 }else if(ctx.news?.classification==='DELAYED'||ctx.news?.classification==='REFERENCE')
   reasons.push('NEWS_RESEARCH_ONLY');
 if(!['DEMO','PAPER'].includes(ctx.accountType))reasons.push('EXPERIMENTAL_ACCOUNT_ONLY');
 return {status:reasons.length?'BLOCKED':'RESEARCH_CONTEXT_READY',
  reasons,tradeAllowed:false,order:null};
}
const schema={
 type:'object',additionalProperties:false,
 properties:{
  stance:{type:'string',enum:['BUY_WATCH','SELL_WATCH','WAIT']},
  confidence:{type:'number',minimum:0,maximum:1},
  thesis:{type:'string'},counterThesis:{type:'string'},
  evidence:{type:'array',items:{type:'string'}},
  invalidation:{type:'string'},riskNotes:{type:'string'},
  timeHorizonMinutes:{type:'integer',minimum:1,maximum:60}
 },
 required:['stance','confidence','thesis','counterThesis','evidence','invalidation','riskNotes','timeHorizonMinutes']
};
export function validateAnalysisPlan(plan){
 if(!plan||typeof plan!=='object'||Array.isArray(plan))throw Error('AI_PLAN_INVALID');
 if(!['BUY_WATCH','SELL_WATCH','WAIT'].includes(plan.stance)||
    !finite(plan.confidence)||plan.confidence<0||plan.confidence>1||
    !Number.isSafeInteger(plan.timeHorizonMinutes)||
    plan.timeHorizonMinutes<1||plan.timeHorizonMinutes>60||
    !Array.isArray(plan.evidence)||plan.evidence.some(e=>typeof e!=='string')||
    ['thesis','counterThesis','invalidation','riskNotes'].some(k=>typeof plan[k]!=='string'))
  throw Error('AI_PLAN_INVALID');
 return {stance:plan.stance,confidence:plan.confidence,thesis:plan.thesis.slice(0,maxNarrativeLength),
  counterThesis:plan.counterThesis.slice(0,maxNarrativeLength),
  evidence:plan.evidence.slice(0,maxEvidenceItems).map(item=>item.slice(0,maxEvidenceLength)),
  invalidation:plan.invalidation.slice(0,maxNarrativeLength),riskNotes:plan.riskNotes.slice(0,maxNarrativeLength),
  timeHorizonMinutes:plan.timeHorizonMinutes,
  executionPermission:false,signal:'WAIT'};
}
export function createResearchBrain({key,model='gpt-4.1-mini',fetcher=fetch,clock=()=>Math.floor(Date.now()/1000)}={}){
 let lastResult=null,lastError=null,lastAttempt=null,runs=0,blocked=0,busy=false;
 async function analyze(ctx){
  const readiness=validateResearchContext(ctx,clock());
  if(readiness.status!=='RESEARCH_CONTEXT_READY'){blocked++;return readiness;}
  if(!key)return fail(['AI_API_KEY_MISSING']);
  if(busy)return fail(['AI_ANALYSIS_BUSY']);
  busy=true;lastAttempt=new Date(clock()*1000).toISOString();
  try{
   const response=await fetcher('https://api.openai.com/v1/responses',{
    method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},
    body:JSON.stringify({model,store:false,max_output_tokens:900,
     instructions:'You are NABD isolated DEMO research analyst. Evaluate M5, M15, H1, H4 closed broker candles and the provided deterministic technicalEvidence, including EMA8/21/200, RSI14, ATR14 and prior structure only where actually available. When fusionEvidence is present, compare its prior-channel breakouts, Bollinger mean reversion, MACD, stochastic, Supertrend, rolling VWAP and candle structure against the trend. Treat these as advisory observations, not independent votes or execution rules; null means unavailable. Rolling VWAP is a closed-bar typical-price approximation, and BROKER_TICK_ACTIVITY_PROXY is quote activity, not actual traded volume. When fusionEvidence.adaptive is available, assess its market regime and candidate strategy as unvalidated research evidence, not a trade instruction. A breakout candidate is not confirmation; prefer evidence of a retest, consider rejected highs/lows, and identify volatility expansion or conflicting regimes. OHLC sweep proxies cannot prove actual liquidity. Explain conflicts and cite actual evidence. Do not invent missing indicators or infer upcoming economic news. Compare trend vs reversal, support/resistance, spread, counter-thesis and invalidation. If history is too short, frames conflict, spread is poor, or evidence is weak, choose WAIT. State precise evidence limitations. This is research only: no orders, lot sizing, execution permissions, claims of guaranteed outcomes or profits.',
     input:JSON.stringify(ctx),
     text:{format:{type:'json_schema',name:'isolated_nabd_research_plan',strict:true,schema}}}),
    // Allow bounded provider latency; the independent intent gate still revalidates broker quote and bar.
    signal:AbortSignal.timeout(40000)
   });
   if(!response.ok)throw Error('AI_HTTP_'+response.status);
   const envelope=await response.json();
   if(envelope.status!=='completed')throw Error('AI_INCOMPLETE_RESPONSE');
   const text=envelope.output?.flatMap(x=>x.content||[]).filter(x=>x.type==='output_text')
     .map(x=>x.text).join('');
   if(!text||text.length>10000)throw Error('AI_EMPTY_RESPONSE');
   const plan=validateAnalysisPlan(JSON.parse(text));
   runs++;lastResult={time:lastAttempt,symbol:ctx.symbol,stance:plan.stance,
     confidence:plan.confidence,executionPermission:false};
   lastError=null;
   return {status:'RESEARCH_ANALYSIS_ONLY',plan,tradeAllowed:false,order:null};
  }catch(e){const reason=classifyResearchFailure(e);lastError=reason;blocked++;return fail([reason]);}
  finally{busy=false;}
 }
 return {analyze,report:()=>({status:key?'READY_FOR_VERIFIED_DEMO_CONTEXT':'NOT_CONFIGURED',
  runs,blocked,lastAttempt,lastError,lastResult,executionPermission:false,
  signal:'WAIT',orderRoutesAvailable:false})};
}
