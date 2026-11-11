# NABD Agentic AI — isolated research-stage delivery

All changes are confined to `experimental/nabd-agentic-ai-test` and the
`nabd-agentic-ai-test` Render service. **No production services, production
database, MT5 terminals or Telegram order bridge are used.**

## BLS
- Official US BLS monthly datasets are research references, **not** a release-time feed.
- A single batched POST fetches 3 series, not 3 GETs.
- If `NABD_TEST_BLS_REGISTRATION_KEY` is set **only in the isolated Render
  Environment**, it uses registered BLS v2. Otherwise it uses free v1.
- A BLS upstream rejection remains a real blocker. Do not fabricate values or
  silently reuse stale data as current. Official FED/BLS RSS headlines are
  separate from BLS numeric-series API.
- A free v2 registration may be requested from BLS; no registration key is
  present by default.

## Agentic analysis
- `research-brain.mjs`: schema-constrained AI hypothetical thesis, competing
  thesis, evidence, invalidation, risk notes and WAIT/BUY_WATCH/SELL_WATCH.
- Analysis is **only invoked with validated broker DEMO context supplied by a
  future isolated sensor**. Existing Binance BTC spot and gold indicative data
  deliberately fail context validation.
- Model output never grants execution permission, sends an order, or determines
  MT5 lot size. The isolated server exposes GET `/brain/status`, but has no
  arbitrary public endpoint to submit market data or trigger billable AI calls.

## Risk gate
- `shadow-risk-engine.mjs`: conservative risk fraction, side/stop/target,
  reward:risk, spread, quote freshness, exposure, and AI hypothesis alignment.
- Always returns `order:null` and `lotSize:null`. Future lot sizing requires
  verified broker tick size/value, contract size, margin rules and account
  currency conversion. A passing shadow check is NOT a trading authorization.

## Isolated MT5 DEMO sensor contract
- `mt5-demo-sensor.mjs` validates injected DEMO broker observations and
  rejects LIVE accounts, wrong environment, stale quotes or missing contract.
- The research service exposes GET `/demo-sensor/status`; **there is no
  data-ingestion endpoint, MT5 terminal connection, order endpoint, stored
  broker password or production bridge connection**. Live Demo connection
  requires a separately deployed isolated DEMO-only sensor and authenticated
  ingestion, plus end-to-end validation and explicit approval.

## Blockers before allowing any Demo news execution
1. A licensed low-latency FXStreet or equivalent feed; verify webhook signature
   and the official release-time evidence, not vendor record timestamps.
2. Save consensus forecast *before* release and compare to the subsequent actual.
3. Independently measure webhook delivery times on several real CPI/NFP/FOMC releases.
4. Install and authenticate an isolated broker-specific Demo sensor, verify
   bid/ask/spread, candles, tick value, contract specifications and lag.
5. Run and inspect the AI planner with actual, complete DEMO-only context.
6. Test risk sizing, deduplication, rejection audit, broker acknowledgment,
   filled orders and slippage in a separate demo-only environment.
7. Have a documented explicit approval to enable demo order operations.
   Production and LIVE remain out of scope.

## Test
`node --test agentic-experimental/*.test.mjs`
GitHub Actions also runs an isolated PostgreSQL integration test. A passing
CI run does not establish that a remote BLS service or a live broker works.

## November 11 implementation update (isolated only)
- BLS fixed real official `Results:[{series:[]}]` response shape (also retains
  older object parser); v2 uses documented lowercase `registrationkey` field.
- A single BLS v1 POST is still rejected at runtime with
  `BLS_AUTHORIZATION_FAILED` on this Render service. This is an external
  authorization blocker, **not** a successful source connection. The API
  registration form requires manual completion; put the free registration
  key in `NABD_TEST_BLS_REGISTRATION_KEY` on the **experimental service only**.
  Do not put API credentials in GitHub/chat.
- `shadow-pipeline.mjs` validates demo sensor data + multi-timeframe chart,
  runs a research brain only for qualified context, applies shadow risk
  and never creates an order or lot.
- `shadow-smoke.mjs` runs **synthetic** scenarios and publishes status via
  `/shadow-smoke/status`. This is not an MT5 or real OpenAI execution test.
- `/integration/status` lists isolated components and unresolved blockers.
- `mt5-demo-readonly-sensor.py` is an *offline standalone Windows-only*
  read-only sensor for a new, dedicated DEMO terminal. It does not connect
  to Render. It was syntax-tested and safety-tested with mocked MT5 using
  GitHub Actions, **not compiled/tested on a real terminal**.

### Isolated Windows DEMO sensor setup
1. Use a **separate** Windows demo-only installation of MetaTrader 5.
   Do not reuse the production MT5, credentials or VPS session.
2. Install Python and `python -m pip install MetaTrader5` on that
   dedicated Windows test machine.
3. Set `NABD_TEST_MT5_TERMINAL_PATH` to the full path of that separate
   terminal's `terminal64.exe`. Set `NABD_TEST_SENSOR_OUTPUT_DIR` to a local
   output folder.
4. Set `NABD_TEST_GOLD_SYMBOL` and `NABD_TEST_BTC_SYMBOL` to their actual
   broker names (for example `XAUUSD.m` and `BTCUSD.m` only if verified
   on the isolated demo terminal).
5. Run `python agentic-experimental/mt5-demo-readonly-sensor.py` with the
   independent demo terminal logged in. Only a local JSON reference file is
   written; no server uploads, orders, execution, or network publishing.
6. Future authenticated ingestion is a separate engineering stage requiring
   dedicated credentials and endpoint security reviews. Until then
   `/demo-sensor/status` must remain `brokerConnected:false`.
