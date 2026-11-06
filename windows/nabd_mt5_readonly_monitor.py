"""NABD Windows MT5 Demo monitor: account identity + connection only.

Read-only: does NOT fetch signals, call mt5.order_send, trade, collect passwords,
balances, positions, or install a trading EA. A separate Windows worker must be
configured for each broker account. Never commit or log NABD_MONITOR_TOKEN.
Requires: Windows, pip install MetaTrader5, isolated locally logged-in Demo MT5.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

from nabd_mt5_instance_guard import (InstanceLease, IsolationError,
    expected_identity, terminal_profile_matches)

try:
    import MetaTrader5 as mt5
except ImportError:
    sys.exit("Install the MetaTrader5 Python package on the Windows host.")

BASE = "https://gold-pulse-ai.onrender.com"
ENDPOINT = BASE + "/api/worker/mt5-heartbeat"


def env(name, pattern=None):
    value = os.environ.get(name, "").strip()
    if not value:
        sys.exit("Missing Windows environment setting: " + name)
    if pattern and not re.fullmatch(pattern, value):
        sys.exit("Invalid Windows environment setting: " + name)
    return value


ACCOUNT_ID = env("NABD_MONITOR_ACCOUNT_ID", r"[a-f0-9-]{36}")
WORKER_ID = env("NABD_MONITOR_WORKER_ID", r"[a-f0-9-]{36}")
TOKEN = env("NABD_MONITOR_TOKEN", r"[A-Za-z0-9_-]{43}")
ACCOUNT_LOGIN = env("NABD_MONITOR_MT5_LOGIN", r"[1-9][0-9]{3,15}")
ACCOUNT_SERVER = env("NABD_MONITOR_MT5_SERVER", r"JustMarkets-Demo[0-9]{0,5}")
TERMINAL_PATH = env("NABD_MONITOR_TERMINAL_PATH")
if not os.path.isfile(TERMINAL_PATH) or not TERMINAL_PATH.lower().endswith("terminal64.exe"):
    sys.exit("Expected a dedicated Windows MetaTrader 5 terminal64.exe path.")

# Fail closed before MT5 initialization if another member already owns this
# portable directory, or a duplicate worker is already running against it.
try:
    identity = expected_identity(
        ACCOUNT_ID, "JustMarkets", ACCOUNT_SERVER, ACCOUNT_LOGIN, "demo", TERMINAL_PATH
    )
    lease = InstanceLease(TERMINAL_PATH, identity)
except IsolationError as exc:
    sys.exit("NABD isolated MT5 worker refused to start: " + str(exc))

# Always use the explicit isolated installation. No Python login/password
# arguments; the operator logs into this Demo account locally on Windows.
if not mt5.initialize(path=TERMINAL_PATH, portable=True, timeout=15000):
    lease.release()
    sys.exit("Dedicated MT5 terminal failed to initialize; check Windows session.")


def actual_demo_is_connected():
    account = mt5.account_info()
    terminal = mt5.terminal_info()
    return bool(
        account is not None
        and terminal is not None
        and terminal.connected
        and terminal_profile_matches(terminal, TERMINAL_PATH)
        and str(account.login) == ACCOUNT_LOGIN
        and account.server == ACCOUNT_SERVER
        and account.trade_mode == mt5.ACCOUNT_TRADE_MODE_DEMO
    )


def report():
    packet = {
        "account_id": ACCOUNT_ID,
        "worker_id": WORKER_ID,
        "broker": "JustMarkets",
        "server": ACCOUNT_SERVER,
        "login": ACCOUNT_LOGIN,
        "environment": "demo",
        "terminal_connected": actual_demo_is_connected(),
        "demo_mode": True,
    }
    body = json.dumps(packet, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        ENDPOINT, data=body, method="POST",
        headers={
            "Content-Type": "application/json",
            "X-NABD-Worker-Token": TOKEN,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            result = json.loads(response.read(2048))
            if not result.get("monitoringOnly") or result.get("tradeAllowed") is not False:
                raise RuntimeError("Unsafe unexpected server response")
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403, 409):
            # Revoked token, unapproved account or incorrect MT5 identity:
            # stop instead of endlessly reporting a false ONLINE state.
            raise RuntimeError(
                "Windows monitoring authorization or account identity rejected"
            ) from None
        print("NABD monitoring endpoint temporarily unavailable.",
              type(exc).__name__, flush=True)
    except (urllib.error.URLError, TimeoutError) as exc:
        # Never print request, headers, token or trading credentials.
        print("NABD monitoring transport unavailable.",
              type(exc).__name__, flush=True)


try:
    print("NABD read-only Demo monitoring started. Trade execution is disabled.", flush=True)
    while True:
        report()
        time.sleep(15)
except KeyboardInterrupt:
    pass
finally:
    mt5.shutdown()
    lease.release()
