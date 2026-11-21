# NABD Demo — evidence-based acceptance for trade and economic releases

Scope: **isolated NABD Demo only**. Neither the sensor nor this procedure may operate
a LIVE account, modify production, bypass model/risk gates, or create a fake fill.

## A. Real MT5 order proof, not just an EA ACK

1. Install/update the read-only files `mt5-demo-readonly-sensor.py`,
   `mt5-demo-upload.py` and `run-mt5-demo-continuous.py` from this commit
   **on the dedicated Windows Demo terminal**. See `MT5-DEMO-CONTINUOUS-SETUP.md`.
2. The MT5 terminal must be logged into a valid DEMO account. The sensor and
   executor must use the **same** broker account and exact symbol suffixes.
   Keep the independent Demo sensor HMAC secret private and matched with
   `NABD_TEST_DEMO_SENSOR_HMAC_SECRET` on the experimental Render service.
3. Verify fresh M5/M15/H1/H4 candles and signed sensor acceptance using
   `/demo-sensor/status`. The observer now also reads `history_deals_get`
   and `history_orders_get` **without calling order_send**.
4. The separate Demo EA must poll `/demo-trade/pull` and submit the signed
   ACK to `/demo-trade/ack`. No Demo order can be created when the AI/risk
   gate rejects it, no synthetic trade may replace a genuine event.
5. A valid recorded ACK with an order deal number is **not proof**. The
   independent read-only sensor must subsequently observe the exact deal and
   opening order; the server cross-checks deal ticket, account, DEMO broker,
   symbol, direction, timing and SL/TP against the delivered intent.
6. Check `/demo-trade/status` for `mt5HistoryCrossCheckedFills` and
   `recentDeliveries[].historyProof`. A private token-authenticated
   `GET /demo-trade/history-proofs` returns durable isolated DB evidence
   across server restarts. It will stay empty until a real matching Demo trade.
7. Even this is a **second read of the same broker-connected MT5 terminal**,
   not cryptographically signed proof directly from the broker. For ultimate
   proof, manually cross-check the deal in the broker's client History.

## B. News Actual / Forecast / Previous

1. Obtain **licensed Economic Calendar Streaming** with consensus Forecast
   from Trading Economics, including permitted event access and data rights.
2. Put `NABD_TEST_TRADING_ECONOMICS_STREAM_KEY` and
   `NABD_TEST_TRADING_ECONOMICS_STREAM_SECRET` only in the experimental Render
   service Environment. Do not put them in GitHub, logs, chat or Live.
   Update the test service configuration to restart the stream client.
3. `GET /live-calendar/status` must show stream connection plus received
   high-impact US calendar events. An open socket alone is not data proof.
4. BEFORE release: the licensed feed must provide a consensus Forecast and
   the test PostgreSQL journal must save its first observed pre-release value.
5. AFTER release: store first observed Actual with corresponding Previous from
   the same licensed stream. The protected `GET /live-news/evidence` reports
   original Actual, immutable pre-release Forecast, Previous and first observed
   timestamps after an actual provider event.
6. `observationSecondsAfterScheduled` only measures the interval from the
   event's *scheduled* time to our received time. It **is not independently
   verified release-to-delivery latency**. Do not enable news-triggered trade
   execution without confirmed provider entitlement, trusted independent
   publication timestamp and measured release-to-delivery lag across live
   events; release timestamp verification cannot be inferred from vendor
   `LastUpdate`, MT5 tick time or public RSS.
7. BLS numeric API returning HTTP 503 does not grant a usable consensus feed.
   Federal Reserve/BLS RSS headlines and historical releases are reference
   sources; no proxy or artificial estimates may be presented as real-time.

## C. Release and rollback boundary

- Run isolated Node, Python mock and separate PostgreSQL tests in GitHub Actions.
- Deploy **only** `nabd-agentic-ai-test` from experimental branch after success.
- Keep `NABD_TEST_DEMO_AUTO_EXECUTION` and all existing Demo safety constraints
  unchanged. No LIVE endpoint, database or trade permissions are modified.
- If the Windows Demo sensor/executor is unreachable, proof is **PENDING**.
  If provider credentials are absent, news is **NOT_CONFIGURED**.
  Never display either as a successful end-to-end integration.
