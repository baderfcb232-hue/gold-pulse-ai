/* NABD phase 5: read-only gold/Bitcoin RSS headline ribbon.
   Consumes the existing /api/news stream via live.js. Never fetches broker data,
   generates trading signals, or claims articles are real-time prices. */
const TOPICS=new Set(['GOLD','BTC']);
const MAX_AGE=7*24*60*60;
export function tickerItems(feed,filter='ALL',at=Date.now()/1000,limit=12){
 if(!Array.isArray(feed?.items))return [];
 const seen=new Set(),out=[];
 for(const x of feed.items){
  if(!x||!TOPICS.has(x.category)||(filter!=='ALL'&&x.category!==filter))continue;
  if(typeof x.title!=='string'||!x.title.trim()||typeof x.url!=='string')continue;
  if(!Number.isFinite(x.published_at)||x.published_at>at+300||x.published_at<at-MAX_AGE)continue;
  let target;try{target=new URL(x.url);}catch{continue;}
  if(!['https:','http:'].includes(target.protocol)||target.username||target.password)continue;
  const key=typeof x.id==='string'&&x.id?x.id:target.href;
  if(seen.has(key))continue;
  seen.add(key);out.push(x);
 }
 return out.sort((a,b)=>b.published_at-a.published_at).slice(0,limit);
}
export function tickerFeedStatus(feed,at=Date.now()/1000){
 if(!Array.isArray(feed?.sources)||!feed.sources.length)return 'UNAVAILABLE';
 if(feed.sources.some(s=>s.status==='LIVE'&&Number.isFinite(s.last_success)&&s.last_success>0&&s.last_success<=at+300&&at-s.last_success<=900))return 'LIVE';
 if(feed.sources.every(s=>s.status==='PENDING'))return 'PENDING';
 return 'STALE';
}
const labels={
 ar:{title:'أخبار الذهب والبيتكوين',all:'الكل',gold:'الذهب',btc:'بيتكوين',loading:'جاري جلب الأخبار من المصادر…',empty:'لا توجد أخبار حديثة مطابقة من المصادر المتاحة.',unavailable:'تعذّر تحديث مصادر الأخبار.',live:'المصادر محدّثة',pending:'جلب المصادر…',stale:'مصادر الأخبار متأخرة',source:'المصدر',published:'نُشر',checked:'آخر جلب',pause:'إيقاف الحركة',resume:'استئناف الحركة',previous:'الخبر السابق',next:'الخبر التالي',note:'العناوين بلغة المصدر · التصنيف موضوعي وليس توصية تداول'},
 en:{title:'Gold & Bitcoin news',all:'All',gold:'Gold',btc:'Bitcoin',loading:'Fetching headlines from sources…',empty:'No recent matching headlines from available sources.',unavailable:'News sources could not be refreshed.',live:'Sources updated',pending:'Fetching feeds…',stale:'News feeds delayed',source:'Source',published:'Published',checked:'Last fetched',pause:'Pause rotation',resume:'Resume rotation',previous:'Previous headline',next:'Next headline',note:'Headlines in source language · topic tags are not trading advice'}
};
export function initNewsTicker(root=document.getElementById('nabd-news-ticker')){
 if(!root||typeof root.querySelector!=='function'||typeof root.querySelectorAll!=='function')return()=>{};
 const find=q=>root.querySelector(q),title=find('[data-ticker-title]'),status=find('[data-ticker-status]'),headline=find('[data-ticker-link]'),placeholder=find('[data-ticker-placeholder]'),meta=find('[data-ticker-meta]'),topic=find('[data-ticker-topic]'),note=find('[data-ticker-note]'),previous=find('[data-ticker-prev]'),next=find('[data-ticker-next]'),pause=find('[data-ticker-pause]'),filters=[...root.querySelectorAll('[data-ticker-filter]')];
 let feed=null,filter='ALL',index=0,paused=false,initialFailed=false;
 const reduced=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
 if(reduced)paused=true;
 const locale=()=>document.documentElement.lang==='en'?'en':'ar';
 const formatTime=(value,l)=>{
  if(!Number.isFinite(value)||value<=0)return '';
  try{return new Intl.DateTimeFormat(l==='ar'?'ar':'en-US',{timeZone:'Asia/Gaza',hour:'2-digit',minute:'2-digit',day:'numeric',month:'short'}).format(new Date(value*1000));}catch{return '';}
 };
 function draw(){
  const l=locale(),t=labels[l],data=tickerItems(feed,filter),state=tickerFeedStatus(feed);
  root.setAttribute('aria-label',t.title);
  find('[data-ticker-filters]').setAttribute('aria-label',l==='ar'?'تصفية أخبار الأسواق':'News topic filter');
  find('[data-ticker-controls]').setAttribute('aria-label',l==='ar'?'التنقل بين الأخبار':'Headline navigation');
  title.textContent=t.title;note.textContent=t.note;
  for(const b of filters){
   b.textContent=b.dataset.tickerFilter==='ALL'?t.all:b.dataset.tickerFilter==='GOLD'?t.gold:t.btc;
   b.setAttribute('aria-pressed',String(b.dataset.tickerFilter===filter));
  }
  const checked=Array.isArray(feed?.sources)?Math.max(0,...feed.sources.map(s=>Number.isFinite(s.last_success)?s.last_success:0)):0;
  status.textContent=state==='LIVE'?t.live:state==='PENDING'?t.pending:state==='STALE'?t.stale:t.unavailable;
  status.title=checked?t.checked+': '+formatTime(checked,l):t.pending;
  root.dataset.feedStatus=state.toLowerCase();
  pause.setAttribute('aria-pressed',String(paused));pause.setAttribute('aria-label',paused?t.resume:t.pause);
  pause.textContent=paused?'▶':'Ⅱ';pause.title=paused?t.resume:t.pause;
  previous.setAttribute('aria-label',t.previous);previous.title=t.previous;next.setAttribute('aria-label',t.next);next.title=t.next;
  if(!data.length){
   headline.hidden=true;placeholder.hidden=false;
   placeholder.textContent=state==='PENDING'||!feed?t.loading:state==='UNAVAILABLE'?t.unavailable:t.empty;
   meta.textContent='';topic.textContent='';
  }else{
   index=((index%data.length)+data.length)%data.length;
   const item=data[index];headline.hidden=false;placeholder.hidden=true;
   headline.textContent=item.title;headline.href=item.url;headline.dir='auto';
   topic.textContent=item.category==='GOLD'?t.gold:t.btc;
   const source=typeof item.source_name==='string'?item.source_name.slice(0,75):'';
   meta.textContent=[source&&t.source+': '+source,t.published+': '+formatTime(item.published_at,l)].filter(Boolean).join(' · ');
  }
  previous.disabled=data.length<=1;next.disabled=data.length<=1;
 }
 for(const b of filters)b.addEventListener('click',()=>{filter=b.dataset.tickerFilter;index=0;draw();});
 previous.addEventListener('click',()=>{index--;draw();});
 next.addEventListener('click',()=>{index++;draw();});
 pause.addEventListener('click',()=>{paused=!paused;draw();});
 const language=()=>draw();document.addEventListener('nabd:language-change',language);
 const missingTimer=setTimeout(()=>{if(!feed){initialFailed=true;draw();}},15000);
 const interval=setInterval(()=>{if(!paused&&!reduced&&!document.hidden&&!root.matches(':hover')&&!root.contains(document.activeElement)){const count=tickerItems(feed,filter).length;if(count>1){index++;draw();}}},9000);
 const freshnessInterval=setInterval(()=>{if(!document.hidden)draw();},60000);
 window.addEventListener('pagehide',()=>{clearTimeout(missingTimer);clearInterval(interval);clearInterval(freshnessInterval);document.removeEventListener('nabd:language-change',language);},{once:true});
 draw();
 return data=>{if(data&&Array.isArray(data.items)&&Array.isArray(data.sources)){feed=data;index=0;initialFailed=false;clearTimeout(missingTimer);draw();}};
}
