import unittest
from types import SimpleNamespace
from datetime import datetime,timezone
from pathlib import Path
import tempfile
import json

from nabd_phase15_mt5_history_export import closed_rates,strict_utc_date,run,TIMEFRAMES


class FakeMT5:
    ACCOUNT_TRADE_MODE_DEMO=0
    TIMEFRAME_M5="M5"
    TIMEFRAME_M15="M15"
    TIMEFRAME_H1="H1"
    TIMEFRAME_H4="H4"

    def __init__(self,mode=0):
        self.mode=mode
        self.was_shutdown=False
        self.was_initialized=False

    def initialize(self,**kwargs):
        self.was_initialized=True
        return True

    def shutdown(self):
        self.was_shutdown=True

    def account_info(self):
        return SimpleNamespace(trade_mode=self.mode,company="JustMarkets",server="JustMarkets-Demo2",currency="USD")

    def symbol_info(self,symbol):
        return SimpleNamespace(point=.01,trade_tick_size=.01,trade_tick_value_loss=.1,
            trade_tick_value_profit=.1,volume_min=.01,volume_max=100.,volume_step=.01,digits=2)

    def symbol_select(self,symbol,visible):
        return True

    def copy_rates_range(self,symbol,tf,start,end):
        step=TIMEFRAMES[tf]
        limit=int(end.timestamp())
        last=(limit//step)*step-step
        count=2000 if tf=="M5" else 330
        return [dict(time=last-(count-i-1)*step,open=2000.,
            close=2000.1,high=2000.2,low=1999.9,tick_volume=12)
                for i in range(count)]


def params(path):
    return SimpleNamespace(market="XAUUSD",symbol="XAUUSD.m",
        from_date=datetime(2024,12,28,tzinfo=timezone.utc),
        to_date=datetime(2025,1,1,tzinfo=timezone.utc),
        spread_points=12.,commission_per_lot=6.,slippage_points=2.,
        margin_per_lot=450.,terminal_path=None,output=Path(path))


class TestHistoryExport(unittest.TestCase):
    def test_closed_rates_reject_future_or_intrabar_candles(self):
        row=lambda t:dict(time=t,open=10.,close=11.,high=12.,low=9.,tick_volume=2)
        self.assertEqual(len(closed_rates([row(1000),row(1300)],300,1599)),1)
        self.assertEqual(len(closed_rates([row(1000),row(1300)],300,1700,1500)),1)
        with self.assertRaises(ValueError):
            closed_rates([row(1300),row(1000)],300,2000)
        corrupted=row(1000);corrupted["high"]=10.
        with self.assertRaises(ValueError):
            closed_rates([corrupted],300,2000)

    def test_export_only_demo_with_declared_costs_no_secrets(self):
        with tempfile.TemporaryDirectory() as temp:
            target=Path(temp)/"mt5_history.json"
            mt5=FakeMT5()
            when=int(datetime(2025,1,2,tzinfo=timezone.utc).timestamp())
            result=run(params(target),mt5,now=when)
            self.assertTrue(mt5.was_shutdown)
            self.assertTrue(result["readOnly"])
            self.assertFalse(result["brokerAttested"])
            data=json.loads(target.read_text("utf-8"))
            self.assertEqual(data["symbol"],"XAUUSD")
            self.assertEqual(data["provenance"]["server"],"JustMarkets-Demo2")
            self.assertEqual(data["spec"]["margin_per_lot"],450.)
            self.assertEqual(data["commission_per_lot"],6.)
            self.assertEqual(set(data["candles"].keys()),{"M5","M15","H1","H4"})
            self.assertTrue(all(len(bars)>=320 for bars in data["candles"].values()))
            self.assertTrue(all(b["time"]<when for b in data["candles"]["M5"]))
            self.assertNotIn("password",target.read_text("utf-8").lower())
            with self.assertRaises(FileExistsError):
                run(params(target),FakeMT5(),now=when)

    def test_rejects_live_account_even_if_symbol_matches(self):
        with tempfile.TemporaryDirectory() as temp:
            mt5=FakeMT5(mode=1)
            when=int(datetime(2025,1,2,tzinfo=timezone.utc).timestamp())
            with self.assertRaisesRegex(ValueError,"Demo"):
                run(params(Path(temp)/"file.json"),mt5,now=when)
            self.assertTrue(mt5.was_shutdown)

    def test_real_date_parsing(self):
        self.assertEqual(strict_utc_date("2024-02-29").day,29)
        with self.assertRaises(Exception):
            strict_utc_date("2025-02-29")


if __name__=="__main__":
    unittest.main()
