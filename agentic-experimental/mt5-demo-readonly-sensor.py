"""Isolated NABD research sensor for a dedicated Windows MT5 DEMO terminal.

NO orders. NO broker passwords. NO HTTP connections. NO Telegram. NO production.
Install MetaTrader5 for Python in the independent Windows DEMO environment.
Set NABD_TEST_MT5_TERMINAL_PATH to a dedicated MT5 terminal.exe path.
Optional: set NABD_TEST_GOLD_SYMBOL / NABD_TEST_BTC_SYMBOL to broker names.
Writes sanitized research snapshots to NABD_TEST_SENSOR_OUTPUT_DIR locally.
"""
import json
import math
import os
import sys
import time
from pathlib import Path
from datetime import datetime, timezone

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
    bars = mt5.copy_rates_from_pos(symbol, interval, 1, 240)
    if bars is None or len(bars) < 2:
        raise RuntimeError("BROKER_CANDLES_MISSING_" + timeframe)
    result = []
    for bar in bars:
        item = {
            "time": int(bar["time"]), "open": float(bar["open"]),
            "high": float(bar["high"]), "low": float(bar["low"]),
            "close": float(bar["close"]),
        }
        # MT5 tick_volume is quote activity, not exchange traded volume.
        # Keep the two fields separate; older sensors remain compatible.
        for source, target in (("tick_volume", "tickVolume"), ("real_volume", "realVolume")):
            try:
                value = int(bar[source])
                if 0 <= value <= 9007199254740991 and value == bar[source]:
                    item[target] = value
            except (KeyError, IndexError, ValueError, TypeError, OverflowError):
                pass
        if item["time"] + unit > now or item["time"] <= 0:
            raise RuntimeError("UNFINISHED_CANDLE_" + timeframe)
        result.append(item)
    result.sort(key=lambda x: x["time"])
    prior = -1
    for item in result:
        if (item["time"] <= prior or item["time"] % unit != 0 or
                not all(math.isfinite(item[k]) and item[k] > 0 for k in
                        ("open", "high", "low", "close")) or
                item["high"] < max(item["open"], item["close"]) or
                item["low"] > min(item["open"], item["close"])):
            raise RuntimeError("INVALID_CANDLE_" + timeframe)
        prior = item["time"]
    if now - (result[-1]["time"] + unit) > unit * 2:
        raise RuntimeError("STALE_CANDLES_" + timeframe)
    return result

def optional_daily_session(mt5, symbol, now):
    """Read the current broker D1 open and 21 prior completed sessions only."""
    if not hasattr(mt5, "TIMEFRAME_D1"):
        return None
    try:
        bars = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_D1, 0, 22)
        if bars is None or len(bars) != 22:
            return None
        rows = sorted([{"time": int(b["time"]), **{k: float(b[k]) for k in ("open","high","low","close")}} for b in bars], key=lambda b:b["time"])
        last = rows[-1]
        if last["time"] > now or now-last["time"] >= 95040:
            return None
        return {"start": last["time"], "open": last["open"], "closed": rows[:-1]}
    except (ValueError, TypeError, KeyError, IndexError, OverflowError):
        return None

def capture(mt5, canonical, broker_symbol, now, server):
    account = mt5.account_info()
    if (account is None or account.trade_mode != mt5.ACCOUNT_TRADE_MODE_DEMO or
            str(account.server or '') != server or
            type(getattr(account, 'login', None)) is not int or account.login <= 0):
        raise RuntimeError('DEMO_ACCOUNT_IDENTITY_UNVERIFIED')
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
        "accountLogin": account.login,
        "timestamp": int(tick.time), "bid": bid, "ask": ask,
        "tickSize": tick_size, "tickValue": tick_value,
        "contractSize": contract,
    }
    for frame in TIMEFRAMES:
        payload["candles" + frame] = closed_bars(mt5, broker_symbol, frame, now)
    if canonical == "XAUUSD":
        daily = optional_daily_session(mt5, broker_symbol, now)
        if daily is not None:
            payload["dailySession"] = daily
    return payload

def recent_broker_history(mt5, now, account_login, broker_symbols):
    """Read a bounded set of broker-confirmed DEMO deals and opening-order guards.

    This is a distinct read-only MetaTrader5 API path, not a copy of EA ACK.
    A trade is *not* proven until the test server matches deal ticket, side,
    timeframe, account, instrument and protective SL/TP to the issued intent.
    """
    if not isinstance(account_login, int) or account_login <= 0:
        return {}
    if not hasattr(mt5, "history_deals_get") or not hasattr(mt5, "history_orders_get"):
        return {}
    begin = datetime.fromtimestamp(now - 900, tz=timezone.utc)
    end = datetime.fromtimestamp(now + 1, tz=timezone.utc)
    deals = mt5.history_deals_get(begin, end)
    if deals is None:
        return {}
    result = {canonical: [] for canonical in broker_symbols}
    for deal in sorted(deals, key=lambda d: int(getattr(d, "time", 0)),
                       reverse=True)[:80]:
        canonical = next((k for k, v in broker_symbols.items()
                          if v == getattr(deal, "symbol", None)), None)
        if canonical is None or len(result[canonical]) >= 20:
            continue
        if (getattr(deal, "entry", None) != getattr(mt5, "DEAL_ENTRY_IN", 0)
                or getattr(deal, "type", None) not in
                (getattr(mt5, "DEAL_TYPE_BUY", 0),
                 getattr(mt5, "DEAL_TYPE_SELL", 1))):
            continue
        deal_at = getattr(deal, "time", None)
        ticket = getattr(deal, "ticket", None)
        order_ticket = getattr(deal, "order", None)
        volume = getattr(deal, "volume", None)
        if (type(deal_at) is not int or deal_at < now - 900 or deal_at > now + 1
                or type(ticket) is not int or ticket <= 0
                or type(order_ticket) is not int or order_ticket <= 0
                or not isinstance(volume, (float, int)) or not math.isfinite(volume)
                or volume <= 0):
            continue
        orders = mt5.history_orders_get(ticket=order_ticket)
        if not orders or len(orders) != 1:
            continue
        order = orders[0]
        if (getattr(order, "ticket", None) != order_ticket
                or getattr(order, "symbol", None) != getattr(deal, "symbol", None)):
            continue
        sl = getattr(order, "sl", None)
        tp = getattr(order, "tp", None)
        if (not isinstance(sl, (float, int)) or not math.isfinite(sl) or sl <= 0
                or not isinstance(tp, (float, int)) or not math.isfinite(tp) or tp <= 0):
            continue
        result[canonical].append({
            "dealTicket": ticket, "orderTicket": order_ticket,
            "brokerSymbol": deal.symbol,
            "side": "BUY" if deal.type == getattr(mt5, "DEAL_TYPE_BUY", 0)
                    else "SELL",
            "entry": "IN", "dealAt": deal_at,
            "volume": float(volume), "stop": float(sl), "target": float(tp)
        })
    return result


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
        broker_symbols = {}
        for canonical, env in MARKETS.items():
            broker_symbol = os.environ.get(env, canonical)
            try:
                results[canonical] = capture(mt5, canonical, broker_symbol, now, server)
                broker_symbols[canonical] = broker_symbol
            except RuntimeError as exc:
                results[canonical] = {"status": "BLOCKED", "reason": str(exc),
                                      "symbol": canonical, "executionEnabled": False}
        dest = Path(output_dir).resolve()
        dest.mkdir(parents=True, exist_ok=True)
        # One safe local output. No account login, password, tokens or order commands.
        # Keep history evidence behind the same signed, read-only DEMO envelope.
        # No history is fabricated when the broker API is unavailable.
        account = mt5.account_info()
        history = recent_broker_history(mt5, now, int(account.login), broker_symbols)
        target = dest / "nabd-demo-research-snapshot.json"
        temp = dest / "nabd-demo-research-snapshot.tmp"
        temp.write_text(json.dumps({"source": "ISOLATED_MT5_DEMO_SENSOR",
                                     "capturedAt": now, "ordersSupported": False,
                                     "symbols": results, "history": history},
                                   separators=(",", ":")), encoding="utf-8")
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
