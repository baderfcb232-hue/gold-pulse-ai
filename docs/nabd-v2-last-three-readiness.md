# NABD: 100-MT5-account readiness (engineering audit)

This is a **capability audit**, not a claim of 100 deployed trading accounts.

## Verified in current architecture

- The existing server maintains one active gold MT5 snapshot and one BTC snapshot per process (`snapshot` and `btcSnapshot`).
- Each snapshot is bound to an account/broker/symbol/EA Magic identity and rejects another source for the same slot.
- Concurrent HTTP reading, or many SSE connections, **does not** mean 100 isolated MT5 trading accounts.
- The isolated stress regression simulates 100 account identities and asserts that unrelated accounts cannot overwrite the connected source.
- The synthetic broker-deal regression verifies the exact Demo deal ticket, source, side, entry, volume and time requirements before displaying `FILLED`. It cannot prove that a live VPS actually opened a position.

## Required before deploying the multi-account service

1. Design a tenant/account keyed store (not a global gold/btc snapshot). Use a unique server-side account ID, symbol and Magic, and strict tenant authorization.
2. Keep secrets and MT5 credentials out of dashboards, logs and front-end storage; use encrypted server-side secret storage with per-tenant audit and revoke flows.
3. Use separate MT5 terminal/account sessions on the central Windows VPS (or a verified broker API that supports account sessions). MT5 is not a generic multi-user order executor.
4. Design tenant- and source-scoped queues, durable idempotency keys, MT5 retcode + deal-ticket reconciliation, and independent heartbeat/quote freshness per account.
5. Test both Gold and BTC cross-account isolation, two simultaneous recommendations, crashes/restarts, out-of-order quotes, permissions, risk limits and failed broker orders.
6. Benchmark 100 **actual** concurrent Demo sessions on the selected VPS; measure CPU, RAM, broker throttling, disk/log volume and order latency. Never stress the current live trading service.
7. Keep current GOLD/BTC FUSION EAs and strategies unchanged until the new architecture passes Demo and operator sign-off.

## Evidence needed for live Demo execution

An operator may confirm a fill **only** by matching a broker deal ticket returned by the EA to a `deals[]` record from the same account, broker symbol, side and a valid entry time. `SUBMITTED`, `DISPATCHED`, a signal notification or a filled-looking chart is not evidence.

## iOS / Android PWA

Automated iOS-WebKit/iPad and Android-Chromium emulation validates layouts, language, manifest, icons and service workers. A native Home Screen installation and launch still requires a physical device. No remote connector in this workflow can tap Safari/Chrome on the user's phones.
