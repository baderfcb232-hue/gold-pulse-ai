// Research results never authorize a live order or a Telegram recommendation.
export const researchPolicy = Object.freeze({
  mode: 'RESEARCH_ONLY', publicationAllowed: false, claimedSuccessRate: null,
  reason: 'لا توجد توصية منشورة حاليًا.',
  localMT5TradingControlled: false
});

export function researchMarketState(state) {
  return {...state, markets: Object.fromEntries(Object.entries(state.markets).map(([key, m]) => [key,
    {...m, currentSignal: null, suspendedSignal: null,
      analysis: {...m.analysis, decision: 'WAIT', status: 'SCANNING', setup: null,
        score: null, reason: researchPolicy.reason}}]))};
}
