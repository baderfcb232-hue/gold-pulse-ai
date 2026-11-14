import unittest
from types import SimpleNamespace
from datetime import datetime, timezone

from nabd_phase15_preflight import diagnose


class FakeMT5:
    ACCOUNT_TRADE_MODE_DEMO = 0
    TIMEFRAME_M5 = "M5"
    TIMEFRAME_M15 = "M15"
    TIMEFRAME_H1 = "H1"
    TIMEFRAME_H4 = "H4"

    def __init__(self, live=False, missing=None, broker="JustMarkets"):
        self.live, self.missing, self.broker = live, missing, broker
        self.shutdown_called = False
        self.initialize_called = False
        self.orders_sent = 0

    def initialize(self, **kwargs):
        self.initialize_called = True
        return True

    def shutdown(self):
        self.shutdown_called = True

    def account_info(self):
        return SimpleNamespace(trade_mode=1 if self.live else 0,
                               company=self.broker, server="JustMarkets-Demo",
                               login=123456789, balance=9876)

    def symbol_info(self, symbol):
        return SimpleNamespace(point=.01, trade_tick_size=.01,
                               trade_tick_value_loss=.1)

    def symbol_select(self, symbol, visible):
        return True

    def copy_rates_range(self, symbol, tf, start, end):
        if self.missing == tf:
            return None
        step = {"M5": 300, "M15": 900, "H1": 3600, "H4": 14400}[tf]
        from_time = int(start.timestamp()) // step * step
        end_time = int(end.timestamp()) // step * step
        return [{"time": t, "open": 2400, "high": 2401, "low": 2399,
                 "close": 2400.5, "tick_volume": 10}
                for t in range(from_time, end_time, step)]

    def order_send(self, *args, **kwargs):
        self.orders_sent += 1
        raise AssertionError("Read-only preflight must not trade")


def args(**changes):
    p = dict(market="XAUUSD", symbol="XAUUSD.m", history_days=7,
             warmup_days=70, terminal_path=None)
    p.update(changes)
    return SimpleNamespace(**p)


NOW = int(datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc).timestamp())


class PreflightTests(unittest.TestCase):
    def test_ready_history_returns_each_timeframe_without_private_account_data(self):
        mt5 = FakeMT5()
        result = diagnose(args(), mt5, now=NOW)
        self.assertTrue(result["readyForHistoricalExport"], result["issues"])
        self.assertEqual(set(result["frames"]), {"M5", "M15", "H1", "H4"})
        self.assertTrue(all(f["status"] == "READY" for f in result["frames"].values()))
        self.assertEqual(result["accountType"], "DEMO")
        self.assertNotIn("123456789", str(result))
        self.assertNotIn("9876", str(result))
        self.assertTrue(mt5.shutdown_called)
        self.assertEqual(mt5.orders_sent, 0)

    def test_live_account_is_rejected_before_history_query(self):
        mt5 = FakeMT5(live=True)
        result = diagnose(args(), mt5, now=NOW)
        self.assertFalse(result["readyForHistoricalExport"])
        self.assertIn("DEMO_ACCOUNT_REQUIRED", result["issues"])
        self.assertEqual(result["accountType"], "NON_DEMO")
        self.assertEqual(result["frames"], {})
        self.assertTrue(mt5.shutdown_called)

    def test_non_justmarkets_broker_refused(self):
        mt5 = FakeMT5(broker="OtherBroker")
        mt5.account_info = lambda: SimpleNamespace(
            trade_mode=0, company="OtherBroker", server="Other-Demo")
        result = diagnose(args(), mt5, now=NOW)
        self.assertIn("JUSTMARKETS_DEMO_REQUIRED", result["issues"])

    def test_missing_history_identifies_specific_timeframe(self):
        mt5 = FakeMT5(missing="M15")
        result = diagnose(args(), mt5, now=NOW)
        self.assertFalse(result["readyForHistoricalExport"])
        self.assertEqual(result["frames"]["M15"]["status"], "NO_BROKER_HISTORY")
        self.assertIn("NO_M15_HISTORY", result["issues"])
        self.assertEqual(result["frames"]["M5"]["status"], "READY")

    def test_incomplete_two_year_range_is_explicitly_reported(self):
        mt5 = FakeMT5()
        mt5.copy_rates_range = lambda symbol, tf, start, end: FakeMT5.copy_rates_range(
            mt5, symbol, tf, end.replace(year=end.year-1), end)
        result = diagnose(args(history_days=730), mt5, now=NOW)
        self.assertFalse(result["readyForHistoricalExport"])
        self.assertIn("M5_TWO_YEAR_RANGE_INCOMPLETE", result["issues"])

    def test_invalid_symbol_and_bounds_refused(self):
        for bad in [args(market="BTCUSD"), args(history_days=0),
                    args(history_days=1461), args(warmup_days=9)]:
            mt5 = FakeMT5()
            with self.assertRaises(ValueError):
                diagnose(bad, mt5, now=NOW)
            self.assertFalse(mt5.initialize_called)


if __name__ == "__main__":
    unittest.main()
