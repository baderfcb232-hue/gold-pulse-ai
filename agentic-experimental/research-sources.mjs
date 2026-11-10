import {fetchGoldReference} from './gold-reference.mjs';
import {fetchCalendarReference} from './news-reference.mjs';
// Independent source checks never initiate AI analysis or orders.
export function createResearchSources({goldKey,newsKey,loadGold=fetchGoldReference,
 loadNews=fetchCalendarReference,clock=()=>Math.floor(Date.now()/1000)}={}){
 const state={
  gold:{configured:!!goldKey,status:goldKey?'NOT_CHECKED':'NOT_CONFIGURED',lastSuccess:null,lastError:null,source:'TWELVE_DATA_REFERENCE',brokerCompatible:false},
  news:{configured:!!newsKey,status:newsKey?'NOT_CHECKED':'NOT_CONFIGURED',lastSuccess:null,lastError:null,source:'TRADING_ECONOMICS_CALENDAR_REFERENCE',verifiedForImmediateTrigger:false}
 };
 let busy=false;
 async function check(){
  if(busy)return {status:'BUSY'};
  busy=true;
  const results={};
  try{
   for(const [name,key,loader] of [['gold',goldKey,loadGold],['news',newsKey,loadNews]]){
    if(!key){results[name]='NOT_CONFIGURED';continue;}
    try{
     const snapshot=await loader({key,now:clock()});
     if(name==='gold'&&(snapshot.source!=='TWELVE_DATA_REFERENCE'||snapshot.executable!==false||snapshot.brokerCompatible!==false))throw Error('INVALID_GOLD_SOURCE');
     if(name==='news'&&(snapshot.source!=='TRADING_ECONOMICS_CALENDAR_REFERENCE'||snapshot.verifiedForImmediateTrigger!==false))throw Error('INVALID_NEWS_SOURCE');
     state[name].status='OBSERVING_REFERENCE';
     state[name].lastSuccess=new Date(clock()*1000).toISOString();
     state[name].lastError=null;
     if(name==='news')state[name].eventCount=snapshot.events.length;
     if(name==='gold')state[name].lastClosedM5=snapshot.bars.M5.at(-1).time;
     results[name]='OBSERVING_REFERENCE';
    }catch(e){state[name].status='FEED_ERROR';state[name].lastError=String(e?.message||e).slice(0,100);results[name]='FEED_ERROR';}
   }
  }finally{busy=false;}
  return results;
 }
 return {check,report:()=>({...state,analysisExecuted:false,executionAllowed:false})};
}
