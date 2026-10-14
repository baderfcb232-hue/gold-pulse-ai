export const researchCatalog = {
  reviewedAt: '2026-10-14', scope: 'مراجعة مختارة لمصادر أصلية؛ ليست مسحًا لكل الإنترنت أو ترتيبًا لأفضل متداول في العالم.',
  sources: [
    {id: 'seykota', title: 'Ed Seykota · Trading System Project', url: 'https://www.seykota.com/tribe/TSP/EA/index.htm',
      finding: 'مثال تعليمي منشور لتقاطع متوسطين أسيين، شراء فقط، وإشارة بعد الإغلاق وتنفيذ في اليوم التالي. يعرض أثر الانزلاق وحجم المركز.',
      limit: 'مثال تاريخي على S&P، وليس كشفًا لخوارزميته الحالية ولا إثباتًا لنتائج الذهب أو بيتكوين.'},
    {id: 'turtle', title: 'Curtis Faith · Original Turtle Trading Rules', url: 'https://www.pipsafe.com/Forex-E-Books/turtlerules.pdf',
      finding: 'قواعد كتبها أحد المشاركين الأصليين: اختراقات20 و55 يومًا، قياس التذبذب N، وقف2N، وخروج قنوات10 أو20 يومًا حسب النظام.',
      limit: 'نسخة مستضافة من الوثيقة الأصلية. نموذج نبض يبسّط فرع55 إلى إغلاق يومي دون تعزيز؛ لا يعيد النظام الأصلي كاملًا.'},
    {id: 'aqr', title: 'Moskowitz / Ooi / Pedersen · Time Series Momentum', url: 'https://www.aqr.com/Insights/Research/Journal-Article/Time-Series-Momentum',
      finding: 'بحث منشور درس الزخم الزمني في58 عقدًا آجلًا وفوروارد عبر عدة فئات أصول، باستخدام تاريخ يتجاوز25 عامًا وأفق عائد سابق12 شهرًا.',
      limit: 'الدليل متعلق بعينة وآفاق زمنية محددة؛ لا يثبت نسبة نجاح لسكالبينغM1 أو لعقدCFD منفرد. لا يحاكي المختبر هذه المحفظة.'},
    {id: 'winton', title: 'Winton · What is trend following?', url: 'https://www.winton.com/news/what-is-trend-following',
      finding: 'تطبيق قواعد اتجاه على أسواق متنوعة، مع شراء وبيع وحجم مركز يرتبط بالتذبذب. الاستجابة لحركة السوق أساس المنهج.',
      limit: 'شرح مؤسسي عام؛ لا يكشف المعلمات الخاصة للصندوق. اتفاق نماذج الاتجاه لا يُحسب كإشارات مستقلة.'},
    {id: 'harding', title: 'Winton · David Harding', url: 'https://www.winton.com/leaders/david-harding',
      finding: 'تعريف رسمي بمؤسسWinton وأحد مؤسسيAHL؛ أُدرج مثالًا على المنهج الكمي المؤسسي.',
      limit: 'الشهرة وحجم الشركة لا يثبتان أن تقليد مؤشر معيّن سيحقق النتيجة نفسها في حساب آخر.'},
    {id: 'bollinger', title: 'John Bollinger · Bollinger Band Rules', url: 'https://www.bollingerbands.com/bollinger-band-rules',
      finding: 'القواعد الأصلية تؤكد أن لمس الحد وحده لا يكفي للدخول، وأن السعر يمكنه الاستمرار بمحاذاة الحد أثناء الاتجاه.',
      limit: 'لا نحول الانحراف المعياري إلى احتمال نجاح95%، ولا نضيف انعكاسًا آليًا عند كل لمس. يلزم نموذج مستقل واختبار لتحديد القواعد.'},
    {id: 'carry', title: 'ECB Working Paper2149 · FX carry strategies', url: 'https://www.ecb.europa.eu/pub/pdf/scpwps/ecb.wp2149.en.pdf',
      finding: 'بحث أصلي في استراتيجيات حمل العملات وفروق منحنيات العائد؛ يدرس تحسين المقايضة بين العائد ومخاطر الانهيار.',
      limit: 'تحتاج فروق فائدة وتكاليف تمويل وعقودًا مناسبة. أسعارOHLC وحدها لا تكفي، لذلك لا يولّد الموقع توصياتCarry.'},
    {id: 'pbo', title: 'Bailey et al. · The Probability of Backtest Overfitting', url: 'https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf',
      finding: 'بحث يوضح خطر انتقاء أفضل نتيجة بعد تجربة بدائل كثيرة، وحدود الاعتماد على تقسيم واحد للاختبار.',
      limit: 'نثبت المعلمات ونكشف الفترات والتكاليف. هذا لا يمثل تطبيقًا كاملًا لاختبارPBO ولا يحوّل التاريخ إلى ضمان.'},
    {id: 'cftc', title: 'CFTC · Commodity Trading Systems', url: 'https://www.cftc.gov/LearnAndProtect/AdvisoriesAndArticles/fraudadv_tradingsystem.html',
      finding: 'الجهة الرقابية تشرح حدود النتائج الافتراضية وأثر السبريد والرسوم واختلاف تنفيذ وقف الخسارة، وتؤكد أن أنظمة التداول لا تضمن الربح.',
      limit: 'لا نعتمد نسبة نجاح معلنة بلا سجل قابل للتحقق؛ نتائج المحاكاة تظهر هنا بوصفها افتراضية.'}
  ],
  families: [
    {name: 'اتباع الاتجاه', state: 'نموذجان تجريبيان في المختبر', note: 'EMA15/150 وDonchian55/20 علىD1. لا يشكلان تنويعًا مستقلًا.'},
    {name: 'الزخم الزمني متعدد الأصول', state: 'مرجع بحثي', note: 'يلزم تاريخ عقود وعوائد وتمويل ومحفظة متنوعة لمقارنة بحثAQR.'},
    {name: 'العودة إلى المتوسط / Bollinger', state: 'قواعد مرجعية؛ دون إرسال', note: 'اللمس وحده ليس دخولًا. لم تثبت صلاحية نموذج انعكاس لبيانات بروكرك.'},
    {name: 'حمل العملات Carry', state: 'بيانات غير مكتملة', note: 'لم تُربط أسعار الفائدة والفوروارد والسواب؛ لا يجوز محاكاته بدقة من السعر وحده.'}
  ]
};
