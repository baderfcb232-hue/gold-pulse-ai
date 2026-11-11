"""Isolated NABD research sensor for a dedicated Windows MT5 DEMO terminal.

NO orders. NO broker passwords. NO HTTP connections. NO Telegram. NO production.
Install MetaTrader5 for Python in the independent Windows DEMO environment.
Set NABD_TEST_MT5_TERMINAL_PATH to a dedicated MT5 terminal.exe path.
Optional: set NABD_TEST_GOLD_SYMBOL / NABD_TEST_BTC_SYMBOL to broker names.
Writes sanitized research snapshots to NABD_TEST_SENSOR_OUTPUT_DIR locally.
"""
import json
import os
import sys
import time
from pathlib import Path

TIMEFRAMES = ("M5", "M15", "H1", "H4")
MARKETS = {
    "XAUUSD": "NABD_TEST_GOLD_SYMBOL",
    "BTCUSD": "NABD_TEST_BTC_SYMBOL",
}

def require_demo(mt5):
    account = mt5.account_info()
    if account is None:
        raise RuntimeError("NO_MT5_ACCOUNT")
    if account.trade_mode != mt5.ACCOUNT_TRADE_MODE_DEMO:
        raise RuntimeError("LIVE_OR_CONTEST_ACCOUNT_REJECTED")
    server = str(account.server or "")
    if "demo" not in server.lower() or len(server) > 100:
        raise RuntimeError("BROKER_DEMO_SERVER_NOT_VERIFIED")
    return server

def closed_bars(mt5, symbol, timeframe, now):
    unit = {"M5": 300, "M15": 900, "H1": 3600, "H4": 14400}[timeframe]
    interval = getattr(mt5, "TIMEFRAME_" + timeframe)
    bars = mt5.copy_rates_from_pos(symbol, interval, 1, 100)
    if bars is None or len(bars) < 2:
        raise RuntimeError("BROKER_CANDLES_MISSING_" + timeframe)
    result = []
    for bar in bars:
        item = {
            "time": int(bar["time"]), "open": float(bar["open"]),
            "high": float(bar["high"]), "low": float(bar["low"]),
            "close": float(bar["close"]),
        }
        if item["time"] + unit > now or item["time"] <= 0:
            raise RuntimeError("UNFINISHED_CANDLE_" + timeframe)
        result.append(item)
    result.sort(key=lambda x: x["time"])
    return result

def capture(mt5, canonical, broker_symbol, now, server):
    if not broker_symbol or len(broker_symbol) > 64:
        raise RuntimeError("INVALID_BROKER_SYMBOL")
    if not mt5.symbol_select(broker_symbol, True):
        raise RuntimeError("BROKER_SYMBOL_UNAVAILABLE_" + canonical)
    tick = mt5.symbol_info_tick(broker_symbol)
    spec = mt5.symbol_info(broker_symbol)
    if tick is None or spec is None:
        raise RuntimeError("BROKER_TICK_OR_CONTRACT_MISSING_" + canonical)
    bid, ask = float(tick.bid), float(tick.ask)
    if bid <= 0 or ask <= bid or now - int(tick.time) > 2 or int(tick.time) > now:
        raise RuntimeError("STALE_OR_INVALID_QUOTE_" + canonical)
    tick_size = float(spec.trade_tick_size)
    tick_value = float(spec.trade_tick_value)
    contract = float(spec.trade_contract_size)
    if tick_size <= 0 or tick_value <= 0 or contract <= 0:
        raise RuntimeError("INVALID_BROKER_CONTRACT_" + canonical)
    payload = {
        "environment": "EXPERIMENTAL_NABD_AGENTIC", "accountType": "DEMO",
        "executionEnabled": False, "symbol": canonical,
        "brokerSymbol": broker_symbol, "brokerServer": server,
        "timestamp": int(tick.time), "bid": bid, "ask": ask,
        "tickSize": tick_size, "tickValue": tick_value,
        "contractSize": contract,
    }
    for frame in TIMEFRAMES:
        payload["candles" + frame] = closed_bars(mt5, broker_symbol, frame, now)
    return payload

def main():
    terminal = os.environ.get("NABD_TEST_MT5_TERMINAL_PATH")
    output_dir = os.environ.get("NABD_TEST_SENSOR_OUTPUT_DIR")
    if not terminal or not output_dir:
        raise RuntimeError("ISOLATED_TERMINAL_PATH_AND_OUTPUT_DIR_REQUIRED")
    if not Path(terminal).is_file():
        raise RuntimeError("ISOLATED_TERMINAL_EXE_NOT_FOUND")
    import MetaTrader5 as mt5
    if not mt5.initialize(path=str(Path(terminal).resolve()), portable=True):
        raise RuntimeError("ISOLATED_DEMO_MT5_INITIALIZE_FAILED")
    try:
        server = require_demo(mt5)
        now = int(time.time())
        results = {}
        for canonical, env in MARKETS.items():
            broker_symbol = os.environ.get(env, canonical)
            try:
                results[canonical] = capture(mt5, canonical, broker_symbol, now, server)
            except RuntimeError as exc:
                results[canonical] = {"status": "BLOCKED", "reason": str(exc),
                                      "symbol": canonical, "executionEnabled": False}
        dest = Path(output_dir).resolve()
        dest.mkdir(parents=True, exist_ok=True)
        # One safe local output. No account login, password, tokens or order commands.
        target = dest / "nabd-demo-research-snapshot.json"
        temp = dest / "nabd-demo-research-snapshot.tmp"
        temp.write_text(json.dumps({"source": "ISOLATED_MT5_DEMO_SENSOR",
                                     "capturedAt": now, "ordersSupported": False,
                                     "symbols": results}, separators=(",", ":")), encoding="utf-8")
        os.replace(temp, target)
        print("NABD DEMO research sensor saved:", str(target))
        for symbol, value in results.items():
            print(symbol, value.get("status", "READ_ONLY_OBSERVED"))
    finally:
        mt5.shutdown()

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("NABD_SENSOR_FAIL_CLOSED:", type(exc).__name__,
              str(exc) if isinstance(exc, RuntimeError) else "INTERNAL_FAILURE", file=sys.stderr)
        sys.exit(1)
