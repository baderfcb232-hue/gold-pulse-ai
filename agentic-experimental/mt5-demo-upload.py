"""Optional isolated DEMO observation uploader. Never transmits account credentials.
Requires a dedicated Windows DEMO MT5 sensor output and experiment-only secret.
Use only after separately configuring the same HMAC secret on experimental Render.
"""
import hashlib
import hmac
import json
import os
from pathlib import Path
import sys
import time
from urllib import request

ALLOWED_URL = "https://nabd-agentic-ai-test.onrender.com/demo-sensor/observe"

def make_signed_request(raw, secret, now):
    if not isinstance(raw, bytes) or len(raw) > 120000 or not raw:
        raise ValueError("INVALID_SNAPSHOT_BYTES")
    if not isinstance(secret, str) or len(secret.encode("utf8")) < 32:
        raise ValueError("ISOLATED_HMAC_SECRET_MISSING")
    stamp = str(now)
    signature = hmac.new(secret.encode("utf8"), stamp.encode("utf8")+b"\n"+raw,
                         hashlib.sha256).hexdigest()
    return {"X-NABD-Sensor-Timestamp": stamp,
            "X-NABD-Sensor-Signature": signature,
            "Content-Type": "application/json"}

def upload_file(path, secret, now=None, opener=request.urlopen):
    now = int(time.time()) if now is None else int(now)
    raw = Path(path).read_bytes()
    item = json.loads(raw)
    if item.get("source") != "ISOLATED_MT5_DEMO_SENSOR" or item.get("ordersSupported") is not False:
        raise ValueError("UNVERIFIED_RESEARCH_SENSOR_FILE")
    if abs(now-item.get("capturedAt", 0)) > 10:
        raise ValueError("SENSOR_FILE_TOO_OLD")
    headers = make_signed_request(raw, secret, now)
    req = request.Request(ALLOWED_URL, data=raw, headers=headers, method="POST")
    with opener(req, timeout=8) as response:
        text = response.read(2048).decode("utf8")
    payload = json.loads(text)
    if payload.get("status") != "OBSERVED" or payload.get("tradeAllowed") is not False:
        raise RuntimeError("INGEST_NOT_ACKNOWLEDGED")
    return {"status": "SENSOR_OBSERVATION_ACKNOWLEDGED",
            "ordersCreated": 0, "symbols": payload.get("symbols", [])}

def main():
    output_dir = os.environ.get("NABD_TEST_SENSOR_OUTPUT_DIR")
    secret = os.environ.get("NABD_TEST_DEMO_SENSOR_HMAC_SECRET")
    if not output_dir or not secret:
        raise ValueError("EXPERIMENTAL_OUTPUT_DIR_AND_SECRET_REQUIRED")
    result = upload_file(Path(output_dir)/"nabd-demo-research-snapshot.json", secret)
    print(json.dumps(result, separators=(",", ":")))

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("NABD_DEMO_UPLOAD_REJECTED:", type(exc).__name__,
              str(exc) if isinstance(exc, (ValueError, RuntimeError)) else "UPLOAD_FAILED",
              file=sys.stderr)
        sys.exit(1)
