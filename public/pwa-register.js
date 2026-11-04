/* Display-only PWA registration; never intercepts MT5 trade or market requests. */
(function(){
 if(typeof window==='undefined'||typeof navigator==='undefined'||!('serviceWorker' in navigator)||!window.isSecureContext)return;
 window.addEventListener('load',()=>{
   navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).catch(()=>{
     // App remains online-first if the browser blocks service workers.
   });
 },{once:true});
})();
