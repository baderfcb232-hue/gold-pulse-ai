/* NABD appearance preferences only. Does not import or modify the trading app. */
(() => {
  'use strict';
  const storageKey = 'nabd-theme-preference';
  const root = document.documentElement;
  const media = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const allowed = ['light','dark','auto'];
  let preference = 'light'; // Prioritize clarity for first-time visitors.
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (allowed.includes(saved)) preference = saved;
  } catch { /* Private browsing and blocked storage must not break the dashboard. */ }
  const resolved = pref => pref === 'auto' ? (media?.matches ? 'dark' : 'light') : pref;
  function apply(pref, persist = false) {
    if (!allowed.includes(pref)) return;
    preference = pref;
    const theme = resolved(pref);
    root.dataset.theme = theme;
    root.dataset.themePreference = pref;
    root.style.colorScheme = theme;
    const colorMeta = document.querySelector('meta[name="theme-color"]');
    colorMeta?.setAttribute('content',theme === 'dark' ? '#0B1220' : '#F8FAFC');
    const select = document.getElementById('theme-select');
    if (select) select.value = pref;
    if (persist) {
      try { window.localStorage.setItem(storageKey,pref); } catch {}
    }
  }
  apply(preference);
  function bindControls() {
    const select = document.getElementById('theme-select');
    if (!select) return;
    select.value = preference;
    select.addEventListener('change', () => apply(select.value,true));
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded',bindControls,{once:true});
  } else bindControls();
  const syncAuto = () => {if(preference==='auto')apply('auto');};
  if (media?.addEventListener) media.addEventListener('change',syncAuto);
  else if (media?.addListener) media.addListener(syncAuto);
})();
