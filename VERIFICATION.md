# Verification — NABD Gold Pulse v3.2

Validated for the original repository `baderfcb232-hue/gold-pulse-ai`. The v3.2 integration was merged into `main` as `9e0f6f89ad75d388d81bef7e8227f33a9dc46f59` and deployed to the original `https://gold-pulse-ai.onrender.com/` service on 2026-10-11. This follow-up adds monitoring presets and an installation guide to the MT5 download without changing trading source or server authentication.

## Completed checks

- `npm ci --ignore-scripts`: passed; no external npm dependencies.
- `npm test`: **33 passed, 0 failed**, on Node.js **24.19.0**. Coverage includes broker data validation, indicators, frozen EA plans, quote/heartbeat expiry, news gating, BUY/SELL price sides, sizing and margins, private account data, authentication and logout, safe commands and expiry, SQLite persistence, and explicit backtest cost/calendar assumptions.
- JavaScript syntax checks passed for all server modules, `server.js`, and `public/app.js`. The HTML has 82 unique IDs and all 79 literal JavaScript ID references resolve. Staged diff whitespace checks passed.
- Migration checks exercise the existing `node server.js` entry point, HTTP health/version and updated UI assets, graceful SIGTERM, authenticated original ingestion path, rejection of incomplete old payloads, sizing on the original risk endpoint without changing MT5 settings, stale-data refusal, control blocking on ephemeral storage, and retained command IDs/confirmations across restart.
- Runtime is bounded to Node 24; `.node-version` uses Render's documented current version 24.21.0. Existing `node server.js` / `npm start` commands remain valid.
- The original unauthenticated ingestion and public account balance have been replaced with separately authenticated ingestion and operator-only account access. Fixed market directions/confidence/spread and the Yahoo futures fallback were removed.
- MT5 trading inputs/strategy from the previously prepared v1.13 linked EA remain unchanged. Network requests stay on a separate bridge chart.

All market/account fixtures are synthetic test data. They are never loaded into the running site. Passing tests do not establish strategy profitability.

## Verification limits

- GitHub write access was confirmed (`permissions.push=true`) after the collaborator invitation was accepted on 2026-10-09.
- The Render connector uses a different workspace and cannot access the original service. Publication was completed through the owner's authorized Dashboard session instead; no replacement service was created.
- The MQL5 files have not been compiled or run in MT5: MetaEditor/MT5 is unavailable. Compile both EAs and validate telemetry on a demo account before enabling account controls.
- Live desktop Browser QA on the original URL verified all six navigation sections, one visible panel per section, no horizontal overflow, CSV export, bridge URL copying, and the protected operator/account/download gates. The site's captured error/warning log was empty. Successful operator authentication, real candles/account data, and mobile viewport execution were not verified in production.
- Render Free has ephemeral storage. The new UI reports that condition and remote controls remain disabled unless durable storage is explicitly confirmed. Monitoring can work without a paid resource.
- No historical market dataset was supplied. No real profitability or live execution result is claimed.
- Command delivery is not a distributed exactly-once guarantee. The bridge records a command claim before broker submission to prevent replay; interrupted submissions can require manual verification and produce `UNCERTAIN`.

## Confirmed original-service deployment

- Service `srv-db3br0cs728c73c0jss0`, same name/URL, free tier, repository and `main` branch.
- Build `npm ci --ignore-scripts`; start `node server.js`; Auto-Deploy `On Commit`; health check `/healthz`.
- Deployment `dep-db5lq8favr4c7398jdsg` succeeded on 2026-10-11. Logs confirmed Node 24.21.0, zero npm vulnerabilities, `NABD v3.2 listening on 10000`, and service live.
- Separate `MT5_INGEST_TOKEN` and `DASHBOARD_TOKEN` values were generated and saved in Render under the user's explicit approval. Values were never copied into chat, source, presets, or local files. The UI confirmed that server protection was configured.
- No synthetic telemetry was posted to production. The site remains in the expected no-data state until the user's MT5 bridge sends broker data.

## Verification still required on the user's platform

1. Compile both MQL5 EAs in MetaEditor and load the monitoring presets (or enter the documented settings manually).
2. Verify exact broker symbol and Magic pairing, timestamp conversion, contract values, candle history, and calendar freshness.
3. Verify optional private account display after the user opts into sharing it and signs in as operator.
4. Keep remote management disabled until durable storage and demo-account verification are completed.
