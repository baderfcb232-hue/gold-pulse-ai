"""NABD Agentic historical broker bars export. DEMO only, READ ONLY.
Creates point-in-time replay input with EMPTY decisions unless a separate archive
is explicitly supplied. This never generates fake historical AI decisions.
No account passwords/login identifiers are written to disk. Requires Windows MT5
open and `pip install MetaTrader5`. Export ONLY to a local private folder.
"""
import argparse
import json
import math
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

TF_SECONDS = {"M5": 300, "M15": 900, "H1": 3600, "H4": 14400}
def positive(value, name, allow_zero=False):
    if not math.isfinite(value) or (value < 0 if allow_zero else value <= 0):
        raise ValueError("INVALID_" + name)
    return value

def export(args):
    try:
        import MetaTrader5 as mt5
    except ImportError:
        raise RuntimeError("Install MetaTrader5: python -m pip install MetaTrader5")
    if not mt5.initialize():
        raise RuntimeError("MT5_INITIALIZE_FAILED_OPEN_DEMO_TERMINAL_FIRST")
    try:
        acc = mt5.account_info()
        if not acc or acc.trade_mode != mt5.ACCOUNT_TRADE_MODE_DEMO:
            raise RuntimeError("NOT_A_VERIFIED_DEMO_ACCOUNT")
        server = str(acc.server or "")
        if "demo" not in server.lower() or len(server) > 100:
            raise RuntimeError("DEMO_SERVER_NAME_NOT_VERIFIED")
        if str(acc.currency or "").upper() != "USD":
            raise RuntimeError("ACCOUNT_CURRENCY_MUST_BE_USD_FOR_USD_RISK_REPORT")
        utc_now = datetime.now(timezone.utc)
        begin = utc_now - timedelta(days=args.days)
        end_time = int(utc_now.timestamp())
        symbols = {}
        for canonical, broker_symbol in (("XAUUSD", args.gold), ("BTCUSD", args.btc)):
            if not broker_symbol or len(broker_symbol) > 64:
                raise RuntimeError("INVALID_BROKER_SYMBOL")
            if not mt5.symbol_select(broker_symbol, True):
                raise RuntimeError("SYMBOL_NOT_AVAILABLE_" + canonical)
            spec = mt5.symbol_info(broker_symbol)
            if spec is None:
                raise RuntimeError("MISSING_BROKER_CONTRACT_" + canonical)
            point = positive(float(spec.point), "POINT")
            tick_size = positive(float(spec.trade_tick_size), "TICK_SIZE")
            tick_value_loss = positive(float(spec.trade_tick_value_loss), "TICK_VALUE_LOSS")
            min_lot = positive(float(spec.volume_min), "MIN_VOLUME")
            max_lot = positive(float(spec.volume_max), "MAX_VOLUME")
            step = positive(float(spec.volume_step), "LOT_STEP")
            quotes = {}
            for tf, seconds in TF_SECONDS.items():
                rates = mt5.copy_rates_range(
                    broker_symbol,
                    getattr(mt5, "TIMEFRAME_" + tf),
                    begin, utc_now
                )
                if rates is None or len(rates) < 2:
                    raise RuntimeError("MISSING_BROKER_HISTORY_" + canonical + "_" + tf)
                records = []
                for r in rates:
                    t = int(r["time"])
                    if t + seconds > end_time:
                        continue  # discard still forming broker candles
                    o, h, l, c = [float(r[k]) for k in
                                   ("open", "high", "low", "close")]
                    if (t <= 0 or l <= 0 or h < max(o, c) or l > min(o, c)
                            or not all(math.isfinite(x) for x in (o, h, l, c))):
                        raise RuntimeError("INVALID_BROKER_CANDLE_" + canonical + "_" + tf)
                    records.append(dict(time=t, open=o, high=h, low=l, close=c))
                if any(records[i]["time"] <= records[i-1]["time"]
                       for i in range(1, len(records))):
                    raise RuntimeError("NON_MONOTONIC_HISTORY_" + canonical + "_" + tf)
                if not records:
                    raise RuntimeError("EMPTY_CLOSED_HISTORY_" + canonical + "_" + tf)
                quotes[tf] = records
            span_days = (quotes["M5"][-1]["time"] - quotes["M5"][0]["time"]) / 86400.0
            if span_days < 730:
                print("WARNING: " + canonical + " only %.1f days of M5 history; "
                      "increase MT5 Tools > Options > Charts > Max bars in chart "
                      "and reload historic broker candles." % span_days,
                      file=sys.stderr)
            costs = dict(
                spreadPrice=args.gold_spread_points * point if canonical == "XAUUSD"
                    else args.btc_spread_points * point,
                slippagePrice=args.slippage_points * point,
                commissionPerLotRoundTrip=args.commission_per_lot,
                tickSize=tick_size, tickValueLoss=tick_value_loss,
                minLot=min_lot, maxLot=max_lot, lotStep=step,
                startingEquityUsd=args.starting_equity_usd,
                maxHoldSeconds=900
            )
            symbols[canonical] = dict(
                brokerServer=server, brokerSymbol=broker_symbol,
                costs=costs, candles=quotes, decisions=[]
            )
            print(canonical, "M5", len(quotes["M5"]), "coverage days", round(span_days, 2))
        # Research-journal exports are not automatically available. Only accept
        # an explicitly supplied JSON list with point-in-time bid/ask/quoteAt.
        if args.decisions:
            decision_data = json.loads(Path(args.decisions).read_text(encoding="utf-8"))
            if not isinstance(decision_data, list):
                raise RuntimeError("DECISIONS_MUST_BE_JSON_ARRAY")
            required = {"symbol", "analyzedAt", "closedBarTime", "stance",
                        "confidence", "bid", "ask", "quoteAt"}
            for d in decision_data:
                if (not isinstance(d, dict) or not required.issubset(d)
                        or d["symbol"] not in symbols):
                    raise RuntimeError("INVALID_ARCHIVED_DECISION")
                symbols[d["symbol"]]["decisions"].append(
                    {key: d[key] for key in sorted(required) if key != "symbol"}
                )
            for market in symbols.values():
                market["decisions"].sort(key=lambda x: x["analyzedAt"])
        result = dict(schema="NABD_AGENTIC_PIT_REPLAY_V1",
                      source="BROKER_EXPORT_WITH_ARCHIVED_AI_DECISIONS",
                      provenanceNote="Broker MT5 history is real DEMO export; "
                                     "spreads and slippage are assumed; "
                                     "AI decisions are only user-provided archives.",
                      marketDataExportedAt=utc_now.isoformat(),
                      markets=symbols)
        outfile = Path(args.output).resolve()
        outfile.parent.mkdir(parents=True, exist_ok=True)
        outfile.write_text(json.dumps(result, separators=(",", ":")),
                           encoding="utf-8")
        print("SUCCESS: wrote", str(outfile))
        print("NOTE: With no --decisions file, the replay must say NOT TESTABLE. "
              "Do not label it a two-year AI performance result.")
    finally:
        mt5.shutdown()

def main():
    ap = argparse.ArgumentParser(description="NABD Demo historical bars exporter (NO TRADES)")
    ap.add_argument("--output", default="nabd_agentic_2y_input.json")
    ap.add_argument("--gold", default="XAUUSD.m")
    ap.add_argument("--btc", default="BTCUSD.m")
    ap.add_argument("--days", type=int, default=731)
    ap.add_argument("--gold-spread-points", type=float, required=True)
    ap.add_argument("--btc-spread-points", type=float, required=True)
    ap.add_argument("--slippage-points", type=float, required=True)
    ap.add_argument("--commission-per-lot", type=float, required=True,
                    help="Round-trip USD commission per 1.0 lot")
    ap.add_argument("--starting-equity-usd", type=float, default=2000)
    ap.add_argument("--decisions", default=None,
                    help="Optional historic AI decision archive (JSON list, point-in-time)")
    args = ap.parse_args()
    if args.days < 730 or args.days > 800:
        ap.error("--days must cover >=730 and <=800 calendar days")
    for label in ("gold_spread_points", "btc_spread_points",
                  "slippage_points", "commission_per_lot"):
        positive(float(getattr(args, label)), label, allow_zero=True)
    positive(float(args.starting_equity_usd), "STARTING_EQUITY")
    export(args)

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("NABD_BACKTEST_EXPORT_FAILED:", type(exc).__name__,
              str(exc) if isinstance(exc, (ValueError, RuntimeError)) else "INTERNAL_ERROR",
              file=sys.stderr)
        sys.exit(1)
