# NABD Phase 12 — Demo PAUSE-only executor protocol

**Status:** isolated draft branch only. Disabled unless `NABD_PHASE12_DEMO_STOP_BRIDGE_ENABLED=true` is configured on an isolated staging service. **Do not enable on Live.** No installed EA currently consumes this protocol. No pause of actual MT5 trading has been demonstrated.

## Trust boundaries
- Existing `/api/worker/mt5-heartbeat` worker token remains read-only and must never be reused.
- Only a verified active JustMarkets **Demo** account with an admin-approved hosting request may receive an independent stop executor token.
- An MFA-authenticated administrator provisions a one-time token through `POST /api/admin/risk-stop/provision` with `{ "id": "<registered-demo-account-uuid>", "confirm": "ISSUE_DEMO_PAUSE_ONLY" }`.
- Reprovision rotates the token. `POST /api/admin/risk-stop/revoke` with `{"id":"..."}` invalidates it. Only a token SHA-256 digest is persisted.
- The separate worker sends `X-NABD-Stop-Token: <token>`. Never place the token in URL query strings or source control.
- Poll using `POST /api/worker/risk-stop/poll` with `accountId`, `broker`, `server`, `login`, `environment:"demo"`, `demo_mode:true`. These fields must match the registered Demo account.
- The response can contain **only** `{requestId,symbol,action:"PAUSE_NEW_ENTRIES_ONLY"}`.
- Future trusted EA adapter must first validate `AccountInfoInteger(ACCOUNT_LOGIN)`, server, Demo account mode and symbol. It must persist a per-account PAUSED flag on the terminal **before** it sends acknowledgement. After terminal reboot, fail closed until state is recovered. Stop should not cause any automatic close of already-open positions.
- After persistent local pause, send `POST /api/worker/risk-stop/ack` with the identity fields plus `requestId`, `symbol`, `persistedPaused:true`. This is **self-reported**, not independent proof. The server deliberately responds `brokerConfirmed:false` and `stopConfirmed:false`.
- There is no RESUME endpoint, no broker order endpoint, and no way to enable trading through this protocol. Resumption will require a separate owner authorization flow and a verified fresh EA state, which do not exist yet.

## Remaining before Demo/Live use
1. Build and compile a separate EA-side MQL5 adapter; do not install it on a real account.
2. Verify source/account binding and safe persistence through MT5 terminal restarts; ensure the trading EA checks the same paused state immediately before every new order.
3. Independent heartbeat/terminal-state verification with replay and stale-data rejection; only then consider an actual STOP_CONFIRMED status.
4. Staging integration tests and exact broker Demo confirmation. Resolve failing repository-wide CI checks.
5. Never deploy to Live or production database without separate review and explicit approval.

## Tests
`node --test demo-stop-transport.test.mjs risk-stop-intents.test.mjs tests/accounts.test.mjs`
