"""Regression checks for Phase15 read-only MT5 market-history preflight."""
import argparse
from datetime import datetime, timezone
import importlib.util
from pathlib import Path
import unittest

MODULE = Path(__file__).resolve().parents[1] / "windows" / "nabd_phase15_preflight.py"
spec = importlib.util.spec_from_file_location("nabd_phase15_preflight", MODULE)
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)

NOW = int(datetime(2026, 11, 18, 12, tzinfo=timezone.utc).timestamp())


class FakeMT5:
    ACCOUNT_TRADE_MODE_DEMO = 0
    TIMEFRAME_M5 = 5
    TIMEFRAME_M15 = 15
    TIMEFRAME_H1 = 60
    TIMEFRAME_H4 = 240

    def __init__(self, mutation=None):
        self.mutation = mutation
        self.shutdown_count = 0

    def initialize(self, **kwargs):
        return True

    def shutdown(self):
        self.shutdown_count += 1

    def account_info(self):
        return argparse.Namespace(trade_mode=0, company="JustMarkets", server="Demo")

    def symbol_info(self, symbol):
        return argparse.Namespace(point=0.01, trade_tick_size=0.01,
                                  trade_tick_value_loss=1)

    def symbol_select(self, symbol, selected):
        return True

    def copy_rates_range(self, symbol, timeframe, beginning, end):
        step = timeframe * 60
        start = NOW - 730 * 86400
        # 550 closed warmup bars, all within the requested 130-day warmup.
        warmup = [start - (550 - i) * step for i in range(550)]
        # Sparse but complete two-year span (less than the 7-day missing-data threshold).
        span = [start + i * 3 * 86400 for i in range(244)]
        stamps = [x - (x % step) for x in warmup + span]
        rows = [dict(time=t, open=100.0, high=101.0, low=99.0, close=100.5)
                for t in stamps]
        if self.mutation == "bad_ohlc" and timeframe == self.TIMEFRAME_M5:
            rows[-1]["high"] = 90.0
        if self.mutation == "misaligned" and timeframe == self.TIMEFRAME_M15:
            rows[0]["time"] += 1
        return rows


def args():
    return argparse.Namespace(market="XAUUSD", symbol="XAUUSD.m",
                              history_days=730, warmup_days=130,
                              terminal_path=None)


class HistoryValidationTests(unittest.TestCase):
    def test_valid_histories_readiness(self):
        fake = FakeMT5()
        result = preflight.diagnose(args(), fake, now=NOW)
        self.assertTrue(result["readyForHistoricalExport"], result["issues"])
        self.assertEqual(fake.shutdown_count, 1)

    def test_corrupt_ohlc_fails_closed(self):
        fake = FakeMT5("bad_ohlc")
        result = preflight.diagnose(args(), fake, now=NOW)
        self.assertFalse(result["readyForHistoricalExport"])
        self.assertIn("M5_INVALID_OHLC", result["issues"])
        self.assertEqual(fake.shutdown_count, 1)

    def test_misaligned_bar_fails_closed(self):
        fake = FakeMT5("misaligned")
        result = preflight.diagnose(args(), fake, now=NOW)
        self.assertFalse(result["readyForHistoricalExport"])
        self.assertIn("M15_HISTORY_GAPS_OR_ORDER", result["issues"])


if __name__ == "__main__":
    unittest.main()
