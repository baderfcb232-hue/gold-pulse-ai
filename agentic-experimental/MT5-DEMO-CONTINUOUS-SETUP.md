# Isolated Windows Demo sensor - safe continuous operation

This procedure is for a **dedicated MT5 DEMO** terminal on the Windows VPS.
It never connects to NABD production or submits orders. The trade executor EA
is a **separate program**; this supervisor does not start or replace it.

## Prerequisites (set locally on Windows, never in GitHub/chat)

- A separate Windows MT5 terminal logged into the correct DEMO broker account.
- Python with `MetaTrader5` installed, and synchronized Windows time.
- `NABD_TEST_MT5_TERMINAL_PATH` = exact dedicated `terminal64.exe`.
- `NABD_TEST_SENSOR_OUTPUT_DIR` = dedicated local writable directory.
- `NABD_TEST_GOLD_SYMBOL`, `NABD_TEST_BTC_SYMBOL` = verified MT5 Market Watch symbols.
- `NABD_TEST_DEMO_SENSOR_HMAC_SECRET` = unique >=32-byte isolated key matching
  the TEST Render service; not the executor key, never the production key.
- Confirm `NABD_TEST_DEMO_SENSOR_HMAC_SECRET` exists already in the TEST Render
  environment. Do not copy its value into a support ticket or logs.

## Run and verify

In a PowerShell window within the Windows DEMO account/user session:

```powershell
python -m pip install MetaTrader5
python .\agentic-experimental\run-mt5-demo-continuous.py
```

- `NABD_DEMO_SENSOR_CYCLE_OK` means the *read-only* sensor upload returned 202
  with a valid OBSERVED response. It is **not** evidence of an executed trade.
- A failure backs off for 15 seconds; no snapshots are replayed and no
  freshness checks are relaxed. Successful cycles refresh every 5 seconds.
- Check `https://nabd-agentic-ai-test.onrender.com/demo-sensor/status`:
  accepted increases, XAUUSD and/or BTCUSD has a fresh observation and the
  rejection counters do not climb. On weekends XAUUSD may correctly be BLOCKED
  while BTC is fresh; do not bypass stale-tick rules to force both green.
- Check `/auto-brain/status` only after a verified **closed M5** candle; a WAIT
  can be a legitimate risk decision, not a network outage.
- Check `/demo-trade/status` for `executorOnline`. It needs the **separate**
  correctly signed MT5 Demo Executor EA, using the different execution HMAC key.
- An ACK + MT5 History + actual broker Deal, SL, and TP are required for an
  execution proof; the Python sensor alone never trades.

## Startup after Windows reboot

Create a Windows Task Scheduler task **for the same interactive DEMO user**
to run the command above *only when that user is logged on*. Set the working
directory to the repository root and enable restart on failure. Configure the
user environment variables securely before launching the task; Task Scheduler
may not see newly set variables until that user logs in again. Ensure MT5 starts
and connects to the correct DEMO account first. Do not use a production user
session, and do not log off the Windows desktop session used by MT5.

## Fail-closed conditions

If the broker is closed, tick is stale, the certificate/HMAC fails, or account
identity is not verifiable, the cycle must fail. There is no automatic trade
retry, security fallback, artificial candle, or LIVE trading mode.
