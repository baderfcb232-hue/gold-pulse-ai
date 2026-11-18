// Phase15 local-only historical AI replay CLI. NEVER accesses MT5, production
// Render, trading bridge or Telegram. Default is zero billable AI requests.
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {replayHistoricalAgentic} from './agentic-historical-lab.mjs';
const args=process.argv.slice(2);
const known=new Set(['--input','--output','--from','--to','--max-ai-calls',
 '--folds','--run-ai-with-cost','--model']);
function value(name){const pos=args.indexOf(name);return pos<0?undefined:args[pos+1];}
function date(raw){
 if(raw==null)return undefined;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))throw Error('UTC dates must be YYYY-MM-DD');
 const t=Date.parse(raw+'T00:00:00Z');
 if(!Number.isFinite(t)||new Date(t).toISOString().slice(0,10)!==raw)
   throw Error('Invalid UTC date');
 return t/1000;
}
try{
 for(let i=0;i<args.length;i++){
  if(!known.has(args[i]))throw Error('Unknown argument: '+args[i]);
  if(args[i]==='--run-ai-with-cost')continue;
  if(i+1>=args.length||args[i+1].startsWith('--'))throw Error('Value missing for '+args[i]);
  i++;
 }
 const input=value('--input'),output=value('--output');
 if(!input||!output||input===output||!output.toLowerCase().endsWith('.json'))
  throw Error('Usage: node agentic-experimental/agentic-historical-cli.mjs --input mt5-two-years.json --output ai-replay.json [--from YYYY-MM-DD --to YYYY-MM-DD --folds 3 --max-ai-calls 12] [--run-ai-with-cost]');
 if(statSync(input).size>200*1024*1024)throw Error('History input exceeds 200MB');
 const raw=readFileSync(input,'utf8');
 const model=value('--model')||'gpt-4.1-mini';
 if(!/^[a-z][a-z0-9_.-]{0,62}$/i.test(model))throw Error('Invalid model identifier');
 const runModel=args.includes('--run-ai-with-cost');
 const key=runModel?process.env.NABD_TEST_REPLAY_AI_KEY||'':'';
 if(runModel&&!key)throw Error('NABD_TEST_REPLAY_AI_KEY required for explicitly approved billable analysis');
 const report=await replayHistoricalAgentic(JSON.parse(raw),{
  from:date(value('--from')),to:date(value('--to')),
  folds:value('--folds')==null?3:Number(value('--folds')),
  maxCalls:value('--max-ai-calls')==null?12:Number(value('--max-ai-calls')),
  runModel,key,model
 });
 report.inputSha256=createHash('sha256').update(raw).digest('hex');
 report.createdAt=new Date().toISOString();
 report.note='Research-only retrospective AI diagnostic. No broker trades, actual realized PnL, training or verified future prediction.';
 writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({output,completed:report.brain.invocationCount,
  samples:report.samples.length,folds:report.folds.length,
  billableModelEnabled:runModel,executedTrades:0,tradingEnabled:false}));
}catch(error){
 console.error('Historical AI replay refused: '+String(error.message||error).slice(0,220));
 process.exitCode=1;
}
