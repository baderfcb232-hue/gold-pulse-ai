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
  const bySymbol=new Map();let active=null,geometry=null,selectedIndex=null;
  function render(symbol) {
    const entry=bySymbol.get(symbol);active=symbol;
    geometry=entry?sparklineGeometry(entry.samples):null;
    line.setAttribute('d',geometry?.path||'');
    empty.hidden=Boolean(geometry);
    guide.hidden=true;dot.hidden=true;selectedIndex=null;
    if(entry?.samples.length) {
      const last=entry.samples.at(-1);
      $('mini-market-last').textContent=formatPrice(last.price);
      if(typeof onQuote==='function')onQuote('mini-market-last',last.price,{symbol,time:last.time,sourceId:entry.key});
      label.textContent='آخر أسعار مسجلة · '+(entry.source||'المصدر');
    }else{
      $('mini-market-last').textContent='—';
      label.textContent='بانتظار بيانات السوق الفعلية';
    }
    caption.textContent=geometry?'المس الشارت أو استخدم الأسهم لاستعراض السعر':'يلزم وصول تحديثين حقيقيين';
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
  function showPoint(index) {
    if(!geometry?.points?.length)return;
    selectedIndex=Math.max(0,Math.min(geometry.points.length-1,index));
    const point=geometry.points[selectedIndex];
    guide.setAttribute('d','M'+point.x.toFixed(1)+' 8 V94');
    dot.setAttribute('cx',point.x);dot.setAttribute('cy',point.y);
    guide.hidden=false;dot.hidden=false;
    const time=new Date(point.time*1000).toLocaleTimeString(document.documentElement?.lang==='en'?'en-GB':'ar-PS',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Gaza'});
    caption.textContent=formatPrice(point.price)+' · '+time;
  }
  function inspectPointer(event) {
    if(!geometry?.points?.length||!Number.isFinite(event.clientX))return;
    const rect=svg.getBoundingClientRect();
    if(!Number.isFinite(rect.width)||rect.width<=0)return;
    const fraction=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));
    const x=8+fraction*304;
    const nearest=geometry.points.reduce((best,p,i)=>Math.abs(p.x-x)<Math.abs(geometry.points[best].x-x)?i:best,0);
    showPoint(nearest);
    if(event.pointerType==='mouse'&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
      const yrel=Math.max(-.5,Math.min(.5,(event.clientY-rect.top)/Math.max(1,rect.height)-.5));
      card.style.setProperty('--tilt-x',(-yrel*3).toFixed(2)+'deg');
      card.style.setProperty('--tilt-y',((fraction-.5)*3).toFixed(2)+'deg');
    }
  }
  function resetPreview(){
    guide.hidden=true;dot.hidden=true;selectedIndex=null;
    card.style.setProperty('--tilt-x','0deg');card.style.setProperty('--tilt-y','0deg');
    caption.textContent=geometry?'المس الشارت أو استخدم الأسهم لاستعراض السعر':'بانتظار الأسعار الحقيقية';
  }
  stage.addEventListener('pointermove',inspectPointer);
  stage.addEventListener('pointerdown',inspectPointer);
  stage.addEventListener('pointerleave',event=>{if(event.pointerType!=='touch')resetPreview();});
  stage.addEventListener('pointercancel',resetPreview);
  stage.addEventListener('keydown',event=>{
    if(!geometry?.points?.length)return;
    const size=geometry.points.length;
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();
    const current=selectedIndex===null?size-1:selectedIndex;
    showPoint(event.key==='Home'?0:event.key==='End'?size-1:current+(event.key==='ArrowLeft'?-1:1));
  });
  return {update,show:render};
}
