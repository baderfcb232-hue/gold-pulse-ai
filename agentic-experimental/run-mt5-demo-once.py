"""One-shot isolated NABD Demo sensor runner. Dedicated Windows DEMO terminal only.
Runs MT5 observation and immediately attempts authenticated HTTPS upload.
Will never log credentials, start a LIVE account, or send trading orders.
"""
import os
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parent
SENSOR=ROOT/"mt5-demo-readonly-sensor.py"
UPLOAD=ROOT/"mt5-demo-upload.py"

def prepare(env,python_exe=sys.executable):
    needed=("NABD_TEST_MT5_TERMINAL_PATH","NABD_TEST_SENSOR_OUTPUT_DIR",
            "NABD_TEST_DEMO_SENSOR_HMAC_SECRET")
    missing=[key for key in needed if not env.get(key)]
    if missing:
        raise RuntimeError("MISSING_EXPERIMENTAL_SETTINGS:"+",".join(missing))
    if len(env["NABD_TEST_DEMO_SENSOR_HMAC_SECRET"].encode("utf8"))<32:
        raise RuntimeError("HMAC_SECRET_TOO_SHORT")
    exe=Path(env["NABD_TEST_MT5_TERMINAL_PATH"])
    if not exe.is_file() or exe.suffix.lower()!=".exe":
        raise RuntimeError("DEMO_TERMINAL_EXECUTABLE_MISSING")
    return [(python_exe,str(SENSOR)),(python_exe,str(UPLOAD))]

def run_once(env=None,runner=subprocess.run):
    settings=dict(os.environ if env is None else env)
    commands=prepare(settings)
    for args in commands:
        result=runner(list(args),env=settings,check=False)
        if result.returncode!=0:
            raise RuntimeError("ISOLATED_RESEARCH_STEP_FAILED:"+
                               ("SENSOR" if str(SENSOR) in args else "UPLOAD"))
    return "DEMO_SENSOR_OBSERVATION_ACKNOWLEDGED"

if __name__=="__main__":
    try:
        print(run_once())
    except Exception as e:
        print("NABD_ISOLATED_RESEARCH_BLOCKED:",str(e),file=sys.stderr)
        sys.exit(1)
