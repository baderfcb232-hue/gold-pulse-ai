/* CSV export for authorized users only. Does not transform analysis into trades. */
const cell=value=>{
 const s=String(value??'').replace(/[\r\n\u0000-\u001F\u007F]+/g,' ').trim();
 const safe=/^[=+@-]/.test(s)?"'"+s:s;
 return '"'+safe.replace(/"/g,'""')+'"';
};
const head=['Recorded UTC','Symbol','Source','Analysis status','Decision','Strategy',
 'Indicator alignment / 100','M5','M15','H1','H4','Analysis reason',
 'Indicator checks','Readiness checks','Entry safety checks',
 'Recommendation ID','Entry','Stop loss','TP1','TP2','MT5 deal confirmation','Classification'];
const checks=rows=>Array.isArray(rows)?rows.map(row=>String(row.label||'').slice(0,100)+':'+
 (row.pass===true?'PASS':row.pass===false?'FAIL':'PENDING')).join(' | '):'';
export function analysisHistoryCsv(rows){
 const lines=[head.map(cell).join(',')];
 for(const row of rows.slice(0,1000)){
  const time=Number.isFinite(row.recorded_at)?new Date(row.recorded_at*1000).toISOString():'';
  lines.push([
   time,row.symbol,row.source_type,row.status,row.decision,row.strategy,row.score,
   row.frames?.M5,row.frames?.M15,row.frames?.H1,row.frames?.H4,row.reason,
   checks(row.indicator_checks),checks(row.readiness_checks),checks(row.entry_checks),
   '', '', '', '', '', 'NOT_VERIFIED_OR_LINKED', 'ANALYSIS_ONLY_NOT_TRADE_FILL'
  ].map(cell).join(','));
 }
 return '\uFEFF'+lines.join('\r\n')+'\r\n';
}
export function exportHistoryRows(journal,filters){
 const all=[];let before=null;
 for(let page=0;page<10;page++){
  const response=journal.list({...filters,limit:100,before});
  all.push(...response.items);
  if(!response.next_cursor)break;
  before=response.next_cursor;
 }
 return all.slice(0,1000);
}
