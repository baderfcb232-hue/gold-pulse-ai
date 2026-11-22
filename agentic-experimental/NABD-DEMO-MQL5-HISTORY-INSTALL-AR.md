# تثبيت فاحص صفقات نبض MQL5 — Demo فقط

## وظيفة الملف
`NABD_Demo_History_Verifier.mq5` خبير منفصل للقراءة فقط. لا يحتوي على
`OrderSend` أو `CTrade` أو أوامر إغلاق صفقات. يقرأ آخر 15 دقيقة من
History ويبحث عن صفقات نبض فقط بحسب Magic Number للذهب والبيتكوين.
يقرأ رقم Deal ورقم Order واتجاه الصفقة ووقت التنفيذ والحجم وSL/TP
كما سُجلت مع أمر الدخول. يرسل دليلًا موقّعًا إلى بيئة نبض التجريبية فقط.

> لا يعتبر ACK وحده نجاحًا. الخادم يطابق رقم Deal مع ACK الموثق، ومع
> حساب Demo ورمز الوسيط والاتجاه ووقت التنفيذ ووقف الخسارة والهدف.
> قراءة نفس MT5 مرة ثانية ليست شهادة موقّعة مستقلة من شركة الوساطة.

## 1. قبل التشغيل على Windows VPS

- اترك `NABD_Agentic_Demo_Observer` و`NABD_Demo_Trade_Executor` كما هما.
- اعمل نسخة احتياطية من إعدادات MT5 قبل تركيب الملف.
- الحساب يجب أن يكون DEMO فعلًا، لا REAL، ويفضل إدخال رقمه في
  `InpAllowedDemoLogin` داخل الجهاز نفسه.
- الرموز الافتراضية `XAUUSD.m` و`BTCUSD.m`؛ طابقها من Market Watch.
- لا تحتاج Python ولا Windows Installer.

## 2. إعداد سر قناة History التجريبية

أنشئ مفتاحًا جديدًا **مختلفًا** عن أسرار الحساس والمنفّذ والإنتاج.
على Windows PowerShell (محليًا داخل VPS) يمكنك إنشاء مفتاح عشوائي
قوي بهذه الطريقة:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

لا ترسل القيمة في المحادثة ولا تنشرها في GitHub أو صور الشاشة.
ضعها في Render، خدمة `nabd-agentic-ai-test` **التجريبية فقط**،
ضمن Environment، بالاسم:

```text
NABD_TEST_DEMO_HISTORY_HMAC_SECRET
```

ثم ضع **نفس القيمة** محليًا في مدخل الخبير
`InpHistoryHmacSecret`. تجنب حفظ ملف `.set` يحوي السر في مكان مشترك.

إذا لم يتم إعداد هذا السر في الطرفين، فالمسار سيبقى `NOT_CONFIGURED`
ولا يمكن إرسال أي إثبات؛ لا تستخدم سر التنفيذ أو سر الحساس مكانه.

## 3. التركيب والتشغيل

1. في MT5 اضغط F4 لفتح MetaEditor.
2. من File > Open افتح `NABD_Demo_History_Verifier.mq5`، وضعه
   في `MQL5\\Experts` عبر File > Open Data Folder داخل MT5.
3. اضغط F7 للتجميع، وتحقق يدويًا من **0 errors**. لم يتم تجميع هذا
   المصدر على جهاز Windows الحقيقي أثناء إعداد PR.
4. افتح شارت **إضافيًا مستقلًا** عن الشارتات التي عليها المراقب والمنفّذ،
   واسحب عليه الخبير `NABD_Demo_History_Verifier`.
5. اترك `InpEnableHistoryUpload=false` أولًا، وافحص Experts؛
   يجب أن ترى `READ_ONLY_LOCAL`. لا يحتاج الخبير لتفعيل AutoTrading،
   لكنه يحتاج السماح بتشغيل Expert Advisors والاتصال الخارجي عند رفع البيانات.
6. في MT5: Tools > Options > Expert Advisors، أضف هذا العنوان إلى
   WebRequest allowed URLs:
   `https://nabd-agentic-ai-test.onrender.com`
7. بعد إثبات إعداد قناة History التجريبية في Render، غيّر
   `InpEnableHistoryUpload=true` لهذا الخبير فقط.
   تأكد من ظهور `READ_ONLY_VERIFIED_UPLOAD` في Experts، وإلا عالج
   كود HTTP بدون تعطيل التحقق أو تزوير صفقة.

## 4. التحقق

- `https://nabd-agentic-ai-test.onrender.com/demo-history/status`
  يعرض حالة قناة الفاحص، دون عرض كلمات مرور أو أرقام حساب.
- `https://nabd-agentic-ai-test.onrender.com/demo-trade/status`
  يوضح وصول ACK ومؤشر `mt5HistoryCrossCheckedFills`.
- `/demo-trade/history-proofs` يتطلب توثيق عرض خاص، ويعرض الإثباتات
  المحفوظة في PostgreSQL التجريبية (إن كان الاتصال قائمًا).
- لا تتوقع صفقة بعد تشغيل الفاحص وحده؛ عندما يقرر المخ `WAIT`
  ويمنع نظام المخاطرة الأمر، يبقى عدد الإثباتات **صفرًا** وهذا صحيح.
- إذا لم يكن في آخر 15 دقيقة صفقة صالحة تحمل Magic نبض وACK مطابقًا،
  سيظهر `matched=0` وهذا لا يعني عطلًا.
- لا ترسل ملفات الإعداد التي تحتوي على المفتاح، أو كلمة مرور MT5.

## 5. الحدود المهمة

- تتطلب مطابقة صفقة جديدة وصول ACK خلال حياة جلسة المنفّذ الحالية؛
  إن أعيد تشغيل Render وفُقدت delivery/ACK المؤقتة، لا يتم اختلاق
  إثبات قديم. يلزم اختبار استعادة durable ACK مستقبلًا.
- أوقات Deals يضبطها الفاحص إلى UTC باحتساب فرق توقيت خادم الوسيط؛
  إن كان الوقت غير موثوق يفشل الفحص بشكل آمن.
- قد تكون SL/TP في History Order صفراً إذا حُدّثت لاحقًا أو لم يُرسلا
  مع أمر الدخول؛ هذه الحالة لا تُعتمد كإثبات.
- هذا تحقق قراءة ثانٍ من نفس MT5، وليس تأكيدًا مستقلاً موقعًا من الوسيط.
- لا يمكن اختبار إثبات صفقة حقيقية دون أمر Demo مؤهل يمر من المخ
  وبوابة المخاطرة وينفذه الوسيط، ويطابق ACK.
- لا يمس `gold-pulse-ai` Live أو قاعدة الإنتاج، ولا يفعّل التداول الحقيقي.
