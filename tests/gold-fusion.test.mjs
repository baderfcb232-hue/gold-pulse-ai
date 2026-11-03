import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {cleanSnapshot} from '../engine.mjs';
import {fixture,NOW} from './fixtures.mjs';
import {analyzeGoldFusion,GOLD_FUSION_STRATEGY} from '../strategies/gold-fusion.mjs';
import {classifyGoldCalendarEvent,goldNewsWindow,goldNewsScalpShadow} from '../strategies/gold-news-scalp.mjs';
import {brokerGoldMarket} from '../broker-market.mjs';
import {createApplication} from '../server.mjs';

const event=(name,time=NOW,importance=3,id='N')=>({id,name,time,importance,currency:'USD'});
const cal=(events,updated_at=NOW)=>({status:'ok',updated_at,events});
const raw=()=>{const s=fixture();s.symbol='XAUUSD.m';s.bid=s.candles.M5.at(-1).close-.01;s.ask=s.bid+.03;s.positions=[];s.deals=[];return s;};

test('FOMC, NFP, CPI and PCE are recognized from the MT5 USD calendar',()=>{
 for(const name of ['FOMC Statement','Nonfarm Payrolls (NFP)','CPI m/m','Core PCE Price Index','Federal Funds Rate'])
   assert.equal(classifyGoldCalendarEvent(event(name)),'HIGH_TARGET',name);
 for(const name of ['Initial Jobless Claims','Retail Sales','GDP','PMI','JOLTS','ADP'])
   assert.equal(classifyGoldCalendarEvent(event(name,NOW,2)),'MEDIUM_TARGET',name);
 assert.equal(classifyGoldCalendarEvent(event('Bitcoin ETF',NOW,3)),'HIGH_OTHER');
 assert.equal(classifyGoldCalendarEvent({...event('FOMC'),currency:'EUR'}),'OTHER');
});

test('calendar gating blocks pre-event, first 120 seconds, and 15-30m post-news',()=>{
 assert.equal(goldNewsWindow(cal([event('FOMC',NOW+1200)]),NOW).code,'HIGH_PRE_RELEASE');
 assert.equal(goldNewsWindow(cal([event('FOMC',NOW-60)]),NOW).code,'HIGH_INITIAL_SHOCK');
 const mid=goldNewsWindow(cal([event('FOMC',NOW-240)]),NOW);
 assert.equal(mid.code,'HIGH_SHADOW_WINDOW');
 assert.equal(mid.blocked,true);
 assert.equal(mid.shadowEligible,true);
 assert.equal(goldNewsWindow(cal([event('FOMC',NOW-1100)]),NOW).code,'HIGH_POST_RELEASE');
 assert.equal(goldNewsWindow(cal([event('FOMC',NOW-1900)]),NOW).blocked,false);
 assert.equal(goldNewsWindow(cal([event('Retail Sales',NOW+300,2)]),NOW).code,'MEDIUM_EVENT_BUFFER');
 assert.equal(goldNewsWindow(cal([event('FOMC',NOW-240)] ,NOW-1200),NOW).code,'CALENDAR_UNAVAILABLE');
});

test('overlapping USD events never authorize a shadow candidate',()=>{
 const a=goldNewsWindow(cal([event('FOMC',NOW-240,3,'A'),event('CPI',NOW-300,3,'B')]),NOW);
 assert.equal(a.blocked,true);assert.equal(a.shadowEligible,false);
});

test('gold M1 bars parse only for gold without expanding BTC required timeframes',()=>{
 const x=raw(),bars=Array.from({length:90},(_,i)=>({time:NOW-(90-i)*60,open:4008,
   close:4008.05,high:4008.1,low:4007.9,tick_volume:100}));
 x.candles.M1=bars;const parsed=cleanSnapshot(x,NOW);
 assert.equal(parsed.candles.M1.length,90);
 const btc=structuredClone(x);btc.symbol='BTCUSD.m';
 assert.equal(cleanSnapshot(btc,NOW).candles.M1,undefined);
 x.candles.M1.at(-1).time=NOW;assert.throws(()=>cleanSnapshot(x,NOW),/Unclosed or unordered gold M1/);
});

test('post-news M1 breakout is a shadow-only research observation, not a plan',()=>{
 const x=raw(),postTime=NOW-240;
 const m1=Array.from({length:90},(_,i)=>({time:NOW-(90-i)*60,open:4008,
   close:4008,high:4008.1,low:4007.9,tick_volume:100}));
 const last=m1.at(-1);last.open=4008.2;last.close=4008.55;
 last.high=4008.6;last.low=4008.15;last.tick_volume=220;
 x.candles.M1=m1;x.bid=4008.55;x.ask=4008.58;
 const s=cleanSnapshot(x,NOW),window=goldNewsWindow(cal([event('FOMC',postTime)]),NOW);
 const shadow=goldNewsScalpShadow(s,NOW,window);
 assert.equal(shadow.mode,'RESEARCH_ONLY_NO_EXECUTION');
 assert.equal(shadow.plan,null);
 assert.equal(shadow.code,'POST_NEWS_BREAKOUT_SHADOW');
 assert.equal(shadow.candidate.side,'BUY');
 assert.ok(shadow.candidate.risk_percent_ceiling<=.15);
 const wide=structuredClone(s);wide.ask=wide.bid+.5;
 assert.equal(goldNewsScalpShadow(wide,NOW,window).candidate,undefined);
});

test('fusion gold remains fail-closed on stale, missing, dangerous news and wide spread',()=>{
 const x=raw();
 const snap=cleanSnapshot(x,NOW),candidate=analyzeGoldFusion(snap,NOW);
 assert.equal(candidate.strategy,GOLD_FUSION_STRATEGY);
 assert.ok(['TREND','BREAKOUT','RANGE','TRANSITION'].includes(candidate.regime));
 assert.equal(brokerGoldMarket(snap,NOW).analysis.strategy,'EMA-PULLBACK-1');
 assert.equal(brokerGoldMarket(snap,NOW,{goldStrategy:'FUSION'}).analysis.strategy,GOLD_FUSION_STRATEGY);
 const bad=structuredClone(x);bad.calendar.status='unavailable';
 assert.equal(analyzeGoldFusion(cleanSnapshot(bad,NOW),NOW).plan,null);
 const before=structuredClone(x);before.calendar.events=[event('NFP',NOW+600)];
 const blocked=analyzeGoldFusion(cleanSnapshot(before,NOW),NOW);
 assert.equal(blocked.plan,null);
 assert.equal(blocked.regime,'NEWS');
 assert.equal(blocked.risk,'BLOCKED');
 const spread=structuredClone(x);spread.ask=spread.bid+1;
 assert.equal(analyzeGoldFusion(cleanSnapshot(spread,NOW),NOW).plan,null);
 const btc=structuredClone(x);btc.symbol='BTCUSD';
 assert.equal(analyzeGoldFusion(cleanSnapshot(btc,NOW),NOW).reasons[0],'GOLD_ONLY');
});

test('fusion is monitoring only without an independent gold Demo opt-in',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'nabd-gold-fusion-test-'));
 const app=createApplication({dataDir:dir,clock:()=>NOW,
   ingestToken:'gold-fusion-bridge-xxxxxxxxxxxxxxxxxxxx',
   config:{goldSignalStrategy:'FUSION',demoRecommendationExecution:true,
     publicationEnabled:true,goldFusionDemoAutoExecution:false}});
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const x=raw();x.execution.website_recommendations=true;
 x.execution.demo_recommendations=true;x.ea=null;app.ingest(x);
 assert.equal(app.marketFeed.publicState().markets.XAUUSD.analysis.strategy,GOLD_FUSION_STRATEGY);
 assert.equal(app.publicState().websiteExecution.ready,false);
 assert.equal(app.publicState().websiteExecution.reason,'GOLD_FUSION_RECOMMENDATIONS_ONLY');
 assert.throws(()=>createApplication({config:{goldSignalStrategy:'FUSION',goldFusionDemoAutoExecution:'true'}}),
   /Invalid NABD_GOLD_FUSION_DEMO_AUTOTRADE/);
});

test('fusion trend engine can produce symmetric, well-oriented BUY and SELL plans',()=>{
 for (const side of ['BUY','SELL']) {
   const x=raw();
   if(side==='SELL'){
     for(const tf of ['M5','M15','H1','H4'])
       for(const c of x.candles[tf]){
         const {open,close,high,low}=c;
         c.open=8000-open;c.close=8000-close;c.high=8000-low;c.low=8000-high;
       }
   }
   x.bid=x.candles.M5.at(-1).close-.01;x.ask=x.bid+.03;
   const analysis=analyzeGoldFusion(cleanSnapshot(x,NOW),NOW);
   assert.equal(analysis.strategy,GOLD_FUSION_STRATEGY);
   assert.equal(analysis.regime,'TREND');
   assert.equal(analysis.plan?.side,side,JSON.stringify({side,score:analysis.score,
     checks:analysis.checks,reasons:analysis.reasons}));
   const p=analysis.plan;
   assert.ok(p.sl>0 && p.tp1>0 && p.tp2>0);
   assert.ok(side==='BUY'?p.sl<p.entry&&p.entry<p.tp1:p.tp1<p.entry&&p.entry<p.sl);
   assert.equal(p.status,'TRACKING');
 }
});
