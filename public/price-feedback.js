/* Visual feedback for real accepted ticks. Never interpolate prices or alter orders. */
export function priceMovement(previous,next){
  if(!Number.isFinite(previous)||!Number.isFinite(next)||previous<=0||next<=0)return 'none';
  return next>previous?'up':next<previous?'down':'none';
}
export function createPriceFeedback({root=document,reducedMotion=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches}={}){
  const latest=new Map(),animations=new WeakMap();
  function observe(id,value,{symbol='XAUUSD',time,sourceId=''}={}){
    const element=root.getElementById?.(id);
    if(!element||!Number.isFinite(value)||value<=0||!Number.isFinite(time)||time<=0)return 'none';
    const key=symbol+':'+id,source=String(sourceId||symbol),previous=latest.get(key);
    if(previous&&time<previous.time)return 'none'; // Ignore older quotes.
    const direction=previous&&previous.source===source?priceMovement(previous.value,value):'none';
    latest.set(key,{value,time,source});
    if(direction==='none'||root.hidden||reducedMotion()||typeof element.animate!=='function')return direction;
    const isDark=root.documentElement?.getAttribute?.('data-nabd-theme')==='dark';
    const background=direction==='up'?(isDark?'#176749':'#d0f8e5'):(isDark?'#76303c':'#ffe1e5');
    const foreground=direction==='up'?(isDark?'#a4ffe0':'#065f46'):(isDark?'#ffe0e4':'#a51d35');
    try{
      animations.get(element)?.cancel?.();
      const animation=element.animate([
        {backgroundColor:background,color:foreground},
        {backgroundColor:'transparent',color:'inherit'}
      ],{duration:420,easing:'ease-out',iterations:1});
      animations.set(element,animation);
    }catch{/* Animation is optional, prices remain unchanged. */}
    return direction;
  }
  return {observe};
}
