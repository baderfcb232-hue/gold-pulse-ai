import {createHash} from 'node:crypto';

// A short, stable operator reference; the full, account/source-bound signal ID
// remains the database key and is never replaced by this display code.
export function recommendationCode(id) {
  if (typeof id !== 'string' || !id) return null;
  return createHash('sha256').update(id).digest('hex').slice(0, 12).toUpperCase();
}

// One source-bound MT5 deal ticket, returned by the placing EA and then observed
// in the broker's own Trade/History feed, proves an actual entry. SUBMITTED alone
// or a similarly priced deal without the exact ticket is never sufficient.
// Human-readable explanations of safety rejections reported by the GOLD EA.
// An EA denial is never converted into a trade submission or fill.
export const eaRejectReasonDescriptions = Object.freeze({
  101:'مفتاح التداول في EA مغلق',
  102:'صلاحيات Algo Trading أو صلاحيات الحساب غير متاحة في MT5',
  103:'التحكم من الموقع معطّل أو موقوف',
  104:'إيقاف الطوارئ مفعّل',
  105:'صفقة أو أمر معلّق، أو حد المراكز والمخاطرة',
  106:'الدورة السابقة لم تنتهِ',
  107:'خارج جلسة التداول المسموحة',
  108:'فترة انتظار بين الصفقات',
  109:'بلوغ حد الخسارة اليومية',
  110:'حظر الدخول أثناء أخبار عالية التأثير',
  111:'سعر الوسيط قديم أو غير متاح',
  112:'التوصية انتهت أو تغيّرت الشمعة أو الأسعار أو مستويات الوقف',
  113:'مؤشر ATR غير جاهز',
  116:'حماية المراكز أو الصلاحيات تمنع الدخول',
  117:'حجم الصفقة أقل من الحد الأدنى أو غير صالح',
  118:'شمعة الدخول مستخدمة مسبقًا',
  119:'السبريد أو السعر أو إيقاف الطوارئ يمنع الدخول',
  120:'فشل فحص الوقف أو المخاطرة أو الهامش؛ نسخة EA الجديدة تفصل السبب',
  121:'طلب التداول رفضه الوسيط',
  122:'اللوت اليدوي غير مقبول عند الوسيط',
  123:'بيانات ATR أو حد المراكز غير مناسب',
  124:'تخفيض اللوت بسبب تذبذب الذهب جعله أقل من حد الوسيط',
  125:'مسافة وقف الخسارة أقرب من الحد المسموح لدى الوسيط',
  126:'تعذر احتساب خسارة وقف الصفقة',
  127:'الخسارة المحتملة تتجاوز ميزانية المخاطرة',
  128:'المخاطرة الإجمالية للمراكز المفتوحة تتجاوز الحد',
  129:'الهامش المتاح أو الحد الأقصى لا يكفي'
});
export const describeEaRejection = code => Number.isInteger(code) && eaRejectReasonDescriptions[code]
  ? 'رفض MT5: ' + eaRejectReasonDescriptions[code] : 'EA_REJECTED';

export function verifiedBrokerDeal(record, snapshot) {
  if (record?.status!=='SUBMITTED' || !/^[1-9][0-9]{0,19}$/.test(record.deal_ticket||'') ||
      !snapshot?.execution?.demo || !/just.?markets/i.test(snapshot.broker||'') ||
      snapshot.symbol !== record.plan?.broker_symbol ||
      !Array.isArray(snapshot.deals)) return null;
  return snapshot.deals.find(d => d.ticket === record.deal_ticket &&
    d.entry_type === 'IN' && d.side === record.plan.side &&
    d.volume > 0 && d.time >= Number(record.time)-5) || null;
}

// Non-sensitive, per-signal execution state. A SUBMITTED EA response is NOT proof
// of a broker fill; only a source-bound deal/position can establish that.
export function linkExecutionTrace(signals, entries = [], decisions = [], snapshots = {}) {
  const key = (symbol, id) => symbol + '\u0000' + id;
  const records = new Map(), checks = new Map();
  for (const record of entries) {
    const id = record?.plan_id || record?.plan?.id;
    const symbol = record?.symbol || record?.plan?.symbol;
    if (!id || !symbol) continue;
    const k = key(symbol, id), previous = records.get(k);
    if (!previous || (Number(record.time) || 0) > (Number(previous.time) || 0)) records.set(k, record);
  }
  for (const check of decisions) {
    if (!check?.plan_id || !check.symbol) continue;
    const k = key(check.symbol, check.plan_id), previous = checks.get(k);
    if (!previous || (Number(check.updated_at) || 0) >= (Number(previous.updated_at) || 0)) checks.set(k, check);
  }
  return signals.map(p => {
    if (!p?.id || !p?.symbol || !String(p.source || '').startsWith('MT5')) return p;
    const code = recommendationCode(p.id), entry = records.get(key(p.symbol, p.id));
    const check = checks.get(key(p.symbol, p.id));
    const fill = verifiedBrokerDeal(entry, snapshots[p.symbol]);
    const status = fill ? 'FILLED' :
      entry?.status === 'REJECTED' ? 'REJECTED' :
      entry?.status === 'SUBMITTED' ? 'SUBMITTED' :
      entry?.status === 'DISPATCHED' ? 'DISPATCHED' :
      check?.status === 'BLOCKED' ? 'BLOCKED' : 'NOT_DISPATCHED';
    return {...p, execution_trace: {signal_code: code, status,
      approval_id: entry && Number.isSafeInteger(Number(entry.id)) ? Number(entry.id) : null,
      reason: entry?.status === 'REJECTED' ? describeEaRejection(entry.reason_code) :
        check?.status === 'BLOCKED' && !entry ? check.reason : null,
      reason_code: entry?.reason_code ?? null,
      mt5_retcode: entry?.mt5_retcode ?? null,
      // Never claim FILLED based on MT5's SUBMITTED acknowledgement.
      broker_fill_confirmed: Boolean(fill),
      broker_deal_ticket: fill?.ticket || null}};
  });
}
