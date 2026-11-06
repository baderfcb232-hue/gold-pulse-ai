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
  // An ECB/Fed general notice may be categorized as GOLD server-side. The
  // compact ribbon only shows headlines that actually mention a market driver.
  if(x.category==='GOLD'&&!/\b(?:gold|bullion|xauusd|precious metals?|federal reserve|\bfed\b|interest rates?|rate cut|rate hike|inflation|\bcpi\b|\busd\b|dollar|unemployment|payroll|\bnfp\b|monetary policy|powell)\b|ذهب|فائدة|تضخم|دولار|الفيدرالي|بطالة/i.test(x.title||''))continue;
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
// Shorten only the publisher's own headline; no invented summary or market impact.
export function conciseHeadline(title){
  if(typeof title!=='string')return '';
  const plain=title.replace(/\s+/g,' ').trim().replace(/\s+[|—–-]\s+(?:BBC(?: News)?|Reuters|CoinDesk|Cointelegraph)\s*$/i,'');
  const limit=/[\u0600-\u06ff]/.test(plain)?48:62;
  if(Array.from(plain).length<=limit)return plain;
  const chars=Array.from(plain),prefix=chars.slice(0,limit+1).join('');
  const space=prefix.lastIndexOf(' ');
  const short=space>limit*0.65?prefix.slice(0,space):chars.slice(0,limit).join('');
  return short.replace(/[\s,;:–—-]+$/,'')+'…';
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
  let feed=null,failed=false,signature='',motion=null;
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
      words.textContent=conciseHeadline(item.title);
      anchor.append(topic,words);
      const source=typeof item.source_name==='string'?item.source_name.slice(0,75):'';
      anchor.title=[item.title,source,t.published+': '+shownTime(item.published_at,locale)].filter(Boolean).join(' · ');
      anchor.setAttribute('aria-label',item.title);
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
      motion?.cancel();motion=null;track.classList?.remove('nabd-ticker-waapi');
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
        group.append(...originals.map(node=>{
          const copy=node.cloneNode(true);
          copy.setAttribute('aria-hidden','true');
          if(copy.tagName==='A')copy.tabIndex=-1;
          return copy;
        }));
      }
    }
    const duplicate=group.cloneNode(true);
    duplicate.setAttribute('aria-hidden','true');
    duplicate.classList.add('nabd-ticker-copy');
    duplicate.querySelectorAll('a').forEach(a=>{a.tabIndex=-1;});
    track.replaceChildren(group,duplicate);
    // Match the distance of exactly one of the two identical groups.
    // Web Animations keeps running on iOS even if the system has Reduce Motion
    // enabled. It moves more slowly in that mode, as explicitly requested here.
    const chars=items.reduce((count,x)=>count+conciseHeadline(x.title).length+15,0);
    const distance=Math.ceil(group.scrollWidth)||chars*7;
    const slow=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration=Math.max(12,Math.min(180,Math.round(distance/(slow?25:48))));
    track.style.setProperty('--nabd-ticker-duration',duration+'s');
    motion?.cancel();motion=null;
    if(typeof track.animate==='function'&&distance>0){
      track.classList.add('nabd-ticker-waapi');
      motion=track.animate([
        {transform:'translate3d(0px,0px,0px)'},
        {transform:'translate3d(-'+distance+'px,0px,0px)'}
      ],{duration:duration*1000,iterations:Infinity,easing:'linear'});
    }else{
      track.classList.remove('nabd-ticker-waapi');
    }
  }
  const onLocale=()=>{signature='';render();};
  document.addEventListener('nabd:language-change',onLocale);
  const firstLoad=setTimeout(()=>{if(!feed){failed=true;render();}},15000);
  const freshnessTimer=setInterval(()=>{if(!document.hidden)render();},60000);
  window.addEventListener('pagehide',()=>{clearTimeout(firstLoad);clearInterval(freshnessTimer);motion?.cancel();document.removeEventListener('nabd:language-change',onLocale);},{once:true});
  render();
  return payload=>{
    if(!payload||!Array.isArray(payload.items)||!Array.isArray(payload.sources))return;
    feed=payload;failed=false;clearTimeout(firstLoad);render();
  };
}
