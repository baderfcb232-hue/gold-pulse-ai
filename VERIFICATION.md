# Verification — NABD Gold Pulse v3.2

Validated for the original repository `baderfcb232-hue/gold-pulse-ai`, from original `main` commit `fb12ff2`, on 2026-10-09. Publication uses the existing `main` branch and Render service; verify version 3.2.0 at the exact existing URL after deployment.

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
- The connected Render account does not have access to the original service. Existing build/env/auto-deploy settings still need final inspection under the correct account before publication.
- The MQL5 files have not been compiled or run in MT5: MetaEditor/MT5 is unavailable. Compile both EAs and validate telemetry on a demo account before enabling account controls.
- Browser visual QA remains incomplete. Local preview access was previously blocked/unreachable; no browser-policy workaround was attempted. Syntax, served assets, and DOM references are checked separately.
- Render Free has ephemeral storage. The new UI reports that condition and remote controls remain disabled unless durable storage is explicitly confirmed. Monitoring can work without a paid resource.
- No historical market dataset was supplied. No real profitability or live execution result is claimed.
- Command delivery is not a distributed exactly-once guarantee. The bridge records a command claim before broker submission to prevent replay; interrupted submissions can require manual verification and produce `UNCERTAIN`.

## Deployment verification still required

1. Confirm access to the original Render service for inspecting its environment and deployment configuration.
2. Review the existing Render build command, Node override, auto-deploy setting, and token configuration, then publish this update through the existing `main` branch/service.
3. Verify `/healthz` reports 3.2.0 at the exact existing URL and inspect mobile/desktop navigation, chart, login/logout, and the no-data state.
4. Compile the MQL5 bridge, verify exact broker symbol, timestamp conversion, contract values, candle history, and calendar freshness.
5. Confirm private account routes stay protected and only enable optional management after durable storage and demo-account verification.
