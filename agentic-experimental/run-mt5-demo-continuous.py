"""Continuous, read-only DEMO sensor supervisor for a dedicated Windows MT5 terminal.

Restarts finite sensor+HTTPS-upload cycles after transient failures. It never opens
positions, uses production endpoints, logs secrets, or relaxes server validation.
Install with an interactive Windows user session whose DEMO terminal is running.
"""
import importlib.util
from pathlib import Path
import re
import sys
import time

HERE = Path(__file__).resolve().parent
ONCE = HERE / "run-mt5-demo-once.py"
SAFE_REASON = re.compile(r"^[A-Z0-9_:,]{1,150}$")


def load_once():
    spec = importlib.util.spec_from_file_location("nabd_demo_once", ONCE)
    if spec is None or spec.loader is None:
        raise RuntimeError("ISOLATED_RUNNER_NOT_FOUND")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.run_once


def supervise(run_once, sleep=time.sleep, emit=print, max_cycles=None,
              success_interval=5, retry_interval=15):
    """One independent sensor/upload per cycle; failed cycles never use old data."""
    if success_interval < 3 or retry_interval < 5:
        raise ValueError("SENSOR_CADENCE_TOO_FAST")
    completed = 0
    while max_cycles is None or completed < max_cycles:
        try:
            run_once()
            emit("NABD_DEMO_SENSOR_CYCLE_OK")
            delay = success_interval
        except Exception as exc:
            reason = str(exc)
            if not SAFE_REASON.fullmatch(reason):
                reason = "ISOLATED_CYCLE_ERROR"
            emit("NABD_DEMO_SENSOR_CYCLE_FAILED:" + reason)
            delay = retry_interval
        completed += 1
        if max_cycles is None or completed < max_cycles:
            sleep(delay)
    return completed


def main():
    if sys.platform != "win32":
        raise RuntimeError("WINDOWS_DEMO_TERMINAL_ONLY")
    print("NABD_DEMO_SENSOR_SUPERVISOR_STARTED", flush=True)
    supervise(load_once(), emit=lambda msg: print(msg, flush=True))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("NABD_DEMO_SENSOR_SUPERVISOR_STOPPED")
    except Exception:
        print("NABD_DEMO_SENSOR_SUPERVISOR_FATAL", file=sys.stderr)
        sys.exit(1)
