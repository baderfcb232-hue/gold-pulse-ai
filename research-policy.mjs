// Research results never authorize a live order or a Telegram recommendation.
export const researchPolicy = Object.freeze({
  mode: 'RESEARCH_ONLY', publicationAllowed: false, claimedSuccessRate: null,
  reason: 'التوصيات الجديدة وإرسال Telegram متوقفان أثناء التحقق. لا توجد دقة 95% مثبتة ولا صفقة مضمونة 100%.',
  localMT5TradingControlled: false
});

export function researchMarketState(state) {
  return {...state, researchPolicy, markets: Object.fromEntries(Object.entries(state.markets).map(([key, m]) => [key,
    {...m, currentSignal: null, suspendedSignal: null,
      analysis: {...m.analysis, decision: 'WAIT', status: 'RESEARCH_ONLY', setup: null,
        score: null, reason: researchPolicy.reason}}]))};
}
