// Descriptive research, not a trading gate. No profitability or calibrated confidence claim.
const symbols=['XAUUSD','BTCUSD'];
const regimes=['TREND_UP','TREND_DOWN','RANGE_OR_MIXED','CONFLICT','VOLATILITY_EXPANSION','UNVERIFIED'];
export function summarizeDirectionalGroups(rows){
 return rows.filter(r=>symbols.includes(r.symbol)&&regimes.includes(r.regime)&&['BUY_WATCH','SELL_WATCH'].includes(r.stance)).map(r=>{
  const n=Number(r.scored),hits=Number(r.hits),mean=Number(r.mean_confidence);
  if(!Number.isSafeInteger(n)||n<1||!Number.isSafeInteger(hits)||hits<0||hits>n||!Number.isFinite(mean)||mean<0||mean>1)throw Error('INVALID_STATISTICAL_GROUP');
  const p=hits/n,z=1.96,d=1+z*z/n,c=(p+z*z/(2*n))/d,w=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
  return {symbol:r.symbol,regime:r.regime,stance:r.stance,confidenceBand:r.confidence_band,scored:n,hits,
   meanReportedConfidence:mean,hitRate:n>=30?p:null,wilson95:n>=30?[Math.max(0,c-w),Math.min(1,c+w)]:null,
   confidenceGap:n>=30?mean-p:null,insufficientSamples:n<30};
 });
}
export async function statisticalReview(query){
 const r=await query(`SELECT d.symbol,d.plan_summary->'researchEvidence'->>'regime' AS regime,
 d.stance,CASE WHEN d.confidence<0.6 THEN 'BELOW_60' WHEN d.confidence<0.82 THEN '60_TO_82' ELSE '82_PLUS' END AS confidence_band,
 count(*)::int AS scored,count(*) FILTER (WHERE f.hit IS TRUE)::int AS hits,avg(d.confidence) AS mean_confidence
 FROM agentic_research.shadow_analysis_decisions d JOIN agentic_research.demo_forward_evaluations f
 ON d.symbol=f.symbol AND d.closed_bar_at=f.closed_bar_at
 WHERE d.plan_summary->'researchEvidence'->>'version'='FUSION_STYLE_EVIDENCE_V5'
 AND d.analysis_status='RESEARCH_ANALYSIS_ONLY' AND f.outcome_status='SCORED'
 AND d.stance=f.ai_stance AND d.confidence=f.confidence
 AND f.outcome_tick_at>=f.horizon_at AND f.predicted_at>=d.analyzed_at
 GROUP BY 1,2,3,4 ORDER BY 1,2,3,4`,[]);
 const groups=summarizeDirectionalGroups(r.rows||[]);
 return {version:'V5_DIRECTIONAL_REVIEW_1',groups,scored:groups.reduce((s,g)=>s+g.scored,0),
  minimumPerGroup:30,profitabilityMeasured:false,transactionCostsIncluded:false,
  independentBrokerIdentityVerified:false,confidenceCalibrated:false,executionPermission:false,
  note:'Descriptive forward midpoint direction only; mixed model horizons and correlated observations; Wilson interval assumes independent trials and is illustrative only.'};
}
