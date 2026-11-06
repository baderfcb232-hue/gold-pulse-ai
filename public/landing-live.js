/* NABD landing market display: public read-only source with freshness checks. */
(()=>{
 const en=document.documentElement.lang==='en';
 const t=en?{loading:'Loading market data',missing:'Price unavailable',stale:'Stale — not live',live:'Recent quote',source:'Source',time:'Updated'}:{loading:'جاري تحميل بيانات السوق',missing:'السعر غير متاح',stale:'بيانات قديمة — ليست مباشرة',live:'سعر حديث',source:'المصدر',time:'التحديث'};
 let pending;
 const good=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
 async function refresh(){
   if(pending)pending.abort();pending=new AbortController();
   try{
     const response=await fetch('/api/market',{signal:pending.signal,credentials:'omit',cache:'no-store'});
     if(!response.ok)throw Error('market unavailable');
     const data=await response.json();
     for(const symbol of ['XAUUSD','BTCUSD']){
       const root=document.querySelector('[data-landing-market="'+symbol+'"]');if(!root)continue;
       const market=data?.markets?.[symbol],timestamp=market?.quote?.time,age=Date.now()/1000-timestamp;
       const fresh=market?.connection==='LIVE'&&good(market?.quote?.price)&&good(timestamp)&&age>=-5&&age<=(symbol==='XAUUSD'?90:20);
       root.querySelector('[data-market-price]').textContent=fresh?new Intl.NumberFormat(en?'en-US':'ar',{minimumFractionDigits:2,maximumFractionDigits:2}).format(market.quote.price)+' USD':'—';
       root.querySelector('[data-market-status]').textContent=fresh?t.live:market?.quote?t.stale:t.missing;
       root.querySelector('[data-market-source]').textContent=typeof market?.source==='string'?t.source+': '+market.source.slice(0,80):'';
       root.querySelector('[data-market-updated]').textContent=good(timestamp)?t.time+': '+new Date(timestamp*1000).toLocaleTimeString(en?'en-US':'ar',{hour:'2-digit',minute:'2-digit'}):'';
       root.dataset.status=fresh?'live':'stale';
     }
   }catch(error){if(error?.name==='AbortError')return;document.querySelectorAll('[data-landing-market]').forEach(root=>{root.querySelector('[data-market-price]').textContent='—';root.querySelector('[data-market-status]').textContent=t.missing;root.querySelector('[data-market-source]').textContent='';root.querySelector('[data-market-updated]').textContent='';root.dataset.status='stale';});}
 }
 const phone=document.querySelector('.phone-preview');
 if(phone){
   const path=phone.querySelector('svg path:first-child'),name=phone.querySelector('.phone-value');
   const paths={XAUUSD:'M0 62L24 53L42 59L64 38L84 45L108 26L128 36L150 12L170 22',BTCUSD:'M0 28L24 41L42 20L64 47L84 35L108 58L128 41L150 62L170 46'};
   const buttons=[...phone.querySelectorAll('[data-preview-symbol]')];
   buttons.forEach(button=>button.addEventListener('click',()=>{const symbol=button.dataset.previewSymbol;if(!paths[symbol])return;path?.setAttribute('d',paths[symbol]);if(name)name.firstChild.textContent=symbol+' ';buttons.forEach(item=>item.setAttribute('aria-pressed',String(item===button)));}));
 }
 if(document.querySelector('[data-landing-market]')){refresh();const id=setInterval(()=>{if(!document.hidden)refresh();},15000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});window.addEventListener('pagehide',()=>{clearInterval(id);pending?.abort();},{once:true});}
})();
