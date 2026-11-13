#!/usr/bin/env python3
"""NABD Strategy Lab Phase15: read-only MetaTrader5 Demo historical export.

No broker password, no order placement, no terminal trading controls.
Exports user-confirmed broker OHLC with user-supplied cost assumptions;
the report is NOT independent broker attestation.
"""
import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import time

TIMEFRAMES = {"M5": 300, "M15": 900, "H1": 3600, "H4": 14400}


def strict_utc_date(raw):
    try:
        if len(raw) != 10 or raw[4] != "-" or raw[7] != "-":
            raise ValueError("Use YYYY-MM-DD")
        value = datetime.strptime(raw, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        if value.strftime("%Y-%m-%d") != raw:
            raise ValueError("Invalid day")
        return value
    except ValueError as exc:
        raise argparse.ArgumentTypeError(str(exc)) from exc


def nonnegative(raw):
    value = float(raw)
    if not 0 <= value < float("inf"):
        raise argparse.ArgumentTypeError("Expected a finite nonnegative cost")
    return value


def positive(raw):
    value = nonnegative(raw)
    if value <= 0:
        raise argparse.ArgumentTypeError("Expected positive broker margin")
    return value


def closed_rates(raw, seconds, now, until=None):
    """No open/future candle; explicit OHLC sanity and ascending time."""
    if raw is None:
        raise ValueError("MT5 history is unavailable; check symbol and chart history")
    out, last = [], -1
    for item in raw:
        stamp = int(item["time"])
        high, low = float(item["high"]), float(item["low"])
        opening, closing = float(item["open"]), float(item["close"])
        if stamp <= last or opening <= 0 or closing <= 0 or low <= 0 or high <= 0:
            raise ValueError("Invalid/unsorted MT5 historical candle")
        if high < max(opening, closing) or low > min(opening, closing) or high < low:
            raise ValueError("Inconsistent broker OHLC data")
        last = stamp
        if stamp + seconds <= now and (until is None or stamp + seconds <= until):
            out.append({
                "time": stamp, "open": opening, "high": high,
                "low": low, "close": closing, "tick_volume": int(item["tick_volume"])
            })
    return out


def parser():
    p = argparse.ArgumentParser(description="NABD read-only JustMarkets Demo historical export")
    p.add_argument("--market", choices=["XAUUSD", "BTCUSD"], required=True)
    p.add_argument("--symbol", required=True, help="Exact MT5 broker symbol, e.g. XAUUSD.m")
    p.add_argument("--from", dest="from_date", type=strict_utc_date, required=True)
    p.add_argument("--to", dest="to_date", type=strict_utc_date, required=True)
    p.add_argument("--spread-points", type=nonnegative, required=True)
    p.add_argument("--commission-per-lot", type=nonnegative, required=True,
                   help="Round-trip commission in account currency for 1 lot")
    p.add_argument("--slippage-points", type=nonnegative, required=True)
    p.add_argument("--margin-per-lot", type=positive, required=True,
                   help="Broker-calculated margin for 1 lot, not the account balance")
    p.add_argument("--terminal-path", default=None, help="Optional terminal64.exe path")
    p.add_argument("--output", type=Path, required=True)
    return p


def run(args, mt5, now=None):
    now = int(now if now is not None else time.time())
    if args.to_date <= args.from_date:
        raise ValueError("Historical end date must be after start date")
    if args.to_date.timestamp() > now + 86400:
        raise ValueError("Historical end date is in the future")
    if not args.symbol.upper().startswith(args.market):
        raise ValueError("Requested broker symbol is not the selected market")
    if not args.output.name.lower().endswith(".json"):
        raise ValueError("Output must be a JSON filename")
    if not mt5.initialize(**({"path": args.terminal_path} if args.terminal_path else {})):
        raise ValueError("MT5 initialization failed. Start Demo terminal first")
    try:
        account = mt5.account_info()
        demo_mode = getattr(mt5, "ACCOUNT_TRADE_MODE_DEMO", 0)
        if not account or account.trade_mode != demo_mode:
            raise ValueError("Only an already signed-in MT5 Demo account is allowed")
        company = str(account.company or "")
        server = str(account.server or "")
        if "justmarkets" not in (company + " " + server).lower():
            raise ValueError("Only JustMarkets Demo is supported by this isolated export")
        info = mt5.symbol_info(args.symbol)
        if not info or not mt5.symbol_select(args.symbol, True):
            raise ValueError("Broker symbol unavailable in Market Watch")
        if not all(isinstance(v,(int,float)) and v > 0 for v in [info.point, info.trade_tick_size, info.trade_tick_value_loss]):
            raise ValueError("Broker tick point, tick size and loss value required")

        # Pull extra history for 320 closed H4 bars and weekends/DST.
        earliest = args.from_date - timedelta(days=130)
        to_time = min(args.to_date, datetime.fromtimestamp(now,timezone.utc))
        histories = {}
        frame_keys = {
            "M5": mt5.TIMEFRAME_M5, "M15": mt5.TIMEFRAME_M15,
            "H1": mt5.TIMEFRAME_H1, "H4": mt5.TIMEFRAME_H4
        }
        for name, seconds in TIMEFRAMES.items():
            raw = mt5.copy_rates_range(args.symbol, frame_keys[name], earliest, to_time)
            histories[name] = closed_rates(raw, seconds, now, int(to_time.timestamp()))
            minimum = 530 if name == "M5" else 320
            if len(histories[name]) < minimum:
                raise ValueError(
                    f"Not enough closed {name} bars ({len(histories[name])}). "
                    "In MT5 Tools > Options > Charts increase Max bars in chart, reload history and try again."
                )

        # Do not report a two-year test from a handful of recent bars.
        # Require 220 M5 warmup bars, date coverage, and no week-long holes.
        requested_start = int(args.from_date.timestamp())
        requested_end = int(args.to_date.timestamp())
        m5 = histories["M5"]
        prehistory = sum(bar["time"] < requested_start for bar in m5)
        selected = [bar for bar in m5 if requested_start <= bar["time"] < requested_end]
        if prehistory < 220 or not selected:
            raise ValueError("Missing 220 M5 warmup bars or requested historical dates")
        if selected[0]["time"] > requested_start + 5 * 86400 or (
                selected[-1]["time"] + 300 < requested_end - 5 * 86400):
            raise ValueError("MT5 history does not cover the requested start/end dates")
        if any(right["time"] - left["time"] > 7 * 86400
               for left, right in zip(selected, selected[1:])):
            raise ValueError("MT5 history has a gap longer than seven days")

        data = {
            "symbol": args.market,
            "broker_symbol": args.symbol,
            "provenance": {
                "format": "MT5_HISTORY_EXPORT", "broker": company, "server": server,
                "exportedAt": now,
                "note": "Collected read-only from a user-side Demo terminal; not independently attested."
            },
            "spec": {
                "point": float(info.point), "tick_size": float(info.trade_tick_size),
                "tick_value_loss": float(info.trade_tick_value_loss),
                "tick_value_profit": float(info.trade_tick_value_profit or info.trade_tick_value_loss),
                "volume_min": float(info.volume_min), "volume_max": float(info.volume_max),
                "volume_step": float(info.volume_step), "margin_per_lot": args.margin_per_lot,
                "digits": int(info.digits), "currency": str(account.currency or "USD")
            },
            "spread_points": args.spread_points,
            "slippage_points": args.slippage_points,
            "commission_per_lot": args.commission_per_lot,
            "calendar": {"status": "disabled", "events": []},
            "candles": histories
        }
        # Exclusive creation: NEVER overwrite previous experiments.
        with args.output.open("x", encoding="utf-8") as stream:
            json.dump(data, stream, separators=(",", ":"), ensure_ascii=False)
            stream.write("\n")
        return {"market": args.market, "symbol": args.symbol,
                "frames": {k:len(v) for k,v in histories.items()},
                "savedTo": str(args.output),
                "readOnly": True, "brokerAttested": False}
    finally:
        mt5.shutdown()


def main():
    args = parser().parse_args()
    try:
        import MetaTrader5 as mt5  # Windows MetaTrader5 package, no import during unit tests
        info = run(args, mt5)
        print(json.dumps(info, ensure_ascii=False, indent=2))
    except (ImportError, OSError, ValueError, FileExistsError) as exc:
        print("NABD Phase15 refused: "+str(exc), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
