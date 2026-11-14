#!/usr/bin/env python3
"""Read-only NABD Phase 15 JustMarkets Demo history readiness diagnostic.

Prints a privacy-conscious JSON report without account login, token, balance,
open orders or passwords. Never calls trading APIs or changes terminal settings.
"""
import argparse
from datetime import datetime, timedelta, timezone
import json
import sys
import time

FRAMES = {"M5": ("TIMEFRAME_M5", 300), "M15": ("TIMEFRAME_M15", 900),
          "H1": ("TIMEFRAME_H1", 3600), "H4": ("TIMEFRAME_H4", 14400)}


def parser():
    p = argparse.ArgumentParser(description="Read-only JustMarkets Demo candle-history preflight")
    p.add_argument("--market", choices=("XAUUSD", "BTCUSD"), required=True)
    p.add_argument("--symbol", required=True, help="Exact Market Watch symbol, e.g. XAUUSD.m")
    p.add_argument("--history-days", type=int, default=730)
    p.add_argument("--warmup-days", type=int, default=130)
    p.add_argument("--terminal-path", help="Optional terminal64.exe, never an MT5 password")
    return p


def diagnose(args, mt5, now=None):
    now = int(time.time() if now is None else now)
    if not isinstance(args.history_days, int) or not 7 <= args.history_days <= 1460:
        raise ValueError("history-days must be 7 to 1460")
    if not isinstance(args.warmup_days, int) or not 30 <= args.warmup_days <= 200:
        raise ValueError("warmup-days must be 30 to 200")
    if not args.symbol.upper().startswith(args.market):
        raise ValueError("Symbol does not match selected market")
    output = {"market": args.market, "brokerSymbol": args.symbol,
              "accountType": "UNKNOWN", "historyDaysRequested": args.history_days,
              "readOnly": True, "brokerAttested": False, "frames": {},
              "readyForHistoricalExport": False, "issues": []}
    if not mt5.initialize(**({"path": args.terminal_path} if args.terminal_path else {})):
        output["issues"].append("MT5_NOT_RUNNING_OR_NOT_INITIALIZED")
        return output
    try:
        account = mt5.account_info()
        if account is None:
            output["issues"].append("MT5_NOT_LOGGED_IN")
            return output
        if account.trade_mode != getattr(mt5, "ACCOUNT_TRADE_MODE_DEMO", 0):
            output["accountType"] = "NON_DEMO"
            output["issues"].append("DEMO_ACCOUNT_REQUIRED")
            return output
        output["accountType"] = "DEMO"
        company = str(getattr(account, "company", "") or "")
        server = str(getattr(account, "server", "") or "")
        if "justmarkets" not in (company + " " + server).lower():
            output["issues"].append("JUSTMARKETS_DEMO_REQUIRED")
            return output
        info = mt5.symbol_info(args.symbol)
        if info is None or not mt5.symbol_select(args.symbol, True):
            output["issues"].append("BROKER_SYMBOL_NOT_IN_MARKET_WATCH")
            return output
        if not all(isinstance(getattr(info, name, None), (int, float)) and
                   getattr(info, name) > 0 for name in
                   ("point", "trade_tick_size", "trade_tick_value_loss")):
            output["issues"].append("BROKER_TICK_VALUE_MISSING")
        # Always use UTC: the current unfinished bar must not be counted.
        end = datetime.fromtimestamp(now, timezone.utc)
        requested_start = end - timedelta(days=args.history_days)
        beginning = requested_start - timedelta(days=args.warmup_days)
        for tf, (constant, step) in FRAMES.items():
            try:
                data = mt5.copy_rates_range(args.symbol, getattr(mt5, constant), beginning, end)
                if data is None:
                    output["frames"][tf] = {"count": 0, "status": "NO_BROKER_HISTORY"}
                    output["issues"].append("NO_" + tf + "_HISTORY")
                    continue
                bars = []
                prev = -1
                disorder = False
                for row in data:
                    at = int(row["time"])
                    if at <= prev:
                        disorder = True
                    prev = at
                    if at + step <= now:
                        bars.append(at)
                count = len(bars)
                minimum = 530 if tf == "M5" else 320
                warmup = sum(t < requested_start.timestamp() for t in bars)
                inside = [t for t in bars if requested_start.timestamp() <= t < now]
                enough = count >= minimum and warmup >= (220 if tf == "M5" else 205)
                covered = bool(inside and inside[0] <= requested_start.timestamp()+5*86400
                               and inside[-1]+step >= now-5*86400)
                gaps = sum(b-a>7*86400 for a,b in zip(inside, inside[1:]))
                ready = enough and covered and not disorder and gaps == 0
                output["frames"][tf] = {
                    "count": count, "earliestUTC": (datetime.fromtimestamp(bars[0],timezone.utc)
                        .isoformat() if bars else None),
                    "latestClosedUTC": (datetime.fromtimestamp(bars[-1]+step,timezone.utc)
                        .isoformat() if bars else None),
                    "warmupBars": warmup, "minimumTotalBars": minimum,
                    "dateRangeCovered": covered, "longGaps": gaps,
                    "status": "READY" if ready else "NOT_READY"
                }
                if count < minimum:
                    output["issues"].append(tf + "_NOT_ENOUGH_CANDLES")
                if warmup < (220 if tf == "M5" else 205):
                    output["issues"].append(tf + "_WARMUP_HISTORY_MISSING")
                if not covered:
                    output["issues"].append(tf + "_TWO_YEAR_RANGE_INCOMPLETE")
                if disorder or gaps:
                    output["issues"].append(tf + "_HISTORY_GAPS_OR_ORDER")
            except (ValueError, TypeError, KeyError, AttributeError) as exc:
                output["frames"][tf] = {"status": "INVALID_HISTORY"}
                output["issues"].append(tf + "_HISTORY_READ_ERROR")
        output["readyForHistoricalExport"] = len(output["issues"]) == 0
        return output
    finally:
        mt5.shutdown()


def main():
    args = parser().parse_args()
    try:
        import MetaTrader5 as mt5
        result = diagnose(args, mt5)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result["readyForHistoricalExport"] else 2
    except (ImportError, ValueError, TypeError, OSError) as exc:
        print(json.dumps({"status": "PREFLIGHT_REFUSED",
            "reason": str(exc), "readOnly": True}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    sys.exit(main())
