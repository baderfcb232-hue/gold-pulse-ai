# NABD AI: exact remaining deployment steps (EXPERIMENTAL SERVICE ONLY)

**Existing experimental web service**: `nabd-agentic-ai-test` (Frankfurt).
**Independent database**: `nabd-agentic-research-test` (Frankfurt), internal database name `nabd_agentic_research_test`.
**Never alter** `gold-pulse-ai` or `nabd-accounts`.

## Confirmed limitations
- Render connector does NOT expose database credentials or allow changing the existing service's build command. The external SQL tool cannot reach a DB with an empty IP allowlist. Do NOT loosen the allowlist; same-region internal connections are the correct way.
- Provider consensus **Forecast** requires a licensed source. Official US government indicators are not analyst consensus.
- The free research DB expires 2026-12-10; use a durable paid isolated DB before production.

## One-time Render Dashboard setup

1. Open `https://dashboard.render.com/d/dpg-dbppfaou01pc738q0tvg-a`, Connect, copy **Internal Database URL** for the isolated test database.
2. Open `https://dashboard.render.com/web/srv-dbp5atbm8hqs73ct73hg`, Environment. Add `NABD_TEST_RESEARCH_DATABASE_URL` with that **Internal URL**. Never share it in chat, commit it, or substitute the production URL.
3. On the *experimental* service's Settings, change Build Command from `echo 'Isolated AI connectivity test: no dependencies'` to `npm ci --omit=dev` (package-lock pins pg). Leave its Start Command `node agentic-experimental/render-connectivity-server.mjs` unchanged.
4. Choose **Save, rebuild, and deploy**. On startup the adapter first verifies `current_database() = 'nabd_agentic_research_test'`, then applies `sql/001_research_journal.sql` idempotently.
5. Verify `/journal/status` displays `CONNECTED`; `/calendar/status` stays `NOT_CONFIGURED` without a calendar key. A connected DB without a provider is still **not** economic surprise analysis.

### Real consensus forecast (not free government data)
- Subscribe to a licensed economic-calendar provider if suitable, such as Trading Economics API, and add the valid credential **only** as `NABD_TEST_TRADING_ECONOMICS_KEY` on the experimental service. Confirm permitted usage, update frequency and rate limits before polling every 5 minutes.
- The calendar stores pre-release forecast baseline via immutable INSERT and first observed actual in the isolated DB; revised forecast values are not allowed to overwrite the baseline. This **does not** establish official first-release time, independent provider latency, or a broker-confirmed reaction.

## Proof already established
- GitHub Actions integration test with Postgres 18, migrations, separate/reopened connection and duplicate forecasts passes.
- Non-live mock calendar restart and blocked-source tests pass.
- Render experimental deployment remains Live, but logs report `[NABD RESEARCH JOURNAL] NOT_CONFIGURED` and `[NABD CALENDAR PREVIEW] NOT_CONFIGURED` until credentials are set.

Never enable auto trading from this research preview. Demo and real-time publication-latency verification remain separate acceptance tests.
