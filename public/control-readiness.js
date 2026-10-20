// Client-side explanations only. The server remains the authority for all MT5 commands.
export function controlBlockers({action, authenticated, persistent, live, fresh, remoteControl, enabled}) {
  const reasons = [];
  if (!authenticated) reasons.push('سجّل دخول المشغّل أولاً.');
  if (!persistent) reasons.push('أوامر التداول تحتاج تخزينًا دائمًا لسجل الأوامر.');
  if (!live) reasons.push('اتصال بيانات MT5 غير حي.');
  if (!fresh) reasons.push('حالة بوت MT5 قديمة أو غير متاحة.');
  if (!remoteControl) reasons.push('التحكم عن بُعد مغلق: فعّل InpNABDAllowRemoteControl في البوت والجسر، وInpNABDSendAccount في الجسر داخل MT5.');
  if (!['PAUSE', 'RESUME'].includes(action) && !enabled) reasons.push('التنفيذ غير مفعّل داخل MT5.');
  return reasons;
}
