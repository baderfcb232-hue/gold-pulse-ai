import test from 'node:test';
import assert from 'node:assert/strict';
import {parseComparable,calculateSurprise,assessPriceReaction,newsResearchReadiness} from './news-surprise.mjs';
const now=1800000000;
test('economic numeric units are parsed strictly',()=>{
 assert.deepEqual(parseComparable(' 2.3% '),{value:2.3,unit:'PERCENT'});
 assert.deepEqual(parseComparable('150K'),{value:150000,unit:'COUNT'});
 assert.deepEqual(parseComparable('1.5M'),{value:1500000,unit:'COUNT'});
 assert.equal(parseComparable('pending'),null);
});
test('valid comparable actual vs forecast remains research-only',()=>{
 const r=calculateSurprise({source:'TRADING_ECONOMICS_CALENDAR_REFERENCE',actual:'3.2%',forecast:'3.0%',previous:'2.9%',
 actualPublishedAt:now-30,forecastKnownAt:now-200,now});
 assert.equal(r.direction,'ABOVE_FORECAST');assert.equal(r.difference,0.20000000000000018);
 assert.equal(r.marketImpactDirection,'UNKNOWN');assert.equal(r.autoExecutionAllowed,false);
});
test('no verified publication timestamps is blocked',()=>{
 const r=calculateSurprise({source:'TRADING_ECONOMICS_CALENDAR_REFERENCE',actual:'3.2%',forecast:'3%',now});
 assert.equal(r.reason,'NO_POINT_IN_TIME_PROOF');
});
test('future data and hindsight forecasts are blocked',()=>{
 const r=calculateSurprise({source:'TRADING_ECONOMICS_CALENDAR_REFERENCE',actual:'3.2%',forecast:'3%',
 actualPublishedAt:now+100,forecastKnownAt:now-100,now});
 assert.equal(r.signal,'WAIT');
 const s=calculateSurprise({source:'TRADING_ECONOMICS_CALENDAR_REFERENCE',actual:'3.2%',forecast:'3%',
 actualPublishedAt:now-50,forecastKnownAt:now-20,now});
 assert.equal(s.reason,'NO_POINT_IN_TIME_PROOF');
});
test('unit mismatch and unknown source block decisions',()=>{
 assert.equal(calculateSurprise({source:'BAD',actual:'3%',forecast:'3%',now}).reason,'UNKNOWN_EVENT_PROVIDER');
 assert.equal(calculateSurprise({source:'TRADING_ECONOMICS_CALENDAR_REFERENCE',actual:'3%',forecast:'3K',now}).reason,'MISSING_OR_INCOMPARABLE_ACTUAL_FORECAST');
});
function candle(time,open,close){return {time,open,close,high:Math.max(open,close)+1,low:Math.min(open,close)-1};}
const eventAt=now-600;
const bars=[candle(now-1200,100,101),candle(now-900,101,102),candle(now-600,102,103),candle(now-300,103,104)];
test('reference price reaction uses only completed post-event bar',()=>{
 const r=assessPriceReaction({candles:bars,eventAt,now});
 assert.equal(r.status,'REFERENCE_REACTION');assert.equal(r.from,102);assert.equal(r.to,103);
 assert.equal(r.causalAttribution,false);assert.equal(r.autoExecutionAllowed,false);
});
test('gapped bars are rejected rather than interpolated',()=>{
 const r=assessPriceReaction({candles:[bars[0],bars[2],bars[3]],eventAt,now});
 assert.equal(r.reason,'INVALID_OR_GAPPED_CANDLES');
});
test('future candles cannot influence result',()=>{
 const future=candle(now,104,500);
 const r=assessPriceReaction({candles:[...bars,future],eventAt,now});
 assert.equal(r.signal,'WAIT');assert.equal(r.reason,'INVALID_OR_GAPPED_CANDLES');
});
test('without before and after candle no claimed reaction',()=>{
 const r=assessPriceReaction({candles:[bars[2],bars[3]],eventAt,now});
 assert.equal(r.reason,'MISSING_PRE_POST_EVENT_CANDLES');
});
test('readiness reports missing independent data',()=>{
 const r=newsResearchReadiness({calendarConfigured:false,openaiConnected:false});
 assert.equal(r.status,'BLOCKED');assert.ok(r.blockers.includes('AI_NOT_CONNECTED'));
 assert.equal(r.autoExecutionAllowed,false);
});
test('even complete research readiness does not enable execution',()=>{
 const r=newsResearchReadiness({calendarConfigured:true,verifiedReleaseArchive:true,
 goldBrokerCandles:true,btcBrokerCandles:true,openaiConnected:true});
 assert.equal(r.status,'RESEARCH_READY');assert.equal(r.autoExecutionAllowed,false);
});
