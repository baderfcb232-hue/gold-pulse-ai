/* Marketing locale preference only; does not translate or modify MT5 dashboard data. */
(() => {
  const key='nabd-marketing-language';
  const current=location.pathname==='/en'?'en':'ar';
  try {
    const stored=localStorage.getItem(key);
    if(current==='en') localStorage.setItem(key,'en');
    else if(stored==='en' && location.pathname==='/') {
      location.replace('/en');
      return;
    }
  } catch { /* Direct URLs still work with private browsing. */ }
  document.addEventListener('DOMContentLoaded',()=>{
    for(const link of document.querySelectorAll('[data-lang-target]')) {
      link.addEventListener('click',()=>{
        const target=link.getAttribute('data-lang-target');
        if(target!=='ar' && target!=='en')return;
        try{localStorage.setItem(key,target);}catch{}
      });
    }
  });
})();
