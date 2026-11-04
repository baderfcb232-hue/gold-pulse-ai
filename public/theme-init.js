/* NABD presentation preference only. No trading, bridge, or account access. */
(function(){
  'use strict';
  const key='nabd:dashboard:theme';
  const allowed=['light','dark','system'];
  let stored='light';
  try { const value=localStorage.getItem(key); if(allowed.includes(value)) stored=value; } catch {}
  const system=()=> typeof matchMedia==='function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const apply=value=>{
    document.documentElement.setAttribute('data-nabd-theme',value==='system'?system():value);
    document.documentElement.setAttribute('data-nabd-theme-choice',value);
  };
  apply(stored);
  document.addEventListener('DOMContentLoaded',()=>{
    const select=document.getElementById('dashboard-theme-choice');
    if(!select) return;
    select.value=stored;
    select.addEventListener('change',()=>{
      if(!allowed.includes(select.value)) return;
      stored=select.value;
      try{localStorage.setItem(key,stored);}catch{}
      apply(stored);
    });
    if(typeof matchMedia==='function'){
      const pref=matchMedia('(prefers-color-scheme: dark)');
      const update=()=>{if(stored==='system')apply(stored)};
      if(pref.addEventListener)pref.addEventListener('change',update);
      else if(pref.addListener)pref.addListener(update);
    }
  });
})();
