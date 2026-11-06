/* NABD phase 5: read-only gold/Bitcoin RSS headline ribbon.
   Consumes the existing /api/news stream via live.js. Never fetches broker data,
   generates trading signals, or claims articles are real-time prices. */
const TOPICS=new Set(['GOLD','BTC']);
const MAX_AGE=3*24*60*60; // Only fresh, recent headlines, not week-old cached stories
export function tickerItems(feed,filter='ALL',at=Date.now()/1000,limit=12){
 if(!Array.isArray(feed?.items))return [];
 const seen=new Set(),out=[];
 for(const x of feed.items){
  if(!x||!TOPICS.has(x.category)||(filter!=='ALL'&&x.category!==filter))continue;
  // Keep this ribbon strictly about Bitcoin, not unrelated Ethereum/altcoin stories.
  if(x.category==='BTC'&&x.source!=='cointelegraph-btc'&&!/\b(?:bitcoin|btc)\b|بيتكوين/i.test(x.title||''))continue;
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
  ar:{name:'أخبار الذهب والبيتكوين',gold:'ذهب',btc:'بيتكوين',loading:'جاري جلب الأخبار من المصادر…',empty:'لا توجد أخبار حديثة الآن',offline:'مصادر الأخبار غير متاحة حاليًا',stale:'الأخبار متأخرة',live:'مصادر الأخبار محدّثة',published:'نُشر'},
  en:{name:'Gold & Bitcoin news',gold:'Gold',btc:'Bitcoin',loading:'Loading source headlines…',empty:'No recent headlines right now',offline:'News sources are currently unavailable',stale:'News sources are delayed',live:'News sources updated',published:'Published'}
};
export function initNewsTicker(root=typeof document!=='undefined'?document.getElementById('nabd-news-ticker'):null){
  if(!root||typeof root.querySelector!=='function'||typeof root.querySelectorAll!=='function')return()=>{};
  const title=root.querySelector('[data-ticker-title]');
  const viewport=root.querySelector('[data-ticker-viewport]');
  const track=root.querySelector('[data-ticker-track]');
  const fallback=root.querySelector('[data-ticker-placeholder]');
  if(!title||!viewport||!track||!fallback)return()=>{};
  let feed=null,failed=false,signature='';
  const language=()=>document.documentElement.lang==='en'?'en':'ar';
  const shownTime=(stamp,locale)=>{
    try{return new Intl.DateTimeFormat(locale==='ar'?'ar':'en-US',{timeZone:'Asia/Gaza',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(stamp*1000));}
    catch{return '';}
  };
  function buildGroup(items,locale){
    const t=labels[locale],group=document.createElement('div');
    group.className='nabd-ticker-group';
    for(const item of items){
      const anchor=document.createElement('a');
      anchor.className='nabd-ticker-story';
      anchor.href=item.url;
      anchor.target='_blank';
      anchor.rel='noopener noreferrer';
      const topic=document.createElement('span');
      topic.className='nabd-ticker-category';
      topic.textContent=item.category==='GOLD'?t.gold:t.btc;
      const words=document.createElement('span');
      words.className='nabd-ticker-headline';
      words.dir='auto';
      words.textContent=item.title;
      anchor.append(topic,words);
      const source=typeof item.source_name==='string'?item.source_name.slice(0,75):'';
      anchor.title=[source,t.published+': '+shownTime(item.published_at,locale)].filter(Boolean).join(' · ');
      group.append(anchor);
      const divider=document.createElement('span');
      divider.className='nabd-ticker-divider';
      divider.textContent='◆';
      divider.setAttribute('aria-hidden','true');
      group.append(divider);
    }
    return group;
  }
  function render(){
    const locale=language(),t=labels[locale],state=feed?tickerFeedStatus(feed):failed?'UNAVAILABLE':'PENDING';
    const items=tickerItems(feed,'ALL',Date.now()/1000,12);
    root.setAttribute('aria-label',t.name);
    root.dataset.feedStatus=state.toLowerCase();
    root.title=state==='LIVE'?t.live:state==='STALE'?t.stale:state==='UNAVAILABLE'?t.offline:t.loading;
    title.textContent=t.name;
    if(!items.length){
      signature='';
      track.replaceChildren();
      viewport.dataset.hasNews='false';
      fallback.hidden=false;
      fallback.textContent=state==='PENDING'?t.loading:state==='UNAVAILABLE'?t.offline:t.empty;
      return;
    }
    fallback.hidden=true;
    viewport.dataset.hasNews='true';
    const nextSignature=locale+'|'+items.map(x=>[x.id||x.url,x.title,x.published_at].join(':')).join('~');
    if(signature===nextSignature)return;
    signature=nextSignature;
    const group=buildGroup(items,locale);
    track.replaceChildren(group);
    // A short feed (even one headline) must not leave an empty gap in the crawl.
    // Fill a whole viewport before creating the matching second half.
    if(viewport.clientWidth>0 && group.scrollWidth>0){
      const originals=[...group.children].map(node=>node.cloneNode(true));
      for(let n=0;n<10 && group.scrollWidth<viewport.clientWidth+48;n++){
        group.append(...originals.map(node=>node.cloneNode(true)));
      }
    }
    const duplicate=group.cloneNode(true);
    duplicate.setAttribute('aria-hidden','true');
    duplicate.classList.add('nabd-ticker-copy');
    duplicate.querySelectorAll('a').forEach(a=>{a.tabIndex=-1;});
    track.replaceChildren(group,duplicate);
    // Keep approximately constant reading speed as feeds gain or lose stories.
    const chars=items.reduce((count,x)=>count+x.title.length+22,0);
    const distance=group.scrollWidth||chars*7;
    track.style.setProperty('--nabd-ticker-duration',Math.max(20,Math.min(180,Math.round(distance/42)))+'s');
  }
  const onLocale=()=>{signature='';render();};
  document.addEventListener('nabd:language-change',onLocale);
  const firstLoad=setTimeout(()=>{if(!feed){failed=true;render();}},15000);
  const freshnessTimer=setInterval(()=>{if(!document.hidden)render();},60000);
  window.addEventListener('pagehide',()=>{clearTimeout(firstLoad);clearInterval(freshnessTimer);document.removeEventListener('nabd:language-change',onLocale);},{once:true});
  render();
  return payload=>{
    if(!payload||!Array.isArray(payload.items)||!Array.isArray(payload.sources))return;
    feed=payload;failed=false;clearTimeout(firstLoad);render();
  };
}
