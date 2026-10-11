# Verification — NABD Gold Pulse v3.2.1

Validated for the original repository `baderfcb232-hue/gold-pulse-ai`. The v3.2 integration was merged into `main` as `9e0f6f89ad75d388d81bef7e8227f33a9dc46f59` and deployed to the original `https://gold-pulse-ai.onrender.com/` service on 2026-10-11. Patch 3.2.1 repairs multi-day quote rejection and adds bridge diagnostics without changing the main trading strategy or authentication credentials.

## HTTP=400 regression

- A synthetic `XAUUSD.m` snapshot with a Friday quote received about 50 hours later reproduced `Invalid quote_at` before this patch. No production credentials, account identifiers or orders were used in the reproduction.
- Valid historical quote times now pass ingestion while future, zero, negative, string and nonfinite times remain invalid. Fresh arrival/EA heartbeats cannot turn a multi-day-old quote into LIVE status, an EA recommendation, a target hit or an allowed command. An authenticated API regression also verifies recovery when the broker sends a current tick.
- The bridge reports bounded server rejection details once per unchanged error and prints the first/recovered HTTP=200 acceptance. It does not claim that acceptance means a fresh market quote. Malformed JSON receives a constant error rather than echoing submitted secrets or payload fragments; MT5 validation failures are logged without the request body or headers.
- Check the deployed `/healthz` version is `3.2.1` before treating the patch as published. New bridge source 3.01 still requires compilation on the user's MT5 platform.

## Completed checks

- `npm ci --ignore-scripts`: passed; no external npm dependencies.
- `npm test`: **36 passed, 0 failed**, on Node.js **24.19.0**. Coverage includes broker data validation, weekend quote acceptance without stale-data trading, recovery on a current tick, private JSON error redaction, indicators, frozen EA plans, quote/heartbeat expiry, news gating, BUY/SELL price sides, sizing and margins, private account data, authentication and logout, safe commands and expiry, SQLite persistence, and explicit backtest cost/calendar assumptions.
- JavaScript syntax checks passed for all server modules, `server.js`, and `public/app.js`. The HTML has 82 unique IDs and all 79 literal JavaScript ID references resolve. Staged diff whitespace checks passed.
- Migration checks exercise the existing `node server.js` entry point, HTTP health/version and updated UI assets, graceful SIGTERM, authenticated original ingestion path, rejection of incomplete old payloads, sizing on the original risk endpoint without changing MT5 settings, stale-data refusal, control blocking on ephemeral storage, and retained command IDs/confirmations across restart.
- Runtime is bounded to Node 24; `.node-version` uses Render's documented current version 24.21.0. Existing `node server.js` / `npm start` commands remain valid.
- The original unauthenticated ingestion and public account balance have been replaced with separately authenticated ingestion and operator-only account access. Fixed market directions/confidence/spread and the Yahoo futures fallback were removed.
- MT5 trading inputs/strategy from the previously prepared v1.13 linked EA remain unchanged. Network requests stay on a separate bridge chart.

All market/account fixtures are synthetic test data. They are never loaded into the running site. Passing tests do not establish strategy profitability.

## Verification limits

- GitHub write access was confirmed (`permissions.push=true`) after the collaborator invitation was accepted on 2026-10-09.
- The Render connector uses a different workspace and cannot access the original service. Publication was completed through the owner's authorized Dashboard session instead; no replacement service was created.
- MetaEditor/MT5 is unavailable in this environment. The user's screenshot shows the previous main EA and bridge running on separate charts and the bridge receiving HTTP=400. The changed bridge 3.01 has not been compiled or run here; compile it and validate telemetry on the user's demo account.
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
