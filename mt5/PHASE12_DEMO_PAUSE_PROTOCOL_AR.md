# NABD Phase 12 — Demo PAUSE-only executor protocol

**Status:** isolated draft branch only. Disabled unless `NABD_PHASE12_DEMO_STOP_BRIDGE_ENABLED=true` is configured on an isolated staging service. **Do not enable on Live.** An EXPERIMENTAL MQL5 source adapter now exists, but has not been compiled, installed, or verified in a live MT5 Demo terminal. No actual broker stop has been demonstrated.

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
1. Compile `NABD_Phase12_DemoPauseOnly.mq5` in Windows MetaEditor, plus the modified Demo trading EAs (`NABD_GOLD_4_01.mq5` and `NABD_BTC_FUSION_V2_4_06_Demo.mq5` or older `NABD_BTC_4_01.mq5`). Compile errors have not been verified by GitHub node tests. Do not install on a real account.
2. In isolated **JustMarkets Demo only**, install the PAUSE companion on an additional chart of the SAME symbol and account as the main trading EA; set `InpExplicitDemoPauseArm=true` deliberately. WARNING: this arms a persistent stop immediately, even with no server request, and there is NO automatic resume. The symbol-specific terminal global variable `NB_P12_<login>_<hash>` remains set when the companion is removed or MT5 restarts. Do not delete it or change live trading settings to bypass the lock. Verify that the modified trading EA blocks new entries while open-position management continues.
3. Configure only an isolated staging HTTPS URL (never Live), enable `NABD_PHASE12_DEMO_STOP_BRIDGE_ENABLED=true` on staging only, and provision a separate PAUSE-only token with MFA admin. In terminal Tools → Options → Expert Advisors allow the staging HTTPS URL for WebRequest. The existing monitoring token is not accepted. Verify authenticated polling, persisted stop, matching account/symbol acknowledgments, restart behavior and stale/replayed messages. Server still responds `stopConfirmed:false` until independent verification exists.
4. Staging integration tests and exact broker Demo confirmation. Resolve failing repository-wide CI checks.
5. Never deploy to Live or production database without separate review and explicit approval.

## Tests
`node --test demo-stop-transport.test.mjs risk-stop-intents.test.mjs tests/accounts.test.mjs`

## Known limits
- No verified MetaEditor build, installed Demo execution, or independent confirmation of broker stop yet. Do not call Phase 12 fully complete.
- The companion is **stop-only** and deliberately blocks on arming. There is no automated resume/unblock path.
- These guards have been added to the named EA source variants only; other legacy EAs and every independently running EA on the account remain outside this guarantee. Never interpret a stop report as account-wide broker trade protection.
- CI performs Node tests and MQL source guards, not actual MQL5 compilation or real MT5 execution.

## Local Windows Demo offline test — no staging token required
- Use `mt5/NABD_Phase12_LocalPauseProbe.mq5` only on a separate disposable JustMarkets-Demo account. It requires deliberate `InpArmPersistentDemoPause=true`, rejects real accounts, cannot submit orders, and performs no network requests.
- It sets the SAME `NB_P12_<login>_<symbol_hash>` terminal global flag used by the modified gold and BTC Demo EAs; removing the probe never clears the flag. The probe must be attached to the exact symbol and same MT5 terminal as the patched EA.
- The optional read-only Python diagnostic package `nabd_phase12_readiness.py` (distributed separately) checks the current Demo broker and closed M5/M15/H1/H4 history for XAUUSD.m/BTCUSD.m. It never calls order_send.
- These local probes do not prove authenticated Render-to-EA delivery. No full MT5 test has been run from GitHub.
