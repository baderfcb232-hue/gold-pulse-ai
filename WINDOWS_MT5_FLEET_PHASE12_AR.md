# نبض | المرحلة 12 — تجهيز أسطول MT5 معزول على Windows (مراقبة JustMarkets Demo فقط)

## المنفذ في المصدر
- أداة الفحص windows/nabd_mt5_fleet_preflight.py تفحص قائمة حسابات بدون أسرار. ترفض مشاركة الحساب/العامل/مستخدم Windows/مسار MT5، تداخل المجلدات، المسارات المعاد توجيهها، والحسابات غير التجريبية.
- تستعمل أداة الفحص ملف مالك النسخة الذي ينشئه عامل المراقبة السابق، وتعرض حالة OWNER_BOUND / AWAITING_FIRST_MONITOR_RUN / OWNER_MISMATCH؛ الفحص لا يغيّر الملفات ولا يسجّل دخولًا ولا يفتح صفقة.
- windows/NABD-Monitor.ps1 له إجراء Enroll لالتقاط **رمز مراقبة فقط** بشكل مخفي وتخزينه مشفرًا باستخدام DPAPI للمستخدم الحالي، وإجراء Run لفك الرمز لدى المستخدم نفسه وتشغيل العامل المعزول.
- لكل حساب مستخدم Windows محدود الصلاحيات، نسخة MT5 منفصلة بوضع portable، وعامل مراقبة مستقل. أمر التشغيل لا يحتوي على رمز العامل ولا كلمة مرور الوسيط.
- يبقى خادم Render مسؤولًا عن المصادقة والموافقات وتخزين بصمة رمز المراقبة، وليس عن تشغيل terminal64.exe.
- التداول للمشتركين غير مفعل: tradeAllowed=false، ولا توجد API لتنفيذ صفقات المشتركين في هذه الدفعة. لا تغيير على FUSION أو ضوابط المخاطرة أو تداول المشغّل.

## تشغيل حسابين Demo على Windows VPS المركزي

1. سجّل حسابين JustMarkets Demo لمشتركين مختلفين من /onboarding؛ اطلب الاستضافة، ثم وافق على تجهيزها من /admin بعد تفعيل MFA.
2. جهّز حسابَي Windows مختلفين بدون صلاحية Administrator (مثلاً NABD-demo-a وNABD-demo-b)، مع صلاحيات NTFS منفصلة. لا تعِد استخدام جلسة Windows أو مجلد Data Folder بين الحسابات.
3. ثبّت نسخة MT5 مستقلة لكل حساب في مجلد غير متداخل: C:\NABD-MT5\Instances\demo-a و C:\NABD-MT5\Instances\demo-b، خارج Program Files، مع فصل أذونات المجلدات والمستخدمين. شغّل كل terminal64.exe بوسيط /portable وتأكد من File → Open Data Folder.
4. سجّل الدخول إلى كل حساب **محليًا على Windows لدى المشغّل وبموافقة صاحب الحساب**؛ لا تطلب أو تجمع كلمة مرور التداول أو المستثمر من واجهة نبض أو الدردشة. تأكد أن كلا الحسابين Demo وأن السيرفر ورقم الحساب صحيحان.
5. من /admin إصدار رمز مراقبة للنسخة الأولى، ثم الثانية؛ خزّن account_id وworker_id (غير سريين) في سجل تجهيز داخلي مقيد، وسجّل token **مرة واحدة فقط** عبر Enroll من مستخدم Windows الخاص بتلك النسخة. لا تحفظه بملف JSON أو سجل أو مستودع أو Render Environment.
6. ثبّت Python 64-bit وحزمة MetaTrader5 في سياق مستخدم Windows الذي يشغّل العامل، وأبق ملفات windows/ من نفس مراجعة الكود:
   py -3 -m pip install MetaTrader5
7. افتح PowerShell من جلسة مستخدم Windows المحدد للنسخة، وشغّل:

   powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\windows\NABD-Monitor.ps1 -Action Enroll -AccountId <account_id>

   سيدخِل المشغّل **رمز المراقبة** الذي عرضه /admin في مطالبة مخفية. يجب أن تكون عملية Run لنفس هوية Windows التي نفذت Enroll، لأن DPAPI مرتبط بتلك الهوية.
8. بعد تشغيل MT5 داخل هذا الملف الشخصي، نفذ لكل حساب (مع استبدال القيم ومراعاة المسارات):

   powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\windows\NABD-Monitor.ps1 -Action Run -AccountId <account_id> -WorkerId <worker_id> -Login <demo_login> -Server JustMarkets-Demo2 -TerminalPath "C:\NABD-MT5\Instances\demo-a\terminal64.exe"

   غيّر مجلد demo-a ومستخدم Windows ورقم الحساب وكل المعرفات للحساب الثاني. العامل يتحقق من المسار والهوية والمحفظة التجريبية قبل إرسال اتصال مراقبة؛ لا يرسل أوامر التداول.
9. للتشغيل الدائم يمكن للمشغّل إعداد مهمة Windows Task Scheduler **مستقلة لكل مستخدم/حساب** تستدعي إجراء Run، وضبط إعادة التشغيل ومراقبة الخروج. يجب تجربة عمل MetaTrader5 من جلسة Windows المقصودة عمليًا، لأن جلسات Windows غير التفاعلية قد لا تدعم MT5 كما تتوقع. لا تجعل المهام تعمل بصلاحيات SYSTEM أو Administrator ولا تجعلها تتشارك هوية مستخدم واحدة.
10. بعد وصول نبض المراقبة، افحص حالة كل مشترك في /onboarding. OBSERVED_DEMO حالة مراقبة فقط، وتتحول إلى STALE عند توقف التقرير لأكثر من 45 ثانية.

## ملف فحص الأسطول — بلا أسرار

على Windows أنشئ ملفًا محليًا باسم fleet.json (ليس داخل GitHub) بالتنسيق:

{
  "version": 1,
  "instances": [
    {
      "slot": "demo_a",
      "account_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "worker_id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "broker": "JustMarkets",
      "server": "JustMarkets-Demo2",
      "login": "12345678",
      "environment": "demo",
      "terminal_path": "C:\\NABD-MT5\\Instances\\demo-a\\terminal64.exe",
      "windows_user": "NABD-demo-a"
    },
    {
      "slot": "demo_b",
      "account_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "worker_id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      "broker": "JustMarkets",
      "server": "JustMarkets-Demo2",
      "login": "87654321",
      "environment": "demo",
      "terminal_path": "C:\\NABD-MT5\\Instances\\demo-b\\terminal64.exe",
      "windows_user": "NABD-demo-b"
    }
  ]
}

الأرقام أعلاه أمثلة اختبارية، وليست حسابات فعلية أو رموزًا صالحة. لا تضع token أو كلمة مرور أو أي مفتاح في هذا الملف. لا تشارك الملف علنًا لأنه يحتوي بيانات تعريف حسابات المشتركين.

للفحص:
py -3 windows\nabd_mt5_fleet_preflight.py fleet.json

خروج 0 يعني أن تعريفات العزل سليمة وأن أي ملف مالك موجود يطابق الحساب؛ **لا يعني أن MT5 متصل أو أن الصفقات تعمل**. خروج 1 يدل على فشل فحص أو تعارض. تظهر الحالات بدون أرقام الحسابات أو أسرار.

## اختبارات قبل التوسع
- حسابان يعملان في مجلدين ومستخدمي Windows مختلفين، وحالتهما مستقلة.
- محاولة توجيه العامل الثاني إلى terminal64.exe الأول تفشل؛ إعادة استخدام account_id أو worker_id أو login أو windows_user تفشل في فحص الأسطول.
- الإغلاق/انقطاع الإنترنت للحساب الأول لا يغير حالة الثاني.
- الحساب Real أو تبديل رقم الحساب أو السيرفر أو مجلد MT5 لا يظهر كاتصال Demo صالح.
- إلغاء رمز العامل الأول من /admin يرفض تقريره، دون التأثير على الثاني.
- تعطيل أو حذف المشترك يلغي حقه في تقارير المراقبة، ولا يمنح رمز المراقبة أي صلاحية لتنفيذ صفقة.
- راقب استهلاك CPU وRAM لكل نسخة وحالة إعادة التشغيل على VPS الفعلي؛ **عدد 100 حساب على VPS4 غير مضمون أو مختبر**.

## حدود المرحلة وما تبقى
لم يتم الدخول إلى VPS أو تثبيت MT5 عليه من خلال اتصالات GitHub/Render. نجاح فحص المصدر أو نشر Render لا يثبت اتصال أي منصة Windows. هذه الدفعة لا تدعم إرسال/تنفيذ توصية لدى أي حساب مشترك.

قبل أي تداول Demo مستقل لكل مشترك: يلزم تفويض صريح وقابل للإلغاء من صاحب الحساب، وسر تداول في مخزن Windows مقيد، وعامل تنفيذ بهوية منفصلة عن رمز المراقبة، وجداول أوامر/صفقات مع منع التكرار account_id+signal_id، وإثبات dealer ticket، وحدود مخاطر وإيقاف طارئ مستقل، وتجربة حسابين من البداية للنهاية. قبل التداول الحقيقي يلزم أيضًا مراجعة متطلبات الوسيط والالتزامات القانونية.

لا تستخدم تسجيل الدخول إلى حساب المشغّل الحالي كبديل عن إذن حساب المشترك. لا ترسل أي كلمات مرور أو رمز مراقبة في المحادثة أو لقطات الشاشة.
