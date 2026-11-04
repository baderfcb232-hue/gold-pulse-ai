/* Browser-only notifications for independently observed events. Bounded and in-memory. */
export function createToastCenter({getContainer,createNode,getHistory=()=>null,clock=Date.now}){
 const recent=new Map(),records=[];
 const allowed=new Set(['error','success','warning','info']);
 const asText=v=>String(v??'').slice(0,320);
 function push(message,kindOrOptions=false){
   const opts=typeof kindOrOptions==='object'&&kindOrOptions!==null?kindOrOptions:{kind:kindOrOptions?'error':'info'};
   const kind=allowed.has(opts.kind)?opts.kind:'info';
   const msg=asText(message);
   if(!msg)return false;
   const key=String(opts.eventKey||kind+':'+msg).slice(0,380),now=clock();
   if(recent.has(key)&&now-recent.get(key)<18000)return false;
   recent.set(key,now);
   for(const [k,t] of recent)if(now-t>60000)recent.delete(k);
   if(recent.size>64)recent.delete(recent.keys().next().value);
   const host=getContainer();
   if(!host)return false;
   const box=createNode('div','toast '+kind);
   box.dataset.message=msg;box.dataset.kind=kind;box.dataset.eventKey=key;
   const dot=createNode('i','toast-dot');dot.setAttribute('aria-hidden','true');
   const label=createNode('span','toast-message',msg);
   const close=createNode('button','','×');close.type='button';
   close.setAttribute('aria-label','Close notification / إغلاق التنبيه');
   close.onclick=()=>box.remove();
   box.append(dot,label,close);
   const visible=[...host.children];
   if(visible.length>=3){
     const removable=visible.find(el=>el.dataset.kind!=='error')||visible[0];
     removable?.remove();
   }
   host.append(box);
   if(kind!=='error'){
     const timer=setTimeout(()=>{if(box.parentNode)box.remove();},9000);
     timer?.unref?.(); // Node regression tests should not wait for cosmetic UI timers.
   }
   const entry={kind,message:msg,time:now};
   records.unshift(entry);if(records.length>40)records.length=40;
   const history=getHistory();
   if(history){
     const row=createNode('li','',new Date(now).toLocaleTimeString()+' · '+msg);
     row.dataset.kind=kind;
     history.prepend(row);
     while(history.children.length>40)history.lastElementChild.remove();
   }
   return true;
 }
 return {push,history:()=>records.slice()};
}
