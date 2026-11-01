import {botHeartbeatFresh, BOT_CONTROL_TTL} from '../engine.mjs';

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

// Price freshness and executor freshness are different: a closed market can
// still receive a PAUSE command. Always inspect only the requested symbol.
export function marketControlStatus(controls, symbol, now) {
  const s = controls?.[symbol];
  const recent = at => Number.isFinite(at) && at > 0 && now-at >= -5 && now-at <= 10;
  const bridgeLive = !!s && s.terminalConnected === true && recent(s.bridgeReceivedAt);
  const fresh = bridgeLive && botHeartbeatFresh(s.bot?.heartbeat_at,
    s.execution?.main_connected, now, BOT_CONTROL_TTL);
  const live = bridgeLive && s.connection === 'LIVE' && Number.isFinite(s.lastUpdate)
    && now-s.lastUpdate >= -5 && now-s.lastUpdate <= 20;
  const name = symbol === 'BTCUSD' ? 'البيتكوين' : 'الذهب';
  const connection = !s ? 'لم تصل بيانات MT5' : !bridgeLive ? 'تحديث الجسر متأخر أو المنصة غير متصلة'
    : !fresh ? 'الجسر متصل؛ ننتظر نبض البوت' : 'البوت متصل';
  const price = !s ? 'السعر غير متاح' : live ? 'السعر حديث' : 'السعر قديم؛ الدخول الجديد ينتظر سعرًا حديثًا';
  return {bridgeLive, fresh, live, summary: `${name}: ${connection} · ${price}`};
}

 // Only notify about control-link and bot-heartbeat failures for the affected
 // market. A stale quote alone (e.g. a closed gold market) is not a bridge outage.
export function marketControlWarnings(controls, now) {
  const warnings = [];
  for (const symbol of ['XAUUSD', 'BTCUSD']) {
    const control = controls?.[symbol];
    if (!control || !Number.isFinite(control.bridgeReceivedAt)) continue;
    const status = marketControlStatus(controls, symbol, now);
    const name = symbol === 'BTCUSD' ? 'البيتكوين' : 'الذهب';
    if (!status.bridgeLive && now - control.bridgeReceivedAt > 60) {
      warnings.push({key: 'bridge:' + symbol,
        message: name + ': توقف وصول بيانات جسر MT5 لأكثر من دقيقة. حالة الأصل الآخر مستقلة.'});
    } else if (status.bridgeLive && !status.fresh) {
      warnings.push({key: 'bot:' + symbol,
        message: name + ': جسر MT5 متصل لكن نبض البوت قديم أو غير متاح؛ أوامر التحكم معلّقة لهذا الأصل.'});
    }
  }
  return warnings;
}

// The button's visual state follows the last known managed-position count,
// not the rapidly changing 5-second bridge heartbeat. Actual commands still
// use the current blockers and are revalidated by MT5 and the server.
export function closeButtonDisplay({authenticated, positions, issues = []}) {
  const known = authenticated && Array.isArray(positions);
  if (known && positions.length === 0)
    return {positionState:'empty', hint:'لا توجد صفقات مفتوحة بحسب آخر سجل MT5. اضغط تحديث الحالة والسجل إذا تغيّرت الصفقات.'};
  if (known && positions.length > 0)
    return {positionState:'open', hint:'آخر سجل MT5 يحتوي على ' + positions.length + ' من صفقات البوت. اضغط الزر لفحص شروط الإغلاق وإرسال الأمر بعد التأكيد.'};
  return {positionState:'unknown', hint:issues.length ? issues[0] + (issues.length > 1 ? ' · اضغط لمعرفة بقية الأسباب.' : '') : 'لم يصل سجل صفقات مؤكد؛ اضغط تحديث الحالة والسجل.'};
}
