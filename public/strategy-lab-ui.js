// Phase 15: local REPORT viewer only. Never uploads files or sends orders.
const $=id=>document.getElementById(id),file=$('lab-file');
let report=null,raw=null;
const metrics=[
 ['trades','عدد الصفقات'],
 ['winRate','نسبة النجاح'],
 ['profitFactor','Profit Factor'],
 ['netR','صافي R'],
 ['maxDrawdownR','أقصى تراجع R'],
 ['meanDurationSeconds','متوسط المدة (ثوانٍ)'],
 ['meanPlannedRR','متوسط R/R المخطط'],
 ['netPerLotCurrency','نتيجة 1 لوت افتراضي']
];
const fmt=(key,val)=>{
 if(val==null||!Number.isFinite(Number(val)))return 'غير متاح';
 const num=Number(val);
 if(key==='winRate')return (num*100).toFixed(1)+'%';
 return num.toLocaleString('en-US',{maximumFractionDigits:3});
};
const node=(tag,text,cls='')=>{
 const element=document.createElement(tag);
 element.textContent=text;element.className=cls;return element;
};
const status=text=>{$('lab-status').textContent=text};
function selected(){
 if(!report)return null;
 const period=$('lab-period').value,cost=$('lab-cost').value;
 return period==='outOfSample'&&cost==='stress' ? report.results.outOfSample.stress
   :report.results[period];
}
function draw(){
 if(!report)return;
 const selectedPeriod=$('lab-period').value,dataset=selected(),base=dataset.baseline,exp=dataset.experimental;
 const stress=selectedPeriod==='outOfSample'&&$('lab-cost').value==='stress';
 $('lab-result-title').textContent=(report.symbol==='XAUUSD'?'الذهب':'بيتكوين')+' · '+
  (selectedPeriod==='development'?'تطوير الاستراتيجية':'خارج العينة')+(stress?' · تكاليف أعلى':'');
 const period=report.results[selectedPeriod];
 $('lab-range').textContent=new Date(period.start*1000).toLocaleDateString('ar-PS')+' — '+
   new Date(period.end*1000).toLocaleDateString('ar-PS')+' · M5 فقط';
 $('lab-metrics').replaceChildren();
 for(const [key,label] of metrics){
  if(!['trades','netR','maxDrawdownR','profitFactor'].includes(key))continue;
  const tile=node('div','','lab-tile');
  tile.append(node('span',label),node('strong',fmt(key,base[key])));
  $('lab-metrics').append(tile);
 }
 $('lab-comparison').replaceChildren();
 for(const [key,label] of metrics){
  const row=document.createElement('tr');
  row.append(node('td',label),node('td',fmt(key,base[key])),node('td',fmt(key,exp[key])));
  $('lab-comparison').append(row);
 }
 $('lab-distribution').replaceChildren();
 const maximum=Math.max(1,...Object.values(base.distribution));
 for(const [label,count] of Object.entries(base.distribution)){
  const bar=node('div','','lab-bar');
  bar.append(node('span',label));
  const track=node('div','','lab-bar-track');
  const fill=node('div','','lab-bar-fill');fill.style.width=(100*count/maximum).toFixed(1)+'%';
  track.append(fill);
  bar.append(track,node('strong',String(count)));
  $('lab-distribution').append(bar);
 }
 $('lab-source').textContent='الوسيط المُعلن: '+report.quality.broker+' · السيرفر: '+report.quality.server+
  ' · الرمز: '+report.brokerSymbol+' · المصدر غير موثّق بشكل مستقل. SHA256: '+(report.inputSha256||'غير متاح');
 $('lab-costs').textContent='سبريد: '+report.assumptions.spreadPoints+
  ' نقطة · انزلاق: '+report.assumptions.slippagePoints+
  ' نقطة · عمولة ذهاب وعودة: '+report.assumptions.roundTripCommissionPerLot+
  ' لكل لوت · الأخبار: معطّلة في هذا الاختبار · لا يُستخدم الحساب الحقيقي';
 $('lab-warnings').replaceChildren(...report.warnings.map(w=>node('li',w)));
}
function controls(ready){
 for(const id of ['lab-market','lab-period','lab-cost','lab-download'])$(id).disabled=!ready;
 $('lab-results').hidden=!ready;
}
file.onchange=async()=>{
 controls(false);report=null;raw=null;
 const entry=file.files?.[0];
 if(!entry)return status('لم يتم اختيار ملف.');
 if(entry.size>2*1024*1024)return status('ملف التقرير كبير جدًا، الحد 2 ميغابايت.');
 try{
  const text=await entry.text(),data=JSON.parse(text);
  if(data.kind!=='NABD_OFFLINE_STRATEGY_LAB_V1'||
    !['XAUUSD','BTCUSD'].includes(data.symbol)||
    !data.results?.outOfSample?.stress||
    !data.results?.development?.baseline||
    !Array.isArray(data.warnings)||data.assumptions?.tradingEnabled!==false)
    throw Error('ليس تقرير مختبر معتمد البنية');
  report=data;raw=text;controls(true);
  $('lab-market').replaceChildren(node('option',data.symbol));
  $('lab-market').options[0].value=data.symbol;
  $('lab-period').value='outOfSample';$('lab-cost').value='normal';
  status('تم تحميل تقرير تاريخي محلي. المصدر غير موثق من وسيط بشكل مستقل.');
  draw();
 }catch(error){status('تعذر قراءة التقرير: '+error.message);}
};
for(const id of ['lab-period','lab-cost'])$(id).onchange=draw;
$('lab-download').onclick=()=>{
 if(!raw)return;
 const url=URL.createObjectURL(new Blob([raw],{type:'application/json;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download='NABD_Strategy_Lab_Report.json';
 document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
};
controls(false);