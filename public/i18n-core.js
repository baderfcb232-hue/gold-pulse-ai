/* NABD V2: centralized display translations. Never translate execution identifiers or change API payloads.
   Translation keys belong to presentation; broker/order reasons require exact code-based wording. */
export const SUPPORTED_LOCALES=Object.freeze(['ar','en']);
export const translations=Object.freeze({
  ar:Object.freeze({
    'nav.overview':'الرئيسية','nav.signals':'التوصيات','nav.trades':'الصفقات','nav.news':'الأخبار',
    'nav.results':'النتائج','nav.connection':'الربط','nav.account':'حسابي','nav.settings':'الإعدادات',
    'nav.home':'الرئيسية','nav.privacy':'الخصوصية','nav.admin':'الإدارة',
    'common.loading':'جارٍ التحميل…','common.waiting':'بانتظار البيانات','common.none':'لا توجد بيانات',
    'common.retry':'إعادة المحاولة','common.copy':'نسخ','common.close':'إغلاق','common.open':'فتح',
    'common.refresh':'تحديث','common.save':'حفظ','common.cancel':'إلغاء','common.confirm':'تأكيد',
    'common.success':'نجاح','common.error':'خطأ','common.warning':'تحذير','common.info':'معلومات',
    'common.today':'اليوم','common.yesterday':'أمس','common.todayYesterday':'اليوم وأمس',
    'common.allHistory':'كل السجل','common.duration':'المدة','common.source':'المصدر',
    'theme.title':'المظهر','theme.light':'فاتح','theme.dark':'داكن','theme.system':'النظام',
    'lang.title':'اللغة','lang.ar':'العربية','lang.en':'English',
    'market.gold':'الذهب','market.bitcoin':'بيتكوين','market.price':'السعر',
    'market.ask':'شراء Ask','market.bid':'بيع Bid','market.spread':'السبريد',
    'market.lastUpdated':'آخر تحديث','market.tickSource':'مصدر السعر',
    'market.loadingCandles':'تحميل بيانات الشموع','market.waitingQuotes':'بانتظار أسعار MT5',
    'market.connectionRestored':'عاد الاتصال بالسوق','market.connectionLost':'انقطع استقبال الأسعار',
    'signal.title':'بطاقة التوصية','signal.entry':'الدخول','signal.stop':'وقف الخسارة',
    'signal.target1':'الهدف الأول','signal.target2':'الهدف الثاني',
    'signal.rr':'نسبة المخاطرة إلى العائد','signal.suggestedLot':'اللوت المقترح',
    'signal.risk':'نسبة المخاطرة','signal.expiry':'صلاحية الإشارة','signal.copy':'نسخ مستويات الصفقة',
    'signal.pending':'معلّقة','signal.active':'نشطة','signal.targetHit':'بلغت الهدف',
    'signal.stopHit':'ضربت الستوب','signal.expired':'انتهت الصلاحية',
    'signal.tracking':'قيد المتابعة','signal.queued':'بانتظار MT5',
    'signal.confirmed':'أكد MT5 التنفيذ','signal.rejected':'رُفض الأمر',
    'signal.uncertain':'التأكيد غير مكتمل','signal.waitingConditions':'بانتظار تحقق الشروط',
    'trade.buy':'شراء','trade.sell':'بيع','trade.margin':'الهامش',
    'trade.equity':'حقوق الحساب','trade.freeMargin':'الهامش الحر',
    'trade.lot':'حجم اللوت','trade.orderSubmitted':'تم إرسال طلب MT5؛ لم يتأكد التنفيذ',
    'trade.orderFilled':'تم تأكيد الصفقة من الوسيط',
    'trade.noTrade':'لا توجد صفقة مؤكدة','trade.demo':'تجريبي','trade.live':'حقيقي',
    'auth.signIn':'تسجيل الدخول','auth.signOut':'تسجيل الخروج','auth.signUp':'إنشاء حساب',
    'auth.email':'البريد الإلكتروني','auth.password':'كلمة المرور',
    'auth.mfa':'التحقق بخطوتين','auth.recovery':'استعادة الحساب',
    'news.title':'الأخبار الواردة','news.high':'أهمية مرتفعة',
    'news.medium':'أهمية متوسطة','news.low':'أهمية منخفضة',
    'news.previous':'السابق','news.forecast':'المتوقع','news.actual':'الفعلي',
    'status.connected':'متصل','status.disconnected':'غير متصل',
    'status.stale':'البيانات قديمة','status.waiting':'في الانتظار',
    'status.blocked':'ممنوع التنفيذ','status.ready':'جاهز',
    'ui.translationUnavailable':'الترجمة غير متوفرة لهذا المحتوى الخارجي',
    'ui.tradingRisk':'التداول ينطوي على مخاطر'
  }),
  en:Object.freeze({
    'nav.overview':'Overview','nav.signals':'Signals','nav.trades':'Trades','nav.news':'News',
    'nav.results':'Results','nav.connection':'Connection','nav.account':'My account','nav.settings':'Settings',
    'nav.home':'Home','nav.privacy':'Privacy','nav.admin':'Administration',
    'common.loading':'Loading…','common.waiting':'Waiting for data','common.none':'No data available',
    'common.retry':'Retry','common.copy':'Copy','common.close':'Close','common.open':'Open',
    'common.refresh':'Refresh','common.save':'Save','common.cancel':'Cancel','common.confirm':'Confirm',
    'common.success':'Success','common.error':'Error','common.warning':'Warning','common.info':'Information',
    'common.today':'Today','common.yesterday':'Yesterday','common.todayYesterday':'Today and yesterday',
    'common.allHistory':'Full history','common.duration':'Duration','common.source':'Source',
    'theme.title':'Appearance','theme.light':'Light','theme.dark':'Dark','theme.system':'System',
    'lang.title':'Language','lang.ar':'Arabic','lang.en':'English',
    'market.gold':'Gold','market.bitcoin':'Bitcoin','market.price':'Price',
    'market.ask':'Buy Ask','market.bid':'Sell Bid','market.spread':'Spread',
    'market.lastUpdated':'Last updated','market.tickSource':'Price source',
    'market.loadingCandles':'Loading candles','market.waitingQuotes':'Waiting for MT5 prices',
    'market.connectionRestored':'Market connection restored','market.connectionLost':'Market data connection lost',
    'signal.title':'Signal card','signal.entry':'Entry','signal.stop':'Stop loss',
    'signal.target1':'First target','signal.target2':'Second target',
    'signal.rr':'Risk/reward ratio','signal.suggestedLot':'Suggested lot size',
    'signal.risk':'Risk percentage','signal.expiry':'Signal expiry','signal.copy':'Copy trade levels',
    'signal.pending':'Pending','signal.active':'Active','signal.targetHit':'Target hit',
    'signal.stopHit':'Stop loss hit','signal.expired':'Expired',
    'signal.tracking':'Tracking','signal.queued':'Waiting for MT5',
    'signal.confirmed':'MT5 confirmed execution','signal.rejected':'Order rejected',
    'signal.uncertain':'Execution confirmation incomplete','signal.waitingConditions':'Waiting for conditions',
    'trade.buy':'Buy','trade.sell':'Sell','trade.margin':'Margin',
    'trade.equity':'Account equity','trade.freeMargin':'Free margin',
    'trade.lot':'Lot size','trade.orderSubmitted':'MT5 request sent; execution unconfirmed',
    'trade.orderFilled':'Broker confirmed execution',
    'trade.noTrade':'No confirmed position','trade.demo':'Demo','trade.live':'Live',
    'auth.signIn':'Sign in','auth.signOut':'Sign out','auth.signUp':'Create account',
    'auth.email':'Email address','auth.password':'Password',
    'auth.mfa':'Two-factor authentication','auth.recovery':'Recover account',
    'news.title':'Market news','news.high':'High impact',
    'news.medium':'Medium impact','news.low':'Low impact',
    'news.previous':'Previous','news.forecast':'Forecast','news.actual':'Actual',
    'status.connected':'Connected','status.disconnected':'Disconnected',
    'status.stale':'Stale data','status.waiting':'Waiting',
    'status.blocked':'Execution blocked','status.ready':'Ready',
    'ui.translationUnavailable':'English translation unavailable for this external content',
    'ui.tradingRisk':'Trading involves risk'
  })
});
export function localeOf(value){return value==='en'?'en':'ar'}
export function t(key,locale='ar',variables={}){
  const lang=localeOf(locale),message=translations[lang][key];
  if(message===undefined)throw new Error('Missing NABD translation key: '+key);
  return message.replace(/\{([a-zA-Z]\w*)\}/g,(_,name)=>Object.hasOwn(variables,name)?String(variables[name]):'{'+name+'}');
}
export function layoutFor(locale){return localeOf(locale)==='en'?{lang:'en',dir:'ltr'}:{lang:'ar',dir:'rtl'}}
export const REJECTION_CODES=Object.freeze({
  101:['مفتاح التداول الآلي مغلق','EA live-trading switch is off'],
  102:['صلاحيات التداول الآلي أو الحساب غير متاحة','MT5 terminal or account trading permission is unavailable'],
  105:['مركز قائم أو حد المراكز والمخاطرة','Open-position or portfolio-risk limit reached'],
  110:['الخبر الاقتصادي يمنع الدخول','High-impact news filter blocks entry'],
  111:['أسعار الوسيط قديمة','Broker quote is stale'],
  112:['انتهت التوصية أو تغير السعر','Signal expired or quote/stop changed'],
  119:['السبريد أو حركة السعر يمنع الدخول','Spread or price movement blocks entry'],
  120:['فشل فحص الوقف أو المخاطرة أو الهامش','Stop distance, risk or margin check failed'],
  121:['رفض الوسيط طلب التداول','Broker rejected the trade request'],
  124:['اللوت بعد ضبط التذبذب أقل من أدنى حجم','Volatility-adjusted lot is below broker minimum'],
  125:['مسافة الوقف أقرب من حدود الوسيط','Stop loss is inside broker minimum distance'],
  126:['تعذر حساب خسارة الوقف','Broker could not calculate stop-loss exposure'],
  127:['مخاطرة الصفقة تتجاوز الحد','Trade risk budget would be exceeded'],
  128:['مخاطرة المراكز المفتوحة تتجاوز الحد','Combined open-position risk limit reached'],
  129:['الهامش المتاح غير كافٍ','Insufficient free margin or margin-use limit exceeded']
});
export function rejectionText(code,locale='ar'){
  const details=REJECTION_CODES[Number(code)];
  return details?details[localeOf(locale)==='en'?1:0]:t('signal.rejected',locale);
}
