# NABD Phase 13 — Subscriber Demo execution gate (policy only)

This change adds `subscriber-demo-policy.mjs` and tests. It is **NOT wired** into any HTTP endpoint, Windows worker, MT5 EA, database, or existing operator execution path. Deploying it does **not** enable trading.

## Verified policy requirements
- Missing data, real or deleted accounts, inactive/revoked/expired consent and mismatched owner/account are denied.
- Monitoring-only workers, disconnected workers and mismatched broker identity are denied.
- Per-account pause / emergency stop, max risk percentage, max positions and invalid price geometry are denied.
- Signal must target the same account and symbol, have a nonce, be recent and have a valid stop and target.
- A deterministic `account_id:signal_id` key is returned on a pass, **but is not a reservation**.

## Must be built before Demo order execution
1. Owner-authenticated, revocable, separately consented execution grant with MFA and audit. Hosting approval is **not** trading consent.
2. Isolated dedicated Windows execution worker with a separate scoped identity from the read-only monitoring token and locally protected broker credentials (not sent to Render, GitHub or chat).
3. Persistent account-scoped command queue and **atomic unique constraint on (account_id, signal_id)**. Use transaction/lease/recovery with broker reconciliation before retrying to prevent duplicate orders on crash/network failure.
4. Validate signed/owned source signal, independent worker identity and grant/risk snapshots on the server at dispatch and again at execution time. Never trust request JSON as verified evidence.
5. Broker ACK and actual ticket/deal reconciliation; record rejection codes; per-user emergency halt, loss/position limits and idempotent status API.
6. Two real isolated JustMarkets Demo accounts on the operator's Windows VPS tested end-to-end, including disconnect, revocation, stale quotes, spreads, partial fills, and restart.
7. Independent legal/broker authorization review before any real-money, third-party discretionary trading.

Run: `node --test subscriber-demo-policy.test.mjs`.

No API route, trading switch or live-money behavior is changed in this phase.
