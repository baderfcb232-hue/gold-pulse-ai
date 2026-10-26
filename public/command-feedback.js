// UI state only. This tracker never sends or retries a broker command.
export function createCommandTracker() {
  let current = null;
  const busy = () => ['SENDING', 'QUEUED', 'VERIFYING'].includes(current?.status);
  return {
    get: () => current ? {...current} : null,
    busy,
    clear: () => {current = null;},
    begin(action, ticket, now) {
      if (busy()) return false;
      current = {action, ticket: String(ticket), time: now, status: 'SENDING', id: null};
      return true;
    },
    accepted(result) {
      if (!current || current.status !== 'SENDING') return;
      const id=Number(result.id);
      current = {...current, id: Number.isSafeInteger(id)&&id>0?id:null,
        status: Number.isSafeInteger(id)&&id>0?'QUEUED':'VERIFYING'};
    },
    failed(error) {
      if (!current) return;
      // A failed connection may follow a successful enqueue. Reconcile the journal instead of resending.
      const rejected=[401,403,404,405,409,413,429].includes(error?.status);
      current = {...current, status: rejected ? 'FAILED' : 'VERIFYING', result: error?.message || null};
    },
    observe(records, now) {
      if (!current || ['SENDING','FAILED'].includes(current.status) || !Array.isArray(records)) return;
      const record = records.find(c => current.id != null ? Number(c.id) === current.id :
        c.action === current.action && String(c.ticket) === current.ticket && c.time >= current.time - 2 && c.time <= current.time + 20);
      if (record) current = {...current, ...record, id: Number(record.id)};
      else if (current.status === 'VERIFYING' && now > current.time + 25)
        current = {...current, status: 'UNCERTAIN', result: 'لم يظهر تأكيد في سجل الموقع. راجع سجل MT5 قبل تكرار الأمر.'};
    }
  };
}
export function commandResultMessage(result) {
  const messages={
    PAUSE:'تم إيقاف دخول صفقات جديدة.',RESUME:'تم السماح بالدخول التلقائي عند تحقق الشروط.',
    'Expired or invalid command':'انتهت صلاحية الأمر أو كانت بياناته غير صالحة.',
    'Remote control not allowed by the main EA and bridge':'التحكم عن بُعد غير مفعّل في البوت الرئيسي والجسر معًا.',
    'Command already claimed; it will not execute a second time':'استلم MT5 الأمر سابقًا؛ لن يُكرّر التنفيذ.',
    'Execution disabled or trading permissions unavailable':'التنفيذ متوقف أو صلاحيات التداول غير متاحة داخل MT5.',
    'All managed positions closed':'أكد MT5 إغلاق جميع صفقات البوت المرتبطة.',
    'Some positions may remain; inspect MT5':'قد تبقى صفقات مفتوحة؛ تحقق من تبويب Trade في MT5.',
    'Position is not owned by this EA':'هذه الصفقة لا تتبع البوت والرمز المرتبطين.',
    'Partial close requires a hedging account and valid fraction':'الإغلاق الجزئي يحتاج حساب Hedging ونسبة إغلاق صحيحة.',
    'Volume does not support a partial close':'حجم الصفقة أصغر من أن يسمح بإغلاقها جزئيًا.',
    'Break-even would worsen the stop or violates broker distance':'نقل الوقف سيضعف الحماية أو يخالف المسافة التي يسمح بها البروكر.'
  };
  return messages[result] || result || null;
}
export function commandProgress(command, now) {
  if (!command) return null;
  const seconds = Math.max(0, Math.ceil((command.expires ?? command.time + 20) - now));
  const states = {
    SENDING: ['جارٍ إرسال الأمر', 'انتظر استجابة الموقع؛ لم يصل تأكيد MT5 بعد.', 'neutral'],
    QUEUED: ['بانتظار تأكيد MT5', seconds > 0 ? `متبقٍ نحو ${seconds} ثانية لاستلام الأمر. لا تعِد إرساله.` : 'جارٍ تحديث سجل التأكيد؛ لا تعِد إرسال الأمر.', 'neutral'],
    VERIFYING: ['جارٍ التحقق من الإرسال', 'انقطع الاتصال أثناء الطلب. نراجع السجل تلقائيًا، ولن نعيد إرسال الأمر.', 'warn'],
    CONFIRMED: ['أكد MT5 تنفيذ الأمر', 'راجع حالة البوت والصفقات بعد تحديث البيانات.', 'good'],
    REJECTED: ['رفض MT5 الأمر', 'اقرأ السبب أدناه وصحّح الإعداد قبل المحاولة مجددًا.', 'bad'],
    EXPIRED: ['انتهت مهلة الأمر', 'لم يصل تأكيد التنفيذ خلال المهلة. راجع سجل MT5 قبل تكرار الأمر.', 'warn'],
    UNCERTAIN: ['التنفيذ غير مؤكد', 'راجع الصفقات وسجل MT5 قبل تكرار الأمر.', 'warn'],
    FAILED: ['لم يُقبل الطلب', 'صحّح السبب الظاهر ثم حاول مجددًا.', 'bad']
  };
  const [title, detail, tone] = states[command.status] || ['حالة غير معروفة', 'حدّث سجل الأوامر.', 'warn'];
  return {title, detail, tone, result: commandResultMessage(command.result)};
}
export function demoExecutionMessage(state) {
  const x = state?.execution, r = state?.demoExecution;
  if (!x) return 'ننتظر وصول بيانات البوت من MT5.';
  if (!x.demo) return 'تنفيذ توصيات الموقع المضاف مخصّص لحساب JustMarkets Demo.';
  if (state.websiteExecution && !x.website_recommendations)
    return 'لتنفيذ توصيات نبض مباشرة يلزم البوت 1.15 والجسر 3.06، وتفعيل وضع توصيات الموقع. حمّل تحديث MT5 أدناه.';
  if (r?.reason === 'DISABLED') return 'خدمة تنفيذ التوصيات التجريبية موقوفة من إعدادات الموقع.';
  if (r?.reason === 'MT5_UPDATE_REQUIRED' || !x.demo_recommendations)
    return 'يلزم تحديث البوت والجسر في MT5 وتفعيل وضع توصيات Demo داخل البوت.';
  if (x.paused) return 'الدخول موقوف. شغّل الدخول التلقائي للسماح بالتنفيذ عند اكتمال الشروط.';
  if (!x.website_recommendations && x.demo_result === 'SUBMITTED') return 'أرسل البوت آخر طلب تنفيذ. تأكيد الصفقة يظهر في سجل عمليات MT5.';
  if (!x.website_recommendations && x.demo_result === 'BLOCKED') return 'منع MT5 آخر محاولة تنفيذ. راجع سبب المنع في تبويب Experts.';
  if (r?.ready) return 'توصية ذهب معتمدة بانتظار فحص MT5 النهائي.';
  const reasons = {
    STALE_MT5: 'ننتظر بيانات حديثة من البوت قبل السماح بدخول جديد.',
    POSITION_ALREADY_OPEN: 'توجد صفقة مفتوحة؛ ننتظر إغلاقها قبل فرصة جديدة.',
    MT5_EXECUTION_NOT_READY: 'إعدادات التنفيذ أو التحكم في MT5 تحتاج مراجعة.',
    PRICE_OR_SPREAD_MOVED: 'تغيّر السعر أو السبريد؛ ننتظر فرصة مطابقة جديدة.',
    PLAN_NOT_APPROVED: 'ننتظر توصية ذهب معتمدة تستوفي شروط الأخبار والاتجاه والتكلفة.',
    ACCOUNT_NOT_SHARED: 'فعّل مشاركة بيانات الحساب في الجسر لاستكمال فحص التنفيذ.',
    BELOW_MINIMUM_VOLUME: 'تعذّر الدخول: أقل لوت عند البروكر يتجاوز سقف مخاطرة حسابك. يُحسب الحجم تلقائيًا؛ ننتظر فرصة تناسب الحساب.',
    INSUFFICIENT_MARGIN: 'تعذّر الدخول: الهامش المتاح لا يكفي لحجم الصفقة المحسوب.',
    INVALID_RISK_SETTINGS: 'ننتظر نسبة مخاطرة صالحة من إعدادات MT5.',
    INVALID_CONTRACT: 'مواصفات اللوت وقيمة التيك غير مكتملة؛ حساب الحجم معلّق.',
    WAITING_WEBSITE_PLAN: 'وضع توصيات نبض مفعّل؛ ننتظر توصية ذهب جديدة من بيانات حسابك.',
    WAITING_NEW_WEBSITE_PLAN: 'ننتظر توصية تصدر بعد تشغيل وضع الموقع؛ لن ندخل توصية سابقة.',
    WEBSITE_SOURCE_MISMATCH: 'مصدر التوصية لا يطابق حساب الذهب المرتبط؛ التنفيذ موقوف لهذه الخطة.',
    WEBSITE_PLAN_CHANGED: 'تغيّر تكوين التوصية؛ ننتظر شمعة وفرصة جديدة.',
    WAITING_COSTS: 'تكاليف حساب البروكر غير مؤكدة أو السبريد تجاوز الحد.',
    DURABLE_ENTRY_JOURNAL_REQUIRED: 'سجل إرسال الصفقات الدائم غير متاح؛ لا نرسل أمرًا قد يتكرر.'
  };
  const details = [reasons[r?.reason] || 'ننتظر اكتمال شروط توصية الذهب المعتمدة.'];
  if (x.website_recommendations) {
    const b = state.websiteBridge;
    if (r?.reason === 'WAITING_WEBSITE_PLAN' && state.reasons?.[1]) details.push(state.reasons[1]);
    if (b?.connection === 'LIVE') details.push('جسر MT5 يطلب توصيات الموقع فعليًا.');
    else if (b?.connection === 'STALE') details.push('توقف طلب التوصيات من جسر MT5؛ وصول السعر وحده لا يكفي للتنفيذ.');
    else details.push('لم نرصد طلب توصيات من جسر MT5 بعد؛ راجع الجسر إذا استمرت هذه الحالة.');
    if (b?.lastResult === 'SUBMITTED') details.push('آخر محاولة: أبلغ MT5 عن إرسال طلب التنفيذ؛ تأكيد الصفقة من Trade/History.');
    if (b?.lastResult === 'REJECTED') details.push('آخر محاولة: منع MT5 التنفيذ؛ سبب الرفض في Experts.');
    if (b?.lastResult === 'DISPATCHED') details.push('آخر محاولة أُرسلت للجسر ولم يصل رد MT5 بعد؛ لا نكرر إرسالها.');
    if (b?.journalState === 'ERROR') details.push('تعذر قراءة سجل التنفيذ الدائم.');
  }
  return details.join(' ');
}
