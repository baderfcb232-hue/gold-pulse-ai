/** Read-only subscriber Telegram readiness probe. Never expose bot token or webhook secret. */
const botName=x=>typeof x==='string'&&/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(x);
const safeHostname=x=>typeof x==='string'&&/^https:\/\/[^/?#]+(?:\/[^?#]*)?$/.test(x);
const WAIT=Object.freeze({ready:false,state:'NOT_CONFIGURED',botVerified:false,webhookVerified:false});
export async function subscriberTelegramReadiness({
  token='',username='',webhookSecret='',siteUrl='',fetcher=fetch
}={}){
  const base=safeHostname(siteUrl)?siteUrl.replace(/\/$/,''):null;
  if(!token||!botName(username)||typeof webhookSecret!=='string'||webhookSecret.length<16||!base)
    return {...WAIT};
  const endpoint=base+'/api/telegram/subscriber-webhook';
  const request=async method=>{
    const response=await fetcher('https://api.telegram.org/bot'+token+'/'+method,{method:'POST',
      headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(7000)});
    if(!response.ok)throw Error('BOT_UNAVAILABLE');
    const packet=await response.json();
    if(packet?.ok!==true||!packet.result)throw Error('BOT_UNAVAILABLE');
    return packet.result;
  };
  try{
    const me=await request('getMe');
    if(me.is_bot!==true||String(me.username||'').toLowerCase()!==username.toLowerCase())
      return {ready:false,state:'BOT_IDENTITY_MISMATCH',botVerified:false,webhookVerified:false};
    const webhook=await request('getWebhookInfo');
    // Telegram does not return webhook secret_token; never claim its value is verified here.
    if(webhook.url!==endpoint)return {ready:false,state:'WEBHOOK_URL_MISMATCH',botVerified:true,webhookVerified:false};
    if(webhook.has_custom_certificate===true)
      return {ready:false,state:'WEBHOOK_CUSTOM_CERTIFICATE',botVerified:true,webhookVerified:false};
    if(Number(webhook.pending_update_count)>100)
      return {ready:false,state:'WEBHOOK_BACKLOG',botVerified:true,webhookVerified:false};
    if(webhook.last_error_date&&Number(webhook.last_error_date)>0&&
       Date.now()/1000-Number(webhook.last_error_date)<3600)
      return {ready:false,state:'WEBHOOK_RECENT_ERROR',botVerified:true,webhookVerified:false};
    return {ready:true,state:'API_READY',botVerified:true,webhookVerified:true,
      secretTokenVerified:false,deliveryVerified:false};
  }catch{
    return {ready:false,state:'TELEGRAM_API_UNAVAILABLE',botVerified:false,webhookVerified:false};
  }
}
