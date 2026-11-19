// Phase 14 — read-only operational admin reporting. Never accesses MT5 trading
// secrets and never changes subscription/trading permissions.
const bad=(message,status=400)=>{throw Object.assign(Error(message),{status});};
export function adminReportFilters(query={}) {
 const q=query instanceof URLSearchParams?query:new URLSearchParams(query);
 const event=(q.get('event')||'ALL').trim();
 const status=(q.get('status')||'ALL').trim();
 const from=q.get('from')||'',to=q.get('to')||'';
 const limit=Number(q.get('limit')||50),offset=Number(q.get('offset')||0);
 if(!/^(ALL|[A-Z][A-Z0-9_]{1,62})$/.test(event))bad('Invalid audit event filter');
 if(!['ALL','REQUESTED','APPROVED','REJECTED'].includes(status))bad('Invalid hosting status filter');
 if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0||offset>10000)bad('Invalid report pagination');
 for(const day of [from,to])if(day&&!/^\d{4}-\d\d-\d\d$/.test(day))bad('Invalid date format');
 const parse=day=>day?Date.parse(day+'T00:00:00Z')/1000:null;
 const first=parse(from),last=parse(to);
 if(first!=null&&!Number.isFinite(first)||last!=null&&!Number.isFinite(last)||
   (first!=null&&last!=null&&first>last))bad('Invalid date range');
 if(first!=null&&last!=null&&last-first>366*86400)bad('Date range too large');
 return {event,status,from:first,to:last==null?null:last+86400,limit,offset};
}
export function createAdminOperations({store,clock=()=>Date.now()/1000}={}){
 if(!store?.query)throw Error('Persistent accounts store required');
 async function overview(){
  const now=clock();
  const [users,requests,monitor,latestAudit,backups]=await Promise.all([
   store.query('SELECT status,COUNT(*) AS total FROM nabd_users GROUP BY status'),
   store.query('SELECT status,COUNT(*) AS total FROM nabd_mt5_hosting_requests GROUP BY status'),
   store.query(`SELECT COUNT(*) AS registered,
    SUM(CASE WHEN w.account_id IS NOT NULL THEN 1 ELSE 0 END) AS workers,
    SUM(CASE WHEN w.last_seen_at IS NOT NULL AND w.last_seen_at>=?
      THEN 1 ELSE 0 END) AS fresh_workers,
    SUM(CASE WHEN w.last_seen_at IS NOT NULL AND w.last_seen_at>=? AND w.mt5_online=1
      THEN 1 ELSE 0 END) AS reported_online
    FROM nabd_member_mt5_accounts a LEFT JOIN nabd_mt5_monitor_workers w ON w.account_id=a.id`,
      [now-60,now-60]),
   store.query('SELECT time,event FROM nabd_auth_audit ORDER BY time DESC LIMIT 1'),
   store.query("SELECT value FROM nabd_auth_settings WHERE key='last_backup'")
  ]);
  return {generatedAt:now,
   users:Object.fromEntries(users.rows.map(x=>[x.status,Number(x.total)])),
   hosting:Object.fromEntries(requests.rows.map(x=>[x.status,Number(x.total)])),
   monitor:{registered:Number(monitor.rows[0]?.registered||0),
     workers:Number(monitor.rows[0]?.workers||0),
     freshWorkers:Number(monitor.rows[0]?.fresh_workers||0),
     reportedOnline:Number(monitor.rows[0]?.reported_online||0),
     verifiedBrokerConnections:null,tradeExecutionEnabled:false},
   lastAudit:latestAudit.rows[0]||null,
   lastBackupAt:backups.rows[0]?Number(backups.rows[0].value):null,
   note:'MT5 status is from read-only workers, not broker proof or trading readiness'};
 }
 async function audit(params){
  const filter=adminReportFilters(params);
  const where=['1=1'],args=[];
  if(filter.event!=='ALL'){where.push('event=?');args.push(filter.event);}
  if(filter.from!=null){where.push('time>=?');args.push(filter.from);}
  if(filter.to!=null){where.push('time<?');args.push(filter.to);}
  const rows=(await store.query(`SELECT id,time,actor,event,subject
    FROM nabd_auth_audit WHERE ${where.join(' AND ')}
    ORDER BY time DESC,id DESC LIMIT ? OFFSET ?`,[...args,filter.limit,filter.offset])).rows;
  const total=(await store.query(`SELECT COUNT(*) AS n FROM nabd_auth_audit WHERE ${where.join(' AND ')}`,args)).rows[0];
  return {events:rows,total:Number(total?.n||0),limit:filter.limit,offset:filter.offset,
    nextOffset:rows.length===filter.limit?filter.offset+filter.limit:null};
 }
 async function hosting(params){
  const f=adminReportFilters(params);
  const where=['1=1'],args=[];
  if(f.status!=='ALL'){where.push('h.status=?');args.push(f.status);}
  if(f.from!=null){where.push('h.requested_at>=?');args.push(f.from);}
  if(f.to!=null){where.push('h.requested_at<?');args.push(f.to);}
  const rows=(await store.query(`SELECT h.account_id,h.status,h.requested_at,h.reviewed_at,
    a.broker,a.server_name,a.environment,u.name AS member_name,
    w.last_seen_at,w.mt5_online
    FROM nabd_mt5_hosting_requests h
    JOIN nabd_member_mt5_accounts a ON a.id=h.account_id
    JOIN nabd_users u ON u.id=a.user_id
    LEFT JOIN nabd_mt5_monitor_workers w ON w.account_id=h.account_id
    WHERE ${where.join(' AND ')} ORDER BY h.requested_at DESC,h.account_id DESC
    LIMIT ? OFFSET ?`,[...args,f.limit,f.offset])).rows;
  return {requests:rows.map(x=>({...x,monitoringOnly:true,tradeAllowed:false,
     currentObservation:x.last_seen_at!=null&&clock()-Number(x.last_seen_at)<=60?
       (x.mt5_online?'REPORTED_ONLINE':'REPORTED_OFFLINE'):'STALE_OR_UNKNOWN'})),
    nextOffset:rows.length===f.limit?f.offset+f.limit:null};
 }
 return Object.freeze({overview,audit,hosting});
}
