/* NABD Phase 9 — read-only recommendation explainer.
 * Deterministic explanation of real /api/market and /api/signals fields.
 * This is NOT a generative AI trader, execution engine, or win-rate estimator. */
import {summarizeAnalysisMarket} from './analysis-ribbon.js?v=phase6-1';
export const EXPLAINER_SYMBOLS=Object.freeze(['XAUUSD','BTCUSD']);
export const EXPLAINER_QUESTIONS=Object.freeze(['WHY','CHECKS','EXECUTION']);
const T={
 ar:{
  title:'مساعد تفسير التوصيات',note:'شرح من بيانات نبض الحالية، لا يصدر توصيات أو أوامر تداول جديدة.',
  gold:'الذهب',bitcoin:'بيتكوين',why:'ليش بانتظار التوصية؟',checks:'شروط الدخول والفريمات',execution:'هل تنفذت الصفقة؟',
  loading:'بانتظار بيانات التحليل من نبض.',old:'بيانات السوق متأخرة؛ لا يمكن تفسير قرار دخول جديد من قراءة قديمة.',
  source:'المصدر',reference:'مصدر مرجعي، ليس شموع وسيط MT5',broker:'شموع MT5 من الوسيط',
  reasons:'سبب المحرك',notAvailable:'المحرك لم يرسل سببًا إضافيًا لهذه الحالة.',
  noChecks:'لم تصل تفاصيل الشروط لهذا السوق بعد.',failed:'شروط غير مكتملة',passed:'شروط اجتازت الفحص',
  pending:'قيد التحقق',frames:'اتجاه الفريمات',score:'توافق مؤشرات، وليس نسبة ربح',
  waiting:'لا توجد توصية جديدة مؤكدة من هذه القراءة.',active:'ظهرت توصية حالية في بيانات نبض.',
  noSignalHistory:'لا يوجد سجل توصية يمكن التحقق من تنفيذها هنا.',pendingHistory:'سجل التوصيات غير متاح أو لم تُؤكد صلاحية عرضه.',
  referenceSignal:'هذه توصية مرجعية، وليست دليلًا على صفقة منفذة في MT5.',
  lastSignal:'آخر توصية مسجلة',notExecution:'صدور التوصية أو إرسالها إلى MT5 لا يعني فتح صفقة.',
  filled:'تم توثيق فتح الصفقة بتذكرة من سجل الوسيط',submitted:'أُرسل الأمر، ولا توجد صفقة مؤكدة من الوسيط',
  dispatched:'وصل الأمر إلى الجسر، ولم يثبت تنفيذه بعد',rejected:'رفض MT5 الأمر',
  blocked:'مُنع إرسال الأمر',missing:'لا تتوفر بيانات تنفيذ مؤكدة في هذا العرض؛ قد يلزم دخول المشغّل للتحقق.',deal:'تذكرة الوسيط',
  noteCurrent:'الشرح يعكس حالة السوق الحالية، وليس إعادة بناء لتحليل وقت التوصية.',
  chart:'فتح الشارت',history:'سجل التحليلات',
  staleSignals:'حالة تنفيذ التوصية لا تُستنتج من تغير السعر.'
 },
 en:{
  title:'Recommendation explainer',note:'Evidence-based explanation from NABD data; no new signals or trading commands.',
  gold:'Gold',bitcoin:'Bitcoin',why:'Why is the signal waiting?',checks:'Entry gates and timeframes',execution:'Was the trade filled?',
  loading:'Waiting for NABD market analysis.',old:'Market data is stale; no fresh entry decision can be explained.',
  source:'Source',reference:'Reference market data, not MT5 broker candles',broker:'MT5 broker candles',
  reasons:'Engine reason',notAvailable:'The engine has not supplied a further reason for this state.',
  noChecks:'Condition details are not available for this market.',failed:'Incomplete checks',passed:'Passing checks',
  pending:'Awaiting checks',frames:'Timeframe directions',score:'Indicator alignment, not profit probability',
  waiting:'No confirmed new published signal from this snapshot.',active:'A current signal is published in NABD.',
  noSignalHistory:'No recommendation history is available to verify execution.',pendingHistory:'Recommendation history unavailable or access not confirmed.',
  referenceSignal:'This is a reference signal, not proof of an MT5 broker trade.',
  lastSignal:'Most recent recorded signal',notExecution:'Publishing or sending an MT5 order does not prove a broker fill.',
  filled:'Broker fill confirmed by deal ticket',submitted:'Order submitted, broker fill not confirmed',
  dispatched:'Order reached bridge; fill not confirmed',rejected:'MT5 rejected the order',
  blocked:'Dispatch blocked',missing:'No confirmed execution record accessible here; operator verification may be required',deal:'Broker deal ticket',
  noteCurrent:'This explanation reflects current market conditions, not a replay of the original decision.',
  chart:'Open chart',history:'Analysis history',staleSignals:'Execution cannot be inferred from price movements.'
 }
};
const short=v=>typeof v==='string'?v.replace(/[\u0000-\u001F\u007F]/g,' ').trim().slice(0,220):'';
export function safeExecutionStatus(signal,locale='ar'){
 const t=T[locale==='en'?'en':'ar'],tr=signal?.execution_trace;
 // MT5 deal tickets may arrive as a JSON string or a safe JSON integer.
 // Never coerce an unsafe IEEE-754 number into a seemingly verified ticket.
 const rawTicket=tr?.broker_deal_ticket;
 const ticket=typeof rawTicket==='string'?rawTicket:
  typeof rawTicket==='number'&&Number.isSafeInteger(rawTicket)&&rawTicket>0?String(rawTicket):null;
 const validTicket=typeof ticket==='string'&&/^[1-9][0-9]{0,19}$/.test(ticket);
 if(!tr)return {kind:'UNVERIFIED',message:t.missing,confirmed:false};
 if(tr.status==='FILLED'&&tr.broker_fill_confirmed===true&&validTicket)
  return {kind:'FILLED',message:t.filled+' · '+t.deal+' #'+ticket,confirmed:true};
 const key=tr.status==='REJECTED'?'rejected':tr.status==='SUBMITTED'?'submitted':
   tr.status==='DISPATCHED'?'dispatched':tr.status==='BLOCKED'?'blocked':'missing';
 return {kind:tr.status||'UNVERIFIED',message:t[key]+
  (tr.status==='REJECTED'&&tr.reason?' · '+short(tr.reason):''),confirmed:false};
}
export function explainNabdRecommendation({symbol='XAUUSD',question='WHY',market=null,serverTime=null,
 signals=null,now=Date.now()/1000,locale='ar'}={}){
 const l=locale==='en'?'en':'ar',t=T[l],symbolName=symbol==='BTCUSD'?t.bitcoin:t.gold;
 if(!EXPLAINER_SYMBOLS.includes(symbol)||!EXPLAINER_QUESTIONS.includes(question))
   return {title:t.title,lines:[t.loading],fresh:false,chart:null};
 const matching=Array.isArray(signals)?signals.filter(s=>s?.symbol===symbol&&
   typeof s.id==='string'&&Number.isFinite(s.issued_at)).sort((a,b)=>b.issued_at-a.issued_at):[];
 const last=matching[0]||null;
 const summarized=summarizeAnalysisMarket(market,{locale:l,nowSeconds:now,serverTime});
 const fresh=Boolean(market&&summarized.fresh),analysis=fresh?market.analysis:null;
 const source=market?.candle_kind==='BROKER_OHLC'?t.broker:t.reference;
 const lines=[];
 if(question==='EXECUTION'){
  if(!Array.isArray(signals))lines.push(t.pendingHistory);
  else if(!last)lines.push(t.noSignalHistory);
  else{
   const code=[last.execution_trace?.signal_code,last.recommendation_code]
    .find(value=>typeof value==='string'&&/^[A-F0-9]{12}$/.test(value));
   lines.push(t.lastSignal+': #'+(code||'—')+' · '+(last.side||'—'));
   lines.push(typeof last.source==='string'&&last.source&&!last.source.startsWith('MT5')?
     t.referenceSignal:safeExecutionStatus(last,l).message);
   lines.push(t.notExecution);
  }
 }else if(!market)lines.push(t.loading);
 else if(!fresh)lines.push(t.old);
 else if(question==='WHY'){
  const reason=short(analysis?.reason_label||analysis?.reason||'');
  lines.push(summarized.status+(reason?' · '+t.reasons+': '+reason:' · '+t.notAvailable));
  lines.push(t.source+': '+source);
  const plan=market.currentSignal;
  const active=plan?.id&&Number.isFinite(plan.expires_at)&&plan.expires_at>now;
  lines.push(active?t.active:t.waiting);
  lines.push(t.noteCurrent);
 }else{
  const frames=['M5','M15','H1','H4'].filter(tf=>['BUY','SELL','NEUTRAL'].includes(analysis?.frames?.[tf]?.direction))
   .map(tf=>tf+': '+analysis.frames[tf].direction);
  lines.push(t.frames+': '+(frames.join(' · ')||'—'));
  if(Number.isFinite(analysis?.score)&&Array.isArray(analysis?.checks)&&analysis.checks.length)
   lines.push(t.score+': '+Math.round(analysis.score)+'/100');
  const gates=[...(Array.isArray(analysis?.entrySafetyChecks)?analysis.entrySafetyChecks:[]),
   ...(Array.isArray(analysis?.readinessChecks)?analysis.readinessChecks:[]),
   ...(Array.isArray(analysis?.checks)?analysis.checks:[])].filter(c=>c&&typeof c==='object');
  const failing=[...new Set(gates.filter(c=>c.pass===false).map(c=>short(c.name||c.label)).filter(Boolean))].slice(0,4);
  const passed=gates.filter(c=>c.pass===true).length;
  if(!gates.length)lines.push(t.noChecks);
  else{
   lines.push(t.passed+': '+passed+' / '+gates.length);
   lines.push(t.failed+': '+(failing.join(' · ')||t.pending));
  }
  lines.push(t.noteCurrent);
 }
 return {title:t.title+' · '+symbolName,lines,fresh,chart:symbol==='BTCUSD'?'/charts/bitcoin':'/charts/gold',marketStatus:summarized.status};
}
export function initRecommendationExplainer(root=typeof document!=='undefined'?document.getElementById('recommendation-explainer'):null){
 if(!root||typeof root.replaceChildren!=='function')return {updateMarket(){},updateSignals(){}};
 let market=null,marketTime=null,allSignals=null,symbol='XAUUSD',question='WHY';
 const loc=()=>document.documentElement.lang==='en'?'en':'ar';
 const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node;};
 const heading=el('div','recommendation-assistant-heading');
 const title=el('h3'),note=el('small'),selection=el('div','recommendation-assistant-selection');
 const topics=el('div','recommendation-assistant-topics'),result=el('div','recommendation-assistant-result');
 result.setAttribute('role','status');result.setAttribute('aria-live','polite');
 const links=el('div','recommendation-assistant-links'),chart=el('a','recommendation-chart-link'),history=el('a','recommendation-chart-link');
 history.href='/analysis-history';heading.append(title,note);
 root.replaceChildren(heading,selection,topics,result,links);
 function button(group,key,current,label,handler){
  const b=el('button','recommendation-assistant-button',label);
  b.type='button';b.dataset.selected=String(key===current);b.setAttribute('aria-pressed',String(key===current));
  b.addEventListener('click',()=>{handler(key);draw();});
  group.append(b);
 }
 function draw(controls=true){
  const t=T[loc()];title.textContent=t.title;note.textContent=t.note;
  root.setAttribute('aria-label',t.title);
  if(controls){
   selection.replaceChildren();
   for(const value of EXPLAINER_SYMBOLS)button(selection,value,symbol,value==='BTCUSD'?t.bitcoin:t.gold,v=>{symbol=v;});
   topics.replaceChildren();
   for(const value of EXPLAINER_QUESTIONS)button(topics,value,question,t[value.toLowerCase()],v=>{question=v;});
  }
  const explanation=explainNabdRecommendation({symbol,question,market:market?.markets?.[symbol],
   serverTime:marketTime,signals:allSignals,now:Date.now()/1000,locale:loc()});
  result.replaceChildren(...explanation.lines.map(line=>el('p','',line)));
  chart.textContent=t.chart;chart.href=explanation.chart||'/charts/gold';
  history.textContent=t.history;
  links.replaceChildren(chart,history);
  root.dataset.feedState=explanation.fresh?'fresh':'unavailable';
 }
 const relang=()=>draw();document.addEventListener('nabd:language-change',relang);
 const freshness=setInterval(()=>{if(!document.hidden)draw(false);},10000);
 window.addEventListener('pagehide',()=>{clearInterval(freshness);document.removeEventListener('nabd:language-change',relang);},{once:true});
 draw();
 return {
  updateMarket(value){if(value&&value.markets){market=value;marketTime=value.serverTime;draw(false);}},
  updateSignals(value){allSignals=Array.isArray(value)?value:null;draw(false);}
 };
}
