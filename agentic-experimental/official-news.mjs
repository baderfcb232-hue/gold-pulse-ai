// Official headline monitor; headlines only, not verified surprise numbers or trade triggers.
// No secrets, MT5, Telegram, order execution, or model calls.
export const OFFICIAL_FEEDS=Object.freeze([
  {id:'FED',url:'https://www.federalreserve.gov/feeds/press_all.xml',host:'www.federalreserve.gov'},
  {id:'BLS',url:'https://www.bls.gov/feed/bls_latest.rss',host:'www.bls.gov'}
]);
function decode(x){return x.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')
 .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
 .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&#(\d+);/g,(_,v)=>String.fromCodePoint(Math.min(Number(v),0x10ffff)));}
function tag(block,key){
 const m=block.match(new RegExp('<(?:[\\w-]+:)?'+key+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w-]+:)?'+key+'>','i'));
 return m?decode(m[1]).replace(/<[^>]*>/g,'').trim():'';
}
export function parseOfficialFeed(xml,source,now){
 if(typeof xml!=='string'||xml.length>2_000_000||!/(<rss\b|<feed\b|<rdf:RDF\b)/i.test(xml))throw Error('NEWS_INVALID_XML');
 if(!OFFICIAL_FEEDS.some(f=>f.id===source))throw Error('NEWS_UNKNOWN_SOURCE');
 const chunks=[...xml.matchAll(/<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi)].slice(0,60);
 if(!chunks.length)throw Error('NEWS_EMPTY_FEED');
 const results=[];
 for(const m of chunks){
  const block=m[1],title=tag(block,'title').slice(0,200),date=tag(block,'pubDate')||tag(block,'published')||tag(block,'updated');
  const when=Date.parse(date);
  const direct=tag(block,'link');
  const href=block.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1];
  const link=href||direct;
  if(!title||!Number.isFinite(when)||when>now*1000+300000)continue;
  let url;try{url=new URL(link);}catch{continue;}
  const expected=OFFICIAL_FEEDS.find(f=>f.id===source).host;
  if(url.protocol!=='https:'||url.hostname!==expected)continue;
  const relevant=/fomc|monetary policy|federal funds|interest rate|inflation|consumer price|producer price|employment situation|payroll|unemployment|powell|job openings/i.test(title);
  results.push({source,title,url:url.href,publishedAt:Math.floor(when/1000),
    topicRelevant:relevant,officialOrigin:true,
    releaseTimestampVerified:false,actualVsForecastVerified:false,eligibleForAutoTrading:false});
 }
 return results;
}
export async function fetchOfficialHeadlines({fetcher=fetch,now=Math.floor(Date.now()/1000)}={}){
 const results=await Promise.allSettled(OFFICIAL_FEEDS.map(async f=>{
  const res=await fetcher(f.url,{method:'GET',headers:{accept:'application/rss+xml, application/atom+xml, application/xml'},
    signal:AbortSignal.timeout(12000),redirect:'error'});
  if(!res.ok)throw Error('NEWS_HTTP_'+res.status);
  const body=await res.text();
  return {source:f.id,items:parseOfficialFeed(body,f.id,now)};
 }));
 return results.map((x,i)=>x.status==='fulfilled'?{status:'OK',...x.value}:
   {status:'ERROR',source:OFFICIAL_FEEDS[i].id,error:String(x.reason?.message||x.reason).slice(0,100),items:[]});
}
export function createOfficialNewsMonitor({load=fetchOfficialHeadlines,clock=()=>Math.floor(Date.now()/1000)}={}){
 let busy=false,lastAttempt=null,lastSuccess=null;
 let providers=OFFICIAL_FEEDS.map(f=>({source:f.id,status:'NOT_CHECKED',count:0})),recent=[];
 async function poll(){
  if(busy)return {status:'BUSY'};
  busy=true;lastAttempt=new Date(clock()*1000).toISOString();
  try{
   const snapshots=await load({now:clock()});
   if(!Array.isArray(snapshots)||snapshots.length!==OFFICIAL_FEEDS.length)throw Error('INVALID_PROVIDER_SET');
   providers=snapshots.map((s,i)=>({source:OFFICIAL_FEEDS[i].id,
      status:s.source===OFFICIAL_FEEDS[i].id&&s.status==='OK'?'OK':'ERROR',
      count:Array.isArray(s.items)?s.items.length:0,
      error:s.status==='ERROR'?s.error:undefined}));
   recent=snapshots.flatMap(s=>s.status==='OK'?s.items:[])
     .filter(e=>e.topicRelevant).sort((a,b)=>b.publishedAt-a.publishedAt).slice(0,12);
   if(providers.some(p=>p.status==='OK'))lastSuccess=new Date(clock()*1000).toISOString();
   return {status:providers.every(p=>p.status==='OK')?'OK':'PARTIAL',providers};
  }catch(e){providers=providers.map(p=>({...p,status:'ERROR',error:'NEWS_MONITOR_ERROR'}));return {status:'ERROR'};}
  finally{busy=false;}
 }
 return {poll,report:()=>({mode:'OFFICIAL_HEADLINES_ONLY',status:providers.every(p=>p.status==='OK')?'OBSERVING':
    providers.some(p=>p.status==='OK')?'PARTIAL':'UNAVAILABLE',
    lastAttempt,lastSuccess,providers,headlines:recent,
    immediateReleaseVerified:false,actualVsForecastVerified:false,
    automatedNewsTriggerEnabled:false,aiAnalysisEnabled:false,tradingEnabled:false})};
}
