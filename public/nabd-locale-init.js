/* Apply the existing language choice before paint so desktop sidebar does not jump. */
(function(){
  try{
    const chosen=localStorage.getItem('nabd:dashboard:language')||localStorage.getItem('nabd-marketing-language');
    if(chosen==='en'){document.documentElement.lang='en';document.documentElement.dir='ltr';}
    else{document.documentElement.lang='ar';document.documentElement.dir='rtl';}
  }catch{
    document.documentElement.lang='ar';document.documentElement.dir='rtl';
  }
})();
