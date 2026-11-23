# NABD Demo Executor v1.24 — secure replacement / استبدال آمن

> ISOLATED Demo ONLY. Never use on a Live account. **Do not enable Algo Trading until all preflight checks pass.**
> This file does NOT contain an HMAC execution secret. A value leaked from v1.23 must be replaced separately on Render Demo and in MT5.

## What changed
- Source no longer embeds `NABD_TEST_DEMO_EXEC_HMAC_SECRET` as a hardcoded #define; local input `InpExecHmacSecret` starts empty.
- `InpMaxTradesPerDay=8` means **all gold + BTC entries combined per broker day**; `InpMaxBtcTradesPerDay=6` is the additional BTC-only limit. The most restrictive limit wins.
- `InpMaxDailyEquityLossPct=2.0` maximum; per order `riskPct<=0.4%` and stop/target and broker-based lot/margin checks remain.
- EA refuses to pull one-use intents while MetaTrader Algo Trading is disabled, preventing orders being consumed and marked as delivered without execution rights.
- Fail-closed if the one-order-per-bar broker terminal global-variable guard cannot be persisted.
- A failed signed ACK makes one additional bounded POST attempt; the **broker order is never resent**. MT5 History must still independently match the reported deal.

## Mandatory VPS steps
1. Keep MT5 **JustMarkets Demo**, do not use production. Confirm account and VPS timezone, broker symbols `XAUUSD.m` and `BTCUSD.m`. Ensure no open Demo position depends on the current EA management.
2. In MT5 remove **only** the old `NABD_Demo_Trade_Executor` from `BTCUSD.m,M15` chart (keep Observer & History Verifier on their own charts); close Algo Trading globally. Back up the old local .mq5 and .ex5 outside the MT5 Experts folder.
3. Copy `NABD_Demo_Trade_Executor_Safe_v1_24.mq5` to `File > Open Data Folder > MQL5 > Experts`. Compile in MetaEditor F7. **0 errors required.** If compilation is not clean, do not attach it. The provided file is source-only, NOT a previously compiled .ex5.
4. Rotate **only** `NABD_TEST_DEMO_EXEC_HMAC_SECRET` on Render **test**. Paste exactly the same new private secret into MT5 `InpExecHmacSecret` locally (>=32 ASCII, max 128). Do not reuse History or Sensor HMAC keys. Never post secret in chat/screenshots or commit it to GitHub.
5. Attach v1.24 to BTCUSD.m,M15. Set `InpEnableDemoAutoTrading=false`, `InpMaxTradesPerDay=8`, `InpMaxBtcTradesPerDay=6`, `InpMaxDailyEquityLossPct=2`, `InpAllowedDemoAccountLogin` to the actual private Demo login if desired; confirm symbols.
6. `Tools > Options > Expert Advisors`: allow WebRequest URL `https://nabd-agentic-ai-test.onrender.com` only. Leave global Algo Trading OFF pending deliberate Demo order authorization.
7. Re-check `/demo-sensor/status` (two fresh, same-account brokers), `/demo-history/status` (accepted, rejected=0) and `/demo-trade/status` (Demo only, no unexpected queued or overdue ACK). **Executor may not show online while deliberately disabled** due to the pre-pull gate. This does not mean Render is down.
8. Before any intentional Demo execution test, separately approve enabling Algo Trading and local `InpEnableDemoAutoTrading=true`. An AI/risk-approved order may be placed immediately after both are on. Confirm risk/contract min-lot and existing positions first.
9. After a qualified AI signal, require server `created>0`, `delivered>0`, signed `brokerAcks>0` and `mt5HistoryCrossCheckedFills>0`, cross-check actual MT5 broker History and SL/TP. Until then do **not** claim the end-to-end trade pipeline is proven.

## Recovery
If a test reveals any discrepancy, immediately set local `InpEnableDemoAutoTrading=false` and global Algo Trading OFF. Keep current broker-managed SL/TP for existing positions; do not reinstall Windows or delete MT5 broker history. ACK retries are bounded and audit-only; no duplicate order replay.
