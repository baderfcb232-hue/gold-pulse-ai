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
CREATE INDEX IF NOT EXISTS idx_shadow_decisions_recent
 ON agentic_research.shadow_analysis_decisions (analyzed_at DESC);

COMMIT;
