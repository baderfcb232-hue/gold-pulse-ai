/* Shared marketing/dashboard locale preference; presentation only, never changes market data. */
(() => {
  const marketing='nabd-marketing-language',dashboard='nabd:dashboard:language';
  const current=location.pathname==='/en'?'en':'ar';
  const save=locale=>{
    try{localStorage.setItem(marketing,locale);localStorage.setItem(dashboard,locale);}catch{}
  };
  try {
    // Dashboard and account use dashboard first, so marketing follows that same priority.
    const stored=localStorage.getItem(dashboard)||localStorage.getItem(marketing);
    if(current==='en')save('en');
    else if(stored==='en'&&location.pathname==='/'){
      location.replace('/en');
      return;
    }else if(stored==='ar'&&location.pathname==='/')save('ar');
  } catch { /* Direct URLs remain usable with storage disabled. */ }
  document.addEventListener('DOMContentLoaded',()=>{
    for(const link of document.querySelectorAll('[data-lang-target]')) {
      link.addEventListener('click',()=>{
        const target=link.getAttribute('data-lang-target');
        if(target==='ar'||target==='en')save(target);
      });
    }
    for(const menu of document.querySelectorAll('.mobile-menu')) {
      for(const link of menu.querySelectorAll('a')) {
        link.addEventListener('click',()=>{menu.open=false;});
      }
      menu.addEventListener('keydown',event=>{
        if(event.key==='Escape'&&menu.open){
          menu.open=false;
          menu.querySelector('summary')?.focus();
        }
      });
    }
  });
})();
