-- NABD Agentic AI research journal (isolated database ONLY).
-- Apply to nabd-agentic-research-test. DO NOT apply to production database.
-- Schema-only deployment; executing this file requires a separate authenticated DB migration.
BEGIN;
CREATE SCHEMA IF NOT EXISTS agentic_research;
CREATE TABLE IF NOT EXISTS agentic_research.forecast_snapshots (
  event_provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  first_observed_at TIMESTAMPTZ NOT NULL,
  forecast_raw TEXT NOT NULL,
  forecast_numeric DOUBLE PRECISION,
  forecast_unit TEXT,
  source_url TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_provider, provider_event_id, scheduled_at),
  CONSTRAINT forecast_before_release CHECK (first_observed_at < scheduled_at),
  CONSTRAINT forecast_bounded CHECK (length(forecast_raw) BETWEEN 1 AND 80),
  CONSTRAINT provider_event_id_bounded CHECK (length(provider_event_id) BETWEEN 1 AND 128),
  CONSTRAINT provider_bounded CHECK (length(event_provider) BETWEEN 1 AND 80)
);
CREATE TABLE IF NOT EXISTS agentic_research.actual_observations (
  event_provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  first_observed_at TIMESTAMPTZ NOT NULL,
  actual_raw TEXT NOT NULL,
  actual_numeric DOUBLE PRECISION,
  actual_unit TEXT,
  provenance TEXT NOT NULL,
  release_timestamp_verified BOOLEAN NOT NULL DEFAULT FALSE,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_provider, provider_event_id, scheduled_at),
  CONSTRAINT observed_after_release CHECK (first_observed_at >= scheduled_at),
  CONSTRAINT actual_bounded CHECK (length(actual_raw) BETWEEN 1 AND 80),
  CONSTRAINT actual_provider_id_bounded CHECK (length(provider_event_id) BETWEEN 1 AND 128)
);
CREATE TABLE IF NOT EXISTS agentic_research.feed_checks (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  diagnostic_code TEXT,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feed_checks_recent ON agentic_research.feed_checks (observed_at DESC);
-- Least-privilege roles should be assigned to the service independently.
-- Use INSERT ... ON CONFLICT DO NOTHING to retain the first forecast and actual observation.
-- Decisions are research-only; do not store account credentials or raw price streams.
CREATE TABLE IF NOT EXISTS agentic_research.shadow_analysis_decisions (
  symbol TEXT NOT NULL CHECK (symbol IN ('XAUUSD','BTCUSD')),
  closed_bar_at TIMESTAMPTZ NOT NULL,
  analyzed_at TIMESTAMPTZ NOT NULL,
  trigger TEXT NOT NULL,
  analysis_status TEXT NOT NULL,
  stance TEXT CHECK (stance IS NULL OR stance IN ('BUY_WATCH','SELL_WATCH','WAIT')),
  confidence DOUBLE PRECISION CHECK (confidence IS NULL OR (confidence BETWEEN 0 AND 1)),
  reason_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(symbol, closed_bar_at)
);
-- Allow previously created isolated test tables to receive bounded research explanations.
ALTER TABLE agentic_research.shadow_analysis_decisions
 ADD COLUMN IF NOT EXISTS plan_summary JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_shadow_decisions_recent
 ON agentic_research.shadow_analysis_decisions (analyzed_at DESC);

-- Phase 8: durable, isolated forward-research outcomes. No broker orders or credentials.
CREATE TABLE IF NOT EXISTS agentic_research.demo_forward_evaluations (
 symbol TEXT NOT NULL CHECK (symbol IN ('XAUUSD','BTCUSD')),
 closed_bar_at TIMESTAMPTZ NOT NULL,
 predicted_at TIMESTAMPTZ NOT NULL,
 baseline_tick_at TIMESTAMPTZ NOT NULL,
 horizon_at TIMESTAMPTZ NOT NULL,
 baseline_mid DOUBLE PRECISION NOT NULL CHECK (baseline_mid > 0 AND baseline_mid < 1000000000),
 ai_stance TEXT NOT NULL CHECK (ai_stance IN ('BUY_WATCH','SELL_WATCH')),
 confidence DOUBLE PRECISION NOT NULL CHECK (confidence BETWEEN 0 AND 1),
 ema_stance TEXT NOT NULL CHECK (ema_stance IN ('BUY_WATCH','SELL_WATCH','WAIT','UNVERIFIED')),
 agreement TEXT NOT NULL CHECK (agreement IN ('AGREED','DISAGREED','UNVERIFIED')),
 outcome_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (outcome_status IN ('PENDING','SCORED','EXPIRED')),
 outcome_tick_at TIMESTAMPTZ,
 direction TEXT CHECK (direction IS NULL OR direction IN ('UP','DOWN','FLAT')),
 hit BOOLEAN,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY (symbol,closed_bar_at),
 CONSTRAINT future_after_baseline CHECK (horizon_at > predicted_at AND baseline_tick_at <= predicted_at),
 CONSTRAINT outcome_consistent CHECK (
   (outcome_status='PENDING' AND outcome_tick_at IS NULL AND direction IS NULL AND hit IS NULL)
   OR (outcome_status='SCORED' AND outcome_tick_at IS NOT NULL AND direction IS NOT NULL AND hit IS NOT NULL)
   OR (outcome_status='EXPIRED' AND outcome_tick_at IS NOT NULL AND direction IS NULL AND hit IS NULL)
 )
);
CREATE INDEX IF NOT EXISTS idx_demo_forward_due
 ON agentic_research.demo_forward_evaluations(symbol,horizon_at)
 WHERE outcome_status='PENDING';
CREATE INDEX IF NOT EXISTS idx_demo_forward_recent
 ON agentic_research.demo_forward_evaluations(predicted_at DESC);

COMMIT;
