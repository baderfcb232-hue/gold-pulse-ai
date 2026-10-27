# NABD gold strategy switch — reversible

The former gold recommendation engine was preserved verbatim as
`archive/legacy-gold-engine-20261027.mjs` (the production `engine.mjs` before scalping).
The executable `engine.mjs` still contains that exact legacy analyzer.

Set **one Render environment variable**:

- `NABD_GOLD_SIGNAL_STRATEGY=SCALP`: broker-backed gold M5/M15 scalping recommendations, eligible for website + Telegram publication with all source/news/spread gates. This mode **hard-blocks automatic website gold order dispatch** (`SCALP_RECOMMENDATIONS_ONLY`); no MT5 EA changes.
- `NABD_GOLD_SIGNAL_STRATEGY=EMA_LEGACY`: restore original gold recommendation selection. Do not confuse this rollback with authorization to execute orders: legacy Demo execution settings remain independently controlled.

Only XAUUSD broker OHLC signal selection changes. BTC, accounts, MT5 bridge, risk limits,
historical records and saved old signals are unchanged. Signals from inactive
strategies stay in history but are not re-published or treated as current.

Scalping uses closed M5/M15 candles, M15 EMA8/21 directional bias, M5 breakout and
EMA8/21 + RSI confirmation, ATR/swing stop, TP1=1R, TP2=1.5R, 5-minute expiry.
H1/H4 provide context; a counter-H4 opportunity needs a stronger breakout and momentum.
High-impact USD news, stale source/candles/calendar and excessive spreads fail closed.

Signals are not guarantees of success. No claim of profit or win rate was made, and
a 320-bar rolling candle window is **not** a multi-month backtest.
