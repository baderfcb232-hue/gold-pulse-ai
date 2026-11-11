// Experimental intelligence planner. Never signs orders, generates MT5 commands or
// upgrades Binance/indicative quotes to broker evidence.
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const validTime=x=>Number.isSafeInteger(x)&&x>0;
const fail=(reasons)=>({status:'BLOCKED',reasons,plan:null,tradeAllowed:false,order:null});
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
    !Array.isArray(plan.evidence)||plan.evidence.length>8||
    plan.evidence.some(e=>typeof e!=='string'||e.length>240)||
    ['thesis','counterThesis','invalidation','riskNotes'].some(k=>typeof plan[k]!=='string'||
      plan[k].length>1000))throw Error('AI_PLAN_INVALID');
 return {stance:plan.stance,confidence:plan.confidence,thesis:plan.thesis,
  counterThesis:plan.counterThesis,evidence:plan.evidence,
  invalidation:plan.invalidation,riskNotes:plan.riskNotes,
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
    body:JSON.stringify({model,store:false,max_output_tokens:450,
     instructions:'Research only. Read broker DEMO market context as evidence. Explain a hypothesis, an opposing hypothesis, risks and invalidation. If uncertain choose WAIT. No orders, no execution, no promises of profits.',
     input:JSON.stringify(ctx),
     text:{format:{type:'json_schema',name:'isolated_nabd_research_plan',strict:true,schema}}}),
    signal:AbortSignal.timeout(25000)
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
  }catch(e){lastError=String(e.message||e).slice(0,80);return fail(['AI_ANALYSIS_FAILED']);}
  finally{busy=false;}
 }
 return {analyze,report:()=>({status:key?'READY_FOR_VERIFIED_DEMO_CONTEXT':'NOT_CONFIGURED',
  runs,blocked,lastAttempt,lastError,lastResult,executionPermission:false,
  signal:'WAIT',orderRoutesAvailable:false})};
}
