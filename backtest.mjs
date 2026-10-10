import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {analyze,cleanSnapshot,TF_SECONDS,STRATEGY} from './engine.mjs';

// Exact broker timeframes are required; higher frames are not guessed from UTC buckets.
// This tests the dashboard strategy, not the independently configured original EA.
export function backtest(dataset,{allowMissingNews=false}={}) {
  if(!dataset?.spec||!dataset?.candles||!Object.values(TF_SECONDS).length)throw new Error('Contract and exact broker candle datasets required');
  for(const tf of Object.keys(TF_SECONDS))if(!Array.isArray(dataset.candles[tf]))throw new Error('Missing '+tf+' candle dataset');
  if(!(typeof dataset.spread_points==='number'&&dataset.spread_points>=0))throw new Error('An explicit historical spread assumption is required');
  if(!(typeof dataset.commission_per_lot==='number'&&dataset.commission_per_lot>=0))throw new Error('An explicit round-trip commission is required');
  if(!(dataset.spec.tick_value_loss>0&&dataset.spec.tick_size>0))throw new Error('Tick value in account currency is required');
  const m5=dataset.candles.M5;
  if(m5.length<222)throw new Error('At least 222 M5 candles plus higher-timeframe history required');
  const hasNews=dataset.calendar?.status==='historical_complete'
    &&dataset.calendar.coverage_from<=m5[220].time&&dataset.calendar.coverage_to>=m5.at(-1).time+300;
  if(!hasNews&&!allowMissingNews)throw new Error('Complete historical news coverage required, or explicitly pass --without-news-filter');
  const spread=dataset.spread_points*dataset.spec.point,slip=Math.max(0,Number(dataset.slippage_points)||0)*dataset.spec.point;
  const events=hasNews?dataset.calendar.events||[]:[],trades=[],seen=new Set();let active=null,skipped=0;
  function settle(exit,status,when){
    const sign=active.side==='BUY'?1:-1,netMovement=sign*(exit-active.actual_entry);
    const oneLotProfit=netMovement/dataset.spec.tick_size*dataset.spec.tick_value_loss-dataset.commission_per_lot;
    const oneLotRisk=Math.abs(active.actual_entry-active.sl)/dataset.spec.tick_size*dataset.spec.tick_value_loss;
    trades.push({...active,status,exit,ended_at:when,net_r:oneLotProfit/oneLotRisk,net_per_lot:oneLotProfit});active=null;
  }
  for(let i=220;i<m5.length;i++){
    const bar=m5[i],at=bar.time;
    if(active&&at>=active.expires_at)settle(active.side==='BUY'?bar.open-slip:bar.open+spread+slip,'TIME_EXIT',at);
    if(!active){
      const candles={};for(const[tf,step]of Object.entries(TF_SECONDS))candles[tf]=dataset.candles[tf].filter(c=>c.time+step<=at).slice(-320);
      const raw={symbol:dataset.symbol||'XAUUSD',account_ref:'OFFLINE_BACKTEST',broker:dataset.broker||'Historical broker data',
        bid:bar.open,ask:bar.open+spread,quote_at:at,terminal_connected:true,spec:dataset.spec,candles,
        calendar:{status:'ok',updated_at:at,events:events.filter(ev=>ev.time>at-6*3600&&ev.time<at+86400)},execution:{}};
      const result=analyze(cleanSnapshot(raw,at),at);
      if(result.plan){const key=result.plan.bar_time+':'+result.plan.side;if(!seen.has(key)){seen.add(key);active={...result.plan,actual_entry:result.plan.entry+(result.plan.side==='BUY'?slip:-slip)};}}
      else skipped++;
    }
    if(active){
      const buy=active.side==='BUY',low=bar.low+(buy?0:spread),high=bar.high+(buy?0:spread),open=bar.open+(buy?0:spread);
      const stop=buy?low<=active.sl:high>=active.sl,target=buy?high>=active.tp2:low<=active.tp2;
      // OHLC does not reveal intrabar ordering: stop is assumed first if both are touched.
      if(stop)settle((buy?Math.min(active.sl,open)-slip:Math.max(active.sl,open)+slip),'SL',at+300);
      else if(target)settle(active.tp2+(buy?-slip:slip),'TP2',at+300);
    }
  }
  if(active){const last=m5.at(-1);settle(active.side==='BUY'?last.close-slip:last.close+spread+slip,'END_OF_DATA',last.time+300);}
  let equity=0,peak=0,drawdown=0;for(const t of trades){equity+=t.net_r;peak=Math.max(peak,equity);drawdown=Math.max(drawdown,peak-equity);}
  const positive=trades.filter(t=>t.net_r>0),gain=positive.reduce((n,t)=>n+t.net_r,0),loss=-trades.filter(t=>t.net_r<0).reduce((n,t)=>n+t.net_r,0);
  return {kind:'OFFLINE_SIMULATION',strategy:STRATEGY,news_filter:hasNews?'historical calendar':'DISABLED EXPLICITLY',
    assumptions:{spread_points:dataset.spread_points,slippage_points:dataset.slippage_points||0,
      round_trip_commission_per_lot:dataset.commission_per_lot,constant_tick_value:true,
      stop_first_if_both_levels_touched:true,swap_included:false,time_exit_seconds:900,
      execution_engine:'dashboard strategy; not the MT5 EA'},
    summary:{trades:trades.length,win_rate:trades.length?positive.length/trades.length:null,
      net_r:equity,max_drawdown_r:drawdown,profit_factor:loss?gain/loss:null,skipped_bars:skipped},trades};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const input=process.argv[2];if(!input)throw new Error('Usage: node backtest.mjs dataset.json [--without-news-filter] [--output report.json]');
    const args=process.argv.slice(3),report=backtest(JSON.parse(readFileSync(input,'utf8')),{allowMissingNews:args.includes('--without-news-filter')});
    const output=args.includes('--output')?args[args.indexOf('--output')+1]:'backtest-report.json';
    if(!output)throw new Error('Missing output filename');writeFileSync(output,JSON.stringify(report,null,2));
    console.log(JSON.stringify({output,summary:report.summary,news_filter:report.news_filter},null,2));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
