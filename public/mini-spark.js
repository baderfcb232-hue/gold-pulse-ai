/* A read-only price sparkline from actual market updates. No synthetic prices. */
export function sparklineGeometry(samples) {
  if(!Array.isArray(samples)||samples.length<2)return null;
  const rows=samples.filter(p=>Number.isFinite(p?.price)&&p.price>0&&Number.isFinite(p.time));
  if(rows.length<2)return null;
  const vals=rows.map(p=>p.price),min=Math.min(...vals),max=Math.max(...vals);
  const span=max-min||Math.max(0.00001,max*.000001);
  const points=rows.map((p,i)=>({x:8+i*304/(rows.length-1),y:90-(p.price-min)/span*76,price:p.price,time:p.time}));
  return {points,path:points.map((p,i)=>(i?'L':'M')+p.x.toFixed(2)+' '+p.y.toFixed(2)).join(' ')};
}
export function initMiniSparkline({$,formatPrice,onQuote}) {
  const card=$('mini-market-card'),stage=$('mini-market-chart');
  // Existing Node trading tests use a minimal DOM stub, not a browser SVG tree.
  // No-op in that environment; the real dashboard enables the chart normally.
  if(!stage||typeof stage.querySelector!=='function')return {update(){},show(){}};
  const svg=stage.querySelector('svg');
  const line=$('mini-market-line'),guide=$('mini-market-guide'),dot=$('mini-market-dot');
  const empty=$('mini-market-empty'),caption=$('mini-market-hover'),label=$('mini-market-source');
  const bySymbol=new Map();let active=null,geometry=null;
  function render(symbol) {
    const entry=bySymbol.get(symbol);active=symbol;
    geometry=entry?sparklineGeometry(entry.samples):null;
    line.setAttribute('d',geometry?.path||'');
    empty.hidden=Boolean(geometry);
    guide.hidden=true;dot.hidden=true;
    if(entry?.samples.length) {
      const last=entry.samples.at(-1);
      $('mini-market-last').textContent=formatPrice(last.price);
      if(typeof onQuote==='function')onQuote('mini-market-last',last.price,{symbol,time:last.time,sourceId:entry.key});
      label.textContent='آخر أسعار مسجلة · '+(entry.source||'المصدر');
    }else{
      $('mini-market-last').textContent='—';
      label.textContent='بانتظار بيانات السوق الفعلية';
    }
    caption.textContent=geometry?'حرك الماوس لاستعراض السعر':'يلزم وصول تحديثين حقيقيين';
  }
  function update({symbol,price,time,source,sourceId}) {
    if(!['XAUUSD','BTCUSD'].includes(symbol)||!Number.isFinite(price)||price<=0||!Number.isFinite(time)||time<=0)return;
    const key=String(sourceId||source||symbol);
    let entry=bySymbol.get(symbol);
    if(!entry||entry.key!==key){entry={key,source,samples:[]};bySymbol.set(symbol,entry);}
    const last=entry.samples.at(-1);
    if(!last||time>last.time)entry.samples.push({price,time});
    else if(time===last.time)entry.samples[entry.samples.length-1]={price,time};
    else return; // Never roll the visible price series backward.
    if(entry.samples.length>64)entry.samples.splice(0,entry.samples.length-64);
    render(symbol);
  }
  stage?.addEventListener('pointermove',event=>{
    if(!geometry||!active)return;
    const rect=svg.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width*320;
    const nearest=geometry.points.reduce((a,b)=>Math.abs(a.x-x)<=Math.abs(b.x-x)?a:b);
    guide.setAttribute('d','M'+nearest.x.toFixed(1)+' 8 V94');
    dot.setAttribute('cx',nearest.x);dot.setAttribute('cy',nearest.y);
    guide.hidden=false;dot.hidden=false;
    const time=new Date(nearest.time*1000).toLocaleTimeString(document.documentElement?.lang==='en'?'en-GB':'ar-PS',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Gaza'});
    caption.textContent=formatPrice(nearest.price)+' · '+time;
    if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
      const xrel=Math.max(-.5,Math.min(.5,(event.clientX-rect.left)/rect.width-.5));
      const yrel=Math.max(-.5,Math.min(.5,(event.clientY-rect.top)/rect.height-.5));
      card.style.setProperty('--tilt-x',(-yrel*3).toFixed(2)+'deg');
      card.style.setProperty('--tilt-y',(xrel*3).toFixed(2)+'deg');
    }
  });
  stage?.addEventListener('pointerleave',()=>{
    guide.hidden=true;dot.hidden=true;
    card.style.setProperty('--tilt-x','0deg');card.style.setProperty('--tilt-y','0deg');
    caption.textContent=geometry?'حرك الماوس لاستعراض السعر':'بانتظار الأسعار الحقيقية';
  });
  return {update,show:render};
}
