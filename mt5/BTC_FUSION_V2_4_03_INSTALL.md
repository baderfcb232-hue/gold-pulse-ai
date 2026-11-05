# NABD BTC FUSION V2 4.03 — Demo installation

This is a **BTC-only, integrated, single-EA** MT5 package. It embeds the bridge.
**Do not attach** `NABD_Bridge_EA.mq5` on a second BTC chart with the same account/magic.
The XAUUSD EA and server-side Gold strategy are unchanged.

## Files
- `NABD_BTC_FUSION_V2_4_03_Demo.mq5`: complete EA source with network bridge.
- `NABD_BTC_FUSION_V2_4_03_Demo.set`: safe Demo preset, without credentials.

## Installation
1. On the **execution VPS** in MT5, open **File > Open Data Folder > MQL5 > Experts**.
2. Place the .mq5 file there. Open it in MetaEditor (F4) and compile (F7). Verify **0 errors**. This repository's CI cannot compile MQL5.
3. Remove the previous BTC EA and any additional `NABD_Bridge_EA` instance from BTC charts on the same terminal. Leave Gold alone.
4. Attach the compiled EA to the exact JustMarkets **Demo** BTCUSD symbol (including broker suffix). Load the .set preset.
5. Enter the current `MT5_INGEST_TOKEN` in `InpNABDToken`; it is intentionally absent from the preset. Do not share it in chat or screenshots.
6. Under **Tools > Options > Expert Advisors**, allow WebRequest for `https://gold-pulse-ai.onrender.com`.
7. Enable Algo Trading only in the **Demo** environment, confirm an active tick and allow the EA to send a full MT5 snapshot.
8. Check **Experts / Journal** for HTTP errors, stale tick warnings and broker rejections. In NABD verify `BTCUSD` quote freshness, strategy `FUSION`, per-symbol bridge state and the exact reason a recommendation is waiting.
9. Make one properly qualified Demo signal and verify its recommendation ID, approval, MT5 deal ticket and trade history before considering the workflow operational.

## What this fixes, and what it does not
- Includes the quote preflight from bridge PR #114 in the **integrated** BTC EA, so fast ticks can arrive before expensive MT5 calendar/closed-history work.
- Server-side BTC FUSION timeframe hierarchy is already merged separately; H1/H4 confirmed opposition still vetoes an entry.
- Preserves calendar, spread, quote-age, stop, risk and explicit Demo-execution safety gates. No arbitrary forced trades.
- **Not** a guarantee of uninterrupted prices during Render restart or exchange downtime. A quote-only update never proves the EA is alive or authorizes orders.
- **Not** a guarantee of profitable/instant signals, Telegram delivery or an executed deal. These require live Demo checks.
- Do **not** use this Demo-only EA on a real-money account; it intentionally refuses initialization.

## Troubleshooting
- `STALE_MT5`: check updated EA is running on VPS, Internet/WebRequest permissions, terminal symbol/ticks, MetaTrader Journal, exact source key and Render deploy state.
- `WAITING_WEBSITE_PLAN`: a fully eligible broker-sourced signal is not present; examine FUSION checks rather than weakening safety.
- HTTP 401: check the ingest token entered locally, not a dashboard login token.
- HTTP 409 or broker source mismatch: use the same account, broker symbol suffix and magic `26092302`; never silently reset identities.
- `PRICE_OR_SPREAD_MOVE`: inspect live bid/ask, brokerage constraints and quote age. Do not remove spread and slippage checks just to force execution.
