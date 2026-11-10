// Optional, read-only US economic calendar. No credential or release value exposed to public routes.
export function parseCalendar(raw,now){
 if(!Array.isArray(raw))throw Error('NEWS_PROVIDER_RESPONSE');
 const events=[];
 for(const row of raw){
  if(!row||String(row.Country||'').toLowerCase()!=='united states'||Number(row.Importance)!==3)continue;
  const id=String(row.CalendarId||'');
  const title=String(row.Event||'').slice(0,160);
  const publishedAt=Date.parse(String(row.LastUpdate||'')+'Z')/1000;
  const eventAt=Date.parse(String(row.Date||'')+'Z')/1000;
  if(!/^[0-9]{1,30}$/.test(id)||!title||!Number.isFinite(eventAt)||!Number.isFinite(publishedAt))continue;
  if(eventAt>now+86400||publishedAt>now||publishedAt<eventAt-86400*30)continue;
  const hasActual=typeof row.Actual==='string'&&row.Actual.trim().length>0;
  // LastUpdate is only vendor record update, not guaranteed first publication time.
  // Therefore NOT eligible as an independently verified urgent news trigger.
  events.push({id,title,eventAt,publishedAt,highImpact:true,
   actualAvailable:hasActual,forecastAvailable:!!String(row.Forecast||'').trim(),
   actualRaw:typeof row.Actual==='string'?row.Actual.slice(0,50):null,
   forecastRaw:typeof row.Forecast==='string'?row.Forecast.slice(0,50):null,
   previousRaw:typeof row.Previous==='string'?row.Previous.slice(0,50):null,
   verified:false,symbol:'ALL',reason:'RELEASE_TIME_UNVERIFIED',
   source:'TRADING_ECONOMICS_CALENDAR_REFERENCE'});
 }
 return events.slice(0,100);
}
export async function fetchCalendarReference({key,fetcher=fetch,now=Math.floor(Date.now()/1000)}={}){
 if(!key||typeof key!=='string')throw Error('NEWS_PROVIDER_NOT_CONFIGURED');
 const u=new URL('https://api.tradingeconomics.com/calendar/country/united%20states');
 u.searchParams.set('c',key);
 u.searchParams.set('importance','3');
 u.searchParams.set('f','json');
 const response=await fetcher(u.toString(),{signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error('NEWS_PROVIDER_HTTP_'+response.status);
 return {source:'TRADING_ECONOMICS_CALENDAR_REFERENCE',timestamp:now,
  events:parseCalendar(await response.json(),now),verifiedForImmediateTrigger:false,
  providerReleaseLatencyUnverified:true};
}
