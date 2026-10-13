# Verification — NABD Gold Pulse v3.3.1

## Bot heartbeat monitoring stability (3.3.1)

- Reproduced false monitoring expiry at a heartbeat age just over five seconds despite current broker quotes and a present main-EA link.
- The browser and analysis engine share a 15-second monitoring predicate, covering the bridge 10-second request timeout plus its 3-second update interval. Overview, link status and displayed plans refresh together each second.
- Remote-command freshness remains five seconds on both server and browser controls. Missing/zero/future heartbeats, an explicit false main-connected flag, old quotes and heartbeats older than 15 seconds still block their corresponding operations. No production trade command or synthetic telemetry was sent.
- `npm test`: 55 passed, 0 failed on Node 24.19.0. Regressions cover the old five-second boundary, unchanged EA levels, delayed authenticated snapshots, command rejection during monitoring grace, stop detection with continuing quotes, and recovery on a new EA heartbeat. Browser verification on the published service is performed after deployment.

## MT5 calendar serialization fix (link package 3.2.3 / bridge 3.03)

- A real bridge 3.02 screenshot showed first-quote acceptance followed by `HTTP=400` and `Invalid JSON body`. Both complete-calendar paths converted `datetime now` directly to string, inserting a formatted date without JSON quoting instead of Unix seconds.
- Both paths now cast through `long` before string conversion. The bridge version is 3.03; website runtime remains 3.3.0. Trading strategy, credentials, monitoring presets and execution opt-ins are unchanged.
- Two regression tests exercise the actual calendar JSON expressions with documented MQL5 datetime conversion semantics, including unavailable, empty, populated and incomplete calendars. The unpatched expressions reproduced JSON parse failure and local API HTTP 400; patched expressions parse with numeric UTC timestamps and full updates reach the local API with HTTP 200 and candles intact. The full suite passes 51 tests on Node 24.19.0.
- This narrow JavaScript adapter is not an MQL5 compiler. MetaEditor compilation and real continued telemetry from bridge 3.03 still require the user's terminal. No synthetic telemetry is sent to production.

## Independent reference scalping and news (3.3.0)

- `npm test`: 49 passing tests on Node 24.19.0, including 12 new checks for price/candle validation, gap rejection, both scalp directions, expiry-before-fill tracking, frozen/deduplicated reference levels, separation from MT5, cache restart freshness, HTTP/socket shutdown, RSS/Atom safety, original-arrival deduplication, 304 caching, RSS TTL status and 429 backoff. No synthetic fixture is posted to production.
- Real public-source smoke test retrieved current Gold API quotes, 299 closed BTC-USD M1 candles, a working Coinbase WebSocket stream, Arabic/business BBC headlines and ECB releases. One Federal Reserve fetch failed; the source is reported as unavailable and retried independently. This check proves connectivity, not profitability or 24-hour uptime.
- UI distinguishes sampled gold reference candles, exchange BTC data and broker MT5 data. Neither public reference source substitutes for the broker account, its execution levels, or authenticated commands.
- Gold has no unauthenticated historical minute endpoint. Its independent M1/M5 strategy warms up from observed quotes for about 110 minutes; no historical prices are manufactured. Indicators use closed observations and block gaps/staleness. Gold source update cadence is about 30 seconds.
- BBC RSS declares a 15-minute TTL. News uses the longest of its nominal 30–60 second interval, HTTP caching and RSS TTL, with conditional requests where offered and backoff on errors. One-second SSE/UI updates are not a claim of one-second global news coverage.
- A free Render process cannot promise unattended 24/7 collection or preserve local gold/history caches through restart. No paid resources or external keep-alive service were provisioned.
- The existing startup command, separate operator/ingest credentials, EA signal-source contract and ephemeral-storage trade-control block remain covered by the regression suite.

Validated for the original repository `baderfcb232-hue/gold-pulse-ai`. The v3.2 integration was merged into `main` as `9e0f6f89ad75d388d81bef7e8227f33a9dc46f59` and deployed to the original `https://gold-pulse-ai.onrender.com/` service on 2026-10-11. Patch 3.2.1 repairs multi-day quote rejection and adds bridge diagnostics without changing the main trading strategy or authentication credentials.

## HTTP=400 regression

- A synthetic `XAUUSD.m` snapshot with a Friday quote received about 50 hours later reproduced `Invalid quote_at` before this patch. No production credentials, account identifiers or orders were used in the reproduction.
- Valid historical quote times now pass ingestion while future, zero, negative, string and nonfinite times remain invalid. Fresh arrival/EA heartbeats cannot turn a multi-day-old quote into LIVE status, an EA recommendation, a target hit or an allowed command. An authenticated API regression also verifies recovery when the broker sends a current tick.
- The bridge reports bounded server rejection details once per unchanged error and prints the first/recovered HTTP=200 acceptance. It does not claim that acceptance means a fresh market quote. Malformed JSON receives a constant error rather than echoing submitted secrets or payload fragments; MT5 validation failures are logged without the request body or headers.
- Check the deployed `/healthz` version is `3.2.2` before treating the current patch as published. New bridge source 3.02 still requires compilation on the user's MT5 platform.

## Bridge startup diagnostics (3.2.2 / bridge 3.02)

- The first packet contains the real broker quote/specification and runtime EA state, with explicitly empty candle arrays and an unavailable calendar. History/calendar loading starts only after that packet is accepted. The latest broker tick is read again after potentially slow history/calendar calls.
- The bridge displays its current stage and the HTTP or MQL network error on its own chart. A future broker timestamp is blocked locally with a clock/automatic-offset diagnostic; quote timestamps are never replaced with the current time.
- Request timeout defaults to 10,000 ms (allowed input range 3,000–30,000 ms), replacing the previous hard-coded 1,200 ms. Network work remains on the separate bridge chart.
- A local authenticated API integration check verifies that an initial quote without history, calendar, main EA or account data is visible while signals and remote commands remain unavailable. A subsequent complete packet resumes the original EA recommendation flow.
- These changes require compiling and running bridge 3.02 on the user's MT5 platform. JavaScript/API tests do not prove that MQL5 compiled or that a live MT5 request was received.

## Completed checks

- `npm ci --ignore-scripts`: passed; no external npm dependencies.
- `npm test`: **37 passed, 0 failed**, on Node.js **24.19.0**. Coverage includes first-quote bootstrap without fabricated history/calendar or premature signals/control, broker data validation, weekend quote acceptance without stale-data trading, recovery on a current tick, private JSON error redaction, indicators, frozen EA plans, quote/heartbeat expiry, news gating, BUY/SELL price sides, sizing and margins, private account data, authentication and logout, safe commands and expiry, SQLite persistence, and explicit backtest cost/calendar assumptions.
- JavaScript syntax checks passed for all server modules, `server.js`, and `public/app.js`. The HTML has 82 unique IDs and all 79 literal JavaScript ID references resolve. Staged diff whitespace checks passed.
- Migration checks exercise the existing `node server.js` entry point, HTTP health/version and updated UI assets, graceful SIGTERM, authenticated original ingestion path, rejection of incomplete old payloads, sizing on the original risk endpoint without changing MT5 settings, stale-data refusal, control blocking on ephemeral storage, and retained command IDs/confirmations across restart.
- Runtime is bounded to Node 24; `.node-version` uses Render's documented current version 24.21.0. Existing `node server.js` / `npm start` commands remain valid.
- The original unauthenticated ingestion and public account balance have been replaced with separately authenticated ingestion and operator-only account access. Fixed market directions/confidence/spread and the Yahoo futures fallback were removed.
- MT5 trading inputs/strategy from the previously prepared v1.13 linked EA remain unchanged. Network requests stay on a separate bridge chart.

All market/account fixtures are synthetic test data. They are never loaded into the running site. Passing tests do not establish strategy profitability.

## Verification limits

- GitHub write access was confirmed (`permissions.push=true`) after the collaborator invitation was accepted on 2026-10-09.
- The Render connector uses a different workspace and cannot access the original service. Publication was completed through the owner's authorized Dashboard session instead; no replacement service was created.
- MetaEditor/MT5 is unavailable in this environment. The latest user screenshot shows the main EA and bridge 3.01 running on separate charts, with startup/no-trade logs but no telemetry acceptance. Production state returned NO_DATA with revision 0 before this patch. The changed bridge 3.02 has not been compiled or run here; compile it and validate telemetry on the user's platform.
- Live desktop Browser QA on the original URL verified all six navigation sections, one visible panel per section, no horizontal overflow, CSV export, bridge URL copying, and the protected operator/account/download gates. The site's captured error/warning log was empty. Successful operator authentication, real candles/account data, and mobile viewport execution were not verified in production.
- Render Free has ephemeral storage. The new UI reports that condition and remote controls remain disabled unless durable storage is explicitly confirmed. Monitoring can work without a paid resource.
- No historical market dataset was supplied. No real profitability or live execution result is claimed.
- Command delivery is not a distributed exactly-once guarantee. The bridge records a command claim before broker submission to prevent replay; interrupted submissions can require manual verification and produce `UNCERTAIN`.

## Confirmed original-service deployment

- Service `srv-db3br0cs728c73c0jss0`, same name/URL, free tier, repository and `main` branch.
- Build `npm ci --ignore-scripts`; start `node server.js`; Auto-Deploy `On Commit`; health check `/healthz`.
- Deployment `dep-db5lq8favr4c7398jdsg` succeeded on 2026-10-11. Logs confirmed Node 24.21.0, zero npm vulnerabilities, `NABD v3.2 listening on 10000`, and service live.
- Separate `MT5_INGEST_TOKEN` and `DASHBOARD_TOKEN` values were generated and saved in Render under the user's explicit approval. Values were never copied into chat, source, presets, or local files. The UI confirmed that server protection was configured.
- No synthetic telemetry was posted to production. Real quote/candle reception must be verified from the user's MT5 bridge; historical no-data screenshots do not establish the current connection state.

## Verification still required on the user's platform

1. Compile both MQL5 EAs in MetaEditor and load the monitoring presets (or enter the documented settings manually).
2. Verify exact broker symbol and Magic pairing, timestamp conversion, contract values, candle history, and calendar freshness.
3. Verify optional private account display after the user opts into sharing it and signs in as operator.
4. Keep remote management disabled until durable storage and demo-account verification are completed.
