// Demo-only manual volume: never round a requested lot up or down.
export function validateManualLot(lot, spec) {
  if (typeof lot !== 'number' || !Number.isFinite(lot) || lot <= 0)
    return {ok:false, reason:'INVALID_LOT'};
  const min=spec?.volume_min, max=spec?.volume_max, step=spec?.volume_step;
  if (![min,max,step].every(v=>Number.isFinite(v)&&v>0) || max<min)
    return {ok:false, reason:'BROKER_VOLUME_UNAVAILABLE'};
  if (lot < min-1e-9 || lot > max+1e-9)
    return {ok:false, reason:'LOT_OUTSIDE_BROKER_LIMITS'};
  const steps=(lot-min)/step;
  if (Math.abs(steps-Math.round(steps))>1e-6)
    return {ok:false, reason:'LOT_STEP_MISMATCH'};
  return {ok:true, lot:Math.round((min+Math.round(steps)*step)*1e8)/1e8};
}
export function stopLossEstimate(lot,plan,spec) {
  if (!plan || !['BUY','SELL'].includes(plan.side) ||
      !Number.isFinite(plan.entry) || !Number.isFinite(plan.sl) ||
      (plan.side==='BUY' ? !(plan.sl<plan.entry) : !(plan.entry<plan.sl)) ||
      !(spec?.tick_size>0) || !(spec?.tick_value_loss>0)) return null;
  const loss=Math.abs(plan.entry-plan.sl)/spec.tick_size*spec.tick_value_loss*lot;
  return Number.isFinite(loss)&&loss>0 ? loss : null;
}
