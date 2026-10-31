// Read-only chart for MT5 closed OHLC. Never submits trades or creates quotes.
export function drawBrokerCandles(canvas, payload, levels = []) {
  const rect=canvas.getBoundingClientRect(), W=Math.max(300,Math.floor(rect.width)), H=Math.max(300,Math.floor(rect.height));
  if (!canvas.getContext || !rect.width) return;
  const dpr=Math.min(2,window.devicePixelRatio||1);
  canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);
  const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#0c151d';ctx.fillRect(0,0,W,H);
  const rows=(payload?.candles||[]).filter(c=>[c.open,c.high,c.low,c.close,c.time].every(Number.isFinite)).slice(-Math.max(25,Math.floor((W-85)/9)));
  if (!rows.length) return;
  const left=10,right=W-74,top=20,bottom=H-32,plotH=bottom-top,step=(right-left)/rows.length;
  const quotes=[payload?.quote?.bid,payload?.quote?.ask].filter(Number.isFinite);
  const prices=rows.flatMap(x=>[x.high,x.low]).concat(quotes,levels.map(x=>x.value).filter(Number.isFinite));
  let lo=Math.min(...prices),hi=Math.max(...prices);const pad=Math.max((hi-lo)*.09,Number(payload?.point)||.01);lo-=pad;hi+=pad;
  const y=v=>bottom-(v-lo)/(hi-lo)*plotH;
  ctx.lineWidth=1;ctx.strokeStyle='rgba(165,148,194,.14)';ctx.fillStyle='#a59bb5';ctx.font='11px sans-serif';
  for(let i=0;i<=5;i++){const value=lo+(hi-lo)*i/5,yy=y(value);ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(right,yy);ctx.stroke();ctx.fillText(value.toFixed(Math.min(5,Math.max(2,payload?.digits??2))),right+7,yy+3);}
  rows.forEach((c,i)=>{const x=left+step*(i+.5),up=c.close>=c.open;ctx.strokeStyle=up?'#6ad3b3':'#ed778e';ctx.fillStyle=ctx.strokeStyle;
    ctx.beginPath();ctx.moveTo(x,y(c.high));ctx.lineTo(x,y(c.low));ctx.stroke();
    const bodyTop=y(Math.max(c.open,c.close)),bodyBottom=y(Math.min(c.open,c.close));
    ctx.fillRect(x-Math.min(5,step*.34),bodyTop,Math.max(2,Math.min(10,step*.68)),Math.max(1,bodyBottom-bodyTop));});
  const labels=[...levels];
  if(Number.isFinite(payload?.quote?.bid))labels.push({name:'Bid',value:payload.quote.bid,color:'#73d9b7'});
  if(Number.isFinite(payload?.quote?.ask))labels.push({name:'Ask',value:payload.quote.ask,color:'#ed9f65'});
  for(const line of labels){if(!Number.isFinite(line.value))continue;const yy=y(line.value);ctx.strokeStyle=line.color||'#b89bff';ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(right,yy);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=ctx.strokeStyle;ctx.font='bold 11px sans-serif';ctx.fillText(line.name,left+7,Math.max(top+10,Math.min(bottom-4,yy-4)));}
  ctx.fillStyle='#9a91a8';ctx.font='11px sans-serif';
  [0,Math.floor((rows.length-1)/2),rows.length-1].forEach(i=>{const x=left+(i+.5)*step;ctx.fillText(new Date(rows[i].time*1000).toISOString().slice(11,16),Math.min(right-40,x),H-9);});
  canvas.onpointermove=e=>{const i=Math.max(0,Math.min(rows.length-1,Math.floor((e.offsetX-left)/step)));const c=rows[i];canvas.title=`MT5 ${payload.broker_symbol} · ${new Date(c.time*1000).toISOString()}\nO ${c.open} H ${c.high} L ${c.low} C ${c.close}`;};
}
