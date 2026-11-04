/* Date-only display filters for signals. Never delete historical records. */
const calendar=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Gaza',year:'numeric',month:'2-digit',day:'2-digit'});
export function gazanDay(unixSeconds){
  if(!Number.isFinite(unixSeconds)||unixSeconds<=0)return null;
  const parts=calendar.formatToParts(new Date(unixSeconds*1000));
  const get=type=>parts.find(p=>p.type===type)?.value;
  return [get('year'),get('month'),get('day')].join('-');
}
export function inSignalDateRange(issuedAt,range,serverNow){
  if(range==='ALL')return true;
  const today=gazanDay(serverNow),date=gazanDay(Number(issuedAt));
  if(!today||!date)return false;
  const [year,month,day]=today.split('-').map(Number);
  const yesterday=new Date(Date.UTC(year,month-1,day)-86400000).toISOString().slice(0,10);
  if(range==='TODAY')return date===today;
  if(range==='YESTERDAY')return date===yesterday;
  return range==='TWO_DAYS'&&(date===today||date===yesterday);
}
