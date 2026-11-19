// Phase 14 — MFA-admin-only dashboard enhancement. No trading controls.
const $=id=>document.getElementById(id);
const panel=$('admin-ops-panel'),root=$('admin-content');
const el=(tag,text,cls='')=>{const e=document.createElement(tag);e.textContent=text;e.className=cls;return e};
let auditRows=[],hostingRows=[],initialized=false,loading=false;
const locale=()=>document.documentElement.lang?.startsWith('en')?'en':'ar';
function safeCsvCell(value){
 let s=value==null?'':String(value);
 if(/^[\s\t\r\n]*[=+@-]/.test(s))s="'"+s;
 return '"'+s.replace(/"/g,'""').replace(/\r/g,' ').replace(/\n/g,' ')+'"';
}
function csvText(audit,requests){
 const rows=[['kind','timestamp','event_or_status','subject','actor_or_member','account','observed_state']];
 for(const x of audit)rows.push(['audit',new Date(Number(x.time)*1000).toISOString(),
    x.event,x.subject||'',x.actor||'','','']);
 for(const x of requests)rows.push(['hosting',new Date(Number(x.requested_at)*1000).toISOString(),
    x.status,'',x.member_name||'',x.account_id||'',x.currentObservation||'']);
 return '\uFEFF'+rows.map(row=>row.map(safeCsvCell).join(',')).join('\r\n')+'\r\n';
}
async function get(path){
 const res=await fetch(path,{credentials:'same-origin',cache:'no-store'});
 if(!res.ok)throw Object.assign(Error('HTTP '+res.status),{status:res.status});
 return res.json();
}
function status(message){$('admin-ops-status').textContent=message;}
function fmtTime(ts){return ts==null?'—':new Date(Number(ts)*1000).toLocaleString(locale()==='en'?'en-GB':'ar-PS',{timeZone:'Asia/Gaza'});}
function drawMetric(label,value,details){
 const card=el('div','','summary-tile');
 card.append(el('span',label),el('strong',String(value)),el('small',details));
 return card;
}
function drawKpis(d){
 $('admin-ops-kpis').replaceChildren(
   drawMetric('حسابات مفعلة',d.users.active??0,'حسابات موثقة وغير موثقة'),
   drawMetric('طلبات انتظار',d.hosting.REQUESTED??0,'مراجعة الاستضافة فقط'),
   drawMetric('عامل مراقبة حديث',d.monitor.freshWorkers,'خلال 60 ثانية'),
   drawMetric('تقارير MT5 متصل',d.monitor.reportedOnline,'تقرير عامل، ليس إثبات وسيط'),
   drawMetric('تداول المشتركين',d.monitor.tradeExecutionEnabled?'مفعّل':'غير مفعّل','لا صلاحيات تنفيذ من الإدارة'),
   drawMetric('آخر نسخة احتياطية',fmtTime(d.lastBackupAt),'توقيت آخر حفظ مسجّل')
 );
}
function drawRows(target,rows,kind){
 const wrap=$(target);wrap.replaceChildren();
 if(!rows.length){wrap.append(el('p','لا توجد نتائج للفلاتر المختارة','subtle'));return;}
 const table=document.createElement('table');table.className='users-table';
 const headers=kind==='audit'?['وقت','نوع الحدث','المسؤول','المعرّف']:['تاريخ الطلب','حالة الطلب','اسم المشترك','مراقبة MT5'];
 const head=document.createElement('thead'),h=document.createElement('tr');
 for(const text of headers)h.append(el('th',text));head.append(h);table.append(head);
 const body=document.createElement('tbody');
 for(const item of rows){
  const tr=document.createElement('tr');
  const values=kind==='audit'?[fmtTime(item.time),item.event,item.actor||'—',item.subject||'—']:
    [fmtTime(item.requested_at),item.status,item.member_name||'—',item.currentObservation];
  for(const v of values)tr.append(el('td',String(v??'—')));
  body.append(tr);
 }
 table.append(body);const scroll=el('div','', 'users-table-wrap');scroll.append(table);wrap.append(scroll);
}
const filters=()=>{
 const dateFrom=$('admin-ops-from').value,dateTo=$('admin-ops-to').value,
  event=$('admin-ops-event').value.toUpperCase().trim()||'ALL',
  hosting=$('admin-ops-hosting').value;
 if(!/^(ALL|[A-Z][A-Z0-9_]{1,62})$/.test(event))throw Error('نوع الحدث غير صالح');
 if(dateFrom&&dateTo&&dateFrom>dateTo)throw Error('نطاق التاريخ غير صالح');
 const common=new URLSearchParams({limit:'100',offset:'0'});
 if(dateFrom)common.set('from',dateFrom);
 if(dateTo)common.set('to',dateTo);
 const audit=new URLSearchParams(common),requests=new URLSearchParams(common);
 audit.set('event',event);requests.set('status',hosting);
 return {audit,requests};
};
async function refresh(){
 if(loading)return;loading=true;$('admin-ops-refresh').disabled=true;
 try{
  if(root.hidden)return;
  const f=filters();
  const [summary,audits,requests]=await Promise.all([
    get('/api/admin/operations'),
    get('/api/admin/operations/audit?'+f.audit),
    get('/api/admin/operations/hosting?'+f.requests)
  ]);
  if(root.hidden)return;
  if(!Array.isArray(audits.events)||!Array.isArray(requests.requests))
    throw Error('Invalid report response');
  auditRows=audits.events;hostingRows=requests.requests;
  drawKpis(summary);drawRows('admin-ops-audit',auditRows,'audit');
  drawRows('admin-ops-requests',hostingRows,'hosting');
  status('آخر تحديث: '+fmtTime(summary.generatedAt)+' · التقرير المعروض بحد أقصى 100 نتيجة لكل جدول. لا تأكيد تنفيذ تداول.');
 }catch(err){
  status(err.status===403?'تحتاج جلسة مسؤول والتحقق بخطوتين.':'فشل تحديث التقرير: '+err.message);
  if(err.status===401||err.status===403){
   auditRows=[];hostingRows=[];$('admin-ops-kpis').replaceChildren();
   $('admin-ops-audit').replaceChildren();$('admin-ops-requests').replaceChildren();
  }
 }finally{loading=false;$('admin-ops-refresh').disabled=false;}
}
function start(){
 if(initialized||root.hidden)return;
 initialized=true;
 $('admin-ops-refresh').onclick=refresh;
 $('admin-ops-apply').onclick=refresh;
 $('admin-ops-csv').onclick=()=>{
  if(!auditRows.length&&!hostingRows.length){status('لا توجد بيانات معروضة للتنزيل');return;}
  const file=new Blob([csvText(auditRows,hostingRows)],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(file);
  const link=document.createElement('a');link.href=url;
  link.download='nabd-admin-operations.csv';link.hidden=true;
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),3000);
 };
 void refresh();
}
if(location.pathname==='/admin'&&panel&&root){
 const observer=new MutationObserver(()=>{if(!root.hidden){start();observer.disconnect();}});
 observer.observe(root,{attributes:true,attributeFilter:['hidden']});
 start();
}
