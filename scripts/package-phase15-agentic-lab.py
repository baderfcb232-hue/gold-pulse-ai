#!/usr/bin/env python3
"""Build a minimal, offline-only ZIP from vetted Phase15 source files.
No broker credentials, .env, git metadata, node_modules, or production routes.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import shutil

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT / "qa-artifacts" / "phase15-agentic-bundle"
NAME="NABD_Phase15_Agentic_Lab_LOCAL.zip"
SOURCES=[
    "windows/NABD_Phase15_Agentic_Lab.ps1",
    "windows/nabd_phase15_mt5_history_export.py",
    "agentic-experimental/research-brain.mjs",
    "agentic-experimental/historical-replay-context.mjs",
    "agentic-experimental/market-features.mjs",
    "agentic-experimental/agentic-historical-lab.mjs",
    "agentic-experimental/agentic-historical-cli.mjs",
    "agentic-experimental/PHASE15_AGENTIC_HISTORICAL_REPLAY_AR.md",
    "public/strategy-lab.html",
    "public/strategy-lab-ui.js",
    "public/strategy-lab.css"
]
README="""NABD Phase15 — LAB FOR JUSTMARKETS DEMO ONLY
=============================================
This is an isolated, READ-ONLY two-year historical PAPER diagnostic of the
experimental NABD research brain. No MT5 orders, no main/Live/production access.
This is NOT an unbiased proof of model skill or trading profitability.

1. Unzip the archive in your own Windows folder.
2. Install Node.js 24 and Python 3.11+; in PowerShell run:
   python -m pip install MetaTrader5
3. Open the desktop MT5 terminal signed in to your JustMarkets DEMO account.
   In Market Watch enable the exact XAUUSD.m / BTCUSD.m broker symbol.
   Open M5, M15, H1, H4, download at least two years of broker history.
4. From the unzipped folder, run this PowerShell command after REPLACING each
   numeric value with VERIFIED assumptions for your demo broker/account:

   powershell -NoProfile -File .\\windows\\NABD_Phase15_Agentic_Lab.ps1 -Market XAUUSD -Symbol XAUUSD.m -SpreadPoints 15 -SlippagePoints 3 -CommissionPerLot 7 -MarginPerLot 500

   EXAMPLE COSTS ABOVE ARE NOT VERIFIED! Do not use them without checking.
   The --to UTC date defaults to today UTC (EXCLUSIVE), from is two years prior.
   The script stores JSON in phase15-local-reports/ and DOES NOT call paid AI.

5. To inspect the report in a browser, from this folder run:
   python -m http.server 8765 --bind 127.0.0.1 --directory viewer
   Then open http://127.0.0.1:8765/ in your browser and pick the *agentic.json
   file from phase15-local-reports. File is read in the browser, NOT uploaded.
   You may stop the local server with Ctrl+C.

6. Optional: repeat for BTCUSD with its ACTUAL broker symbol and fees.
7. OPTIONAL BILLABLE model inference: only after approving API usage costs,
   set an isolated NABD_TEST_REPLAY_AI_KEY environment variable in PowerShell
   (do NOT paste or upload it), choose a NEW output/report name by rerunning,
   and append -RunAIWithCost. Default max 12 requests, maximum 60.
   Real OpenAI API billing may apply; never turn this on by default.

This is a sampling-based historical research diagnostic (max 60 decisions).
The model may have learned post-period information during training, so it
cannot establish historical forecasting skill. For valid effectiveness data,
perform a prospective paper-forward test on isolated MT5 Demo.
"""
def main():
    OUT.mkdir(parents=True,exist_ok=True)
    dest=OUT/NAME
    if dest.exists():
        dest.unlink()
    with ZipFile(dest,"w",compression=ZIP_DEFLATED,compresslevel=9) as z:
        z.writestr("README_AR_EN.txt",README)
        for name in SOURCES:
            src=ROOT/name
            if not src.is_file():
                raise RuntimeError(f"Missing required package source: {name}")
            if src.stat().st_size>500_000:
                raise RuntimeError(f"Unexpectedly large source in restricted package: {name}")
            data=src.read_bytes()
            if name=="public/strategy-lab.html":
                html=data.decode("utf-8")
                html=html.replace('href="/strategy-lab.css?v=phase15"',
                                  'href="./strategy-lab.css"')
                html=html.replace('src="/strategy-lab-ui.js?v=phase15"',
                                  'src="./strategy-lab-ui.js"')
                html=html.replace('href="/dashboard"',
                                  'href="./index.html"')
                html=html.replace("العودة للسوق", "مختبر محلي فقط")
                z.writestr("viewer/index.html",html)
            elif name.startswith("public/"):
                z.writestr("viewer/"+Path(name).name,data)
            else:
                z.writestr(name,data)
        if set(z.namelist()) != {
            "README_AR_EN.txt",
            "viewer/index.html",
            "viewer/strategy-lab-ui.js",
            "viewer/strategy-lab.css",
            *[s for s in SOURCES if not s.startswith("public/")]
        }:
            raise RuntimeError("Unexpected contents in restricted package")
    with ZipFile(dest) as z:
        bad=z.testzip()
        if bad:
            raise RuntimeError("Invalid ZIP member: "+bad)
        assert not any(
            path.startswith((".git","node_modules")) or
            path.endswith((".env",".set",".ex5",".mq5")) for path in z.namelist()
        )
    print(f"Built {dest} ({dest.stat().st_size} bytes), no secrets or order EAs")
if __name__=="__main__":
    main()
