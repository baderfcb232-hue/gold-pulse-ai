/* NABD visual-only initial loading. Automatically falls back to honest empty/stale states. */
export function createMarketLoaders({root=document,timeoutMs=8000,groups=null}={}){
  const nodes=new Map(),finished=new Set();
  const targets={
    market:['.live-quote-card','.live-top-grid .decision-card','.featured-signal'],
    chart:['#live-chart-card'],
    news:['#live-news-preview'],
    history:['#scalp-recent','#scalp-history-list'],
    connection:['.broker-connect','#connection-hub']
  };
  // The main MT5 state request and market history requests finish independently.
  const selectedGroups=groups===null?['market','chart','news','history']:
    [...new Set(groups)].filter(group=>Object.hasOwn(targets,group));
  let timer=null,stopped=false;
  const clear=group=>{
    if(!selectedGroups.includes(group)||finished.has(group))return;
    finished.add(group);
    for(const el of nodes.get(group)||[]){
      el.removeAttribute('data-nabd-loading');
      el.setAttribute('aria-busy','false');
    }
    if(finished.size===selectedGroups.length&&timer!==null){clearTimeout(timer);timer=null;}
  };
  for(const group of selectedGroups){
    const selectors=targets[group];
    const selected=selectors.flatMap(s=>{try{return Array.from(root.querySelectorAll(s));}catch{return []}});
    nodes.set(group,selected);
    for(const element of selected){
      element.setAttribute('data-nabd-loading','true');
      element.setAttribute('aria-busy','true');
    }
  }
  if(timeoutMs>0)timer=setTimeout(()=>{stopped=true;for(const group of selectedGroups)clear(group);},timeoutMs);
  return {
    ready:clear,
    fail:clear,
    get pending(){return !stopped&&finished.size<selectedGroups.length;},
    destroy(){stopped=true;if(timer!==null)clearTimeout(timer);for(const group of selectedGroups)clear(group);}
  };
}
