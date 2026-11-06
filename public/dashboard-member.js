/* Read-only member and system summary. Never requests trade credentials or commands. */
(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const safe=(s,max=80)=>typeof s==='string'?s.slice(0,max):'';
  const dict={ar:{guest:'زائر',member:'حساب مشترك',admin:'مسؤول',operator:'مشغل',connected:'متصل',delayed:'متأخر',offline:'غير متصل',unknown:'غير متاح',notVerified:'غير متحقق',signIn:'سجّل الدخول لعرض بيانات حسابك. معلومات السوق عامة، ولا تؤكد تنفيذ صفقات.',private:'الرصيد والصفقات الخاصة لا تظهر إلا داخل حساب مخوّل.',signal:'التوصيات المسجلة (إجمالي)',trades:'خاصة بالحساب'},en:{guest:'Guest',member:'Member account',admin:'Administrator',operator:'Operator',connected:'Connected',delayed:'Delayed',offline:'Disconnected',unknown:'Unavailable',notVerified:'Unverified',signIn:'Sign in to view account details. Market data is public, not proof of trade execution.',private:'Balances and positions are only available in an authorized account.',signal:'Recorded signals (all-time)',trades:'Account-specific'}};
  let account=null,state=null,markets=null;
  const lang=()=>document.documentElement.lang==='en'?'en':'ar';
  const displayStatus=(v,t)=>v==='LIVE'?t.connected:['STALE','DELAYED'].includes(v)?t.delayed:v==='NO_DATA'||v==='DISCONNECTED'||v==='ERROR'?t.offline:t.unknown;
  function paint(){
    const t=dict[lang()];
    $('phase3-member-name').textContent=safe(account?.name)||t.guest;
    $('phase3-member-access').textContent=account?(account.role==='admin'?t.admin:account.role==='operator'?t.operator:t.member):t.guest;
    $('phase3-mt5-status').textContent=displayStatus(state?.connection,t);
    $('phase3-gold-status').textContent=displayStatus(markets?.XAUUSD?.connection,t);
    $('phase3-btc-status').textContent=displayStatus(markets?.BTCUSD?.connection,t);
    // The operator-only Telegram endpoint requires separate authorization.
    // Never interpret a public notification or a configured URL as a live connection.
    $('phase3-telegram-status').textContent=t.notVerified;
    $('phase3-signal-count').textContent=Number.isSafeInteger(state?.historyCount)&&state.historyCount>=0?String(state.historyCount):'—';
    $('phase3-signal-count').title=t.signal;
    $('phase3-trade-count').textContent='—';
    $('phase3-trade-count').title=t.trades;
    $('phase3-member-caption').textContent=account?t.private:t.signIn;
  }
  async function json(path,options){try{const r=await fetch(path,{credentials:'same-origin',cache:'no-store',...options});return r.ok?await r.json():null;}catch{return null;}}
  let inFlight=false;
  async function refresh(){if(inFlight)return;inFlight=true;try{
    const [member,market,snapshot]=await Promise.all([json('/api/auth/me'),json('/api/market'),json('/api/state')]);
    account=member?.user||null;markets=market?.markets||null;state=snapshot||null;paint();
  }finally{inFlight=false;}}
  if(!$('phase3-member-name'))return;
  paint();refresh();
  const interval=setInterval(()=>{if(!document.hidden)refresh();},15000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  const observer=new MutationObserver(paint);observer.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  window.addEventListener('pagehide',()=>{clearInterval(interval);observer.disconnect();},{once:true});
})();
