# NABD Economic Intelligence — isolation and data provenance

Experimental only: `experimental/nabd-agentic-ai-test`, service `nabd-agentic-ai-test`.

## What is verified
- Official Federal Reserve and BLS headlines can be retrieved on the experimental service.
- Official BLS published economic observations can be fetched without API keys.
- OpenAI connectivity test succeeded, but this is not a functional autonomous trade analyst.
- No route in this experiment permits trading.

## What is *not* automatically provided by official BLS feeds
- Pre-announcement analyst consensus (Forecast).
- Reliable sub-second initial publication timestamps or a revision history.
- Broker-specific market reaction for XAUUSD or BTCUSD.

A headline date, vendor `LastUpdate`, or local polling timestamp must never be represented as the authoritative instant of release.

## Persistence
A separate Frankfurt Render Postgres Free instance was created:
`nabd-agentic-research-test`, id `dpg-dbppfaou01pc738q0tvg-a`.
Free databases expire; this instance is a *temporary test resource*, not an archival production repository.
No credentials are committed. The current web service is **not connected** to the database.
`sql/001_research_journal.sql` prepares an isolated schema, but has **not** been applied. Database migrations and connection wiring must be completed before recording persistent data.

The migration is scoped to a new, separate database and should never be applied to the production subscriber database `nabd_accounts`.

## Exact remaining prerequisites for real economic surprise analysis
1. Licensed market consensus provider capable of delivering **Forecast before scheduled release**, plus Actual, Previous, revision metadata, and source timestamps (e.g. a valid Trading Economics subscription). Set credential **only in experimental Render environment**, never chat/GitHub.
2. Connect isolated service to isolated Postgres using a separate DB URL, install `pg` during build, run vetted schema migration, and test persistence across a redeploy.
3. Capture forecasts point-in-time *before* releases and first observations *after* releases, then reconcile revisions and recorded latencies.
4. Obtain isolated, synchronized broker candles/prices for measuring reaction; never use Binance spot as a JustMarkets BTC trade execution quote.
5. Validate end-to-end on Demo. Preserve deterministic risk boundaries.

Do not claim production readiness or enable AI news-triggered trading until all prerequisites and tests pass.
