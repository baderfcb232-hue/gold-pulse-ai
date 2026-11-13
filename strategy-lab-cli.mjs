// Local-only Strategy Lab runner. No network, MT5, Render, or trading commands.
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {runStrategyLab} from './strategy-lab.mjs';
const args=process.argv.slice(2);
const get=name=>{const i=args.indexOf(name);return i===-1?null:args[i+1]};
function asSeconds(date){
 if(!date)return undefined;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Use YYYY-MM-DD dates in UTC');
 const ts=Date.parse(date+'T00:00:00Z');
 if(!Number.isFinite(ts)||new Date(ts).toISOString().slice(0,10)!==date)
  throw Error('Invalid historical UTC date');
 return ts/1000;
}
try{
 const input=get('--input'),output=get('--output');
 if(!input||!output||!output.toLowerCase().endsWith('.json')||input===output)
  throw Error('Usage: node strategy-lab-cli.mjs --input broker-history.json --output lab-report.json [--from YYYY-MM-DD --to YYYY-MM-DD --train-fraction 0.7 --stress-multiplier 1.5]');
 if(statSync(input).size>200*1024*1024)throw Error('Historical export exceeds 200 MB safe local cap');
 const raw=readFileSync(input,'utf8');
 const data=JSON.parse(raw);
 const report=runStrategyLab(data,{
  from:asSeconds(get('--from')),to:asSeconds(get('--to')),
  timeframe:get('--timeframe')||'M5',
  trainFraction:get('--train-fraction')?Number(get('--train-fraction')):0.7,
  stressMultiplier:get('--stress-multiplier')?Number(get('--stress-multiplier')):1.5
 });
 report.inputSha256=createHash('sha256').update(raw).digest('hex');
 report.createdAt=new Date().toISOString();
 report.disclaimer='Offline historical model only. No actual trades or strategy publication.';
 writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({savedTo:resolve(output),symbol:report.symbol,
  devTrades:report.results.development.baseline.trades,
  oosTrades:report.results.outOfSample.baseline.trades,
  sourceVerified:false,tradingEnabled:false}));
}catch(error){console.error('Strategy Lab refused: '+error.message);process.exitCode=1;}
