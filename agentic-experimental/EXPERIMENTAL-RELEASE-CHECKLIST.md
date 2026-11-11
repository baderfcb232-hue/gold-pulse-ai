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
