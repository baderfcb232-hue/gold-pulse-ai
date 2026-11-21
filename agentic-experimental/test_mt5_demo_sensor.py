import importlib.util
import pathlib
import types
import unittest

spec = importlib.util.spec_from_file_location(
    "isolated_mt5_sensor",
    pathlib.Path(__file__).parent / "mt5-demo-readonly-sensor.py")
sensor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sensor)

class MockMetaTrader5:
    ACCOUNT_TRADE_MODE_DEMO = 0
    ACCOUNT_TRADE_MODE_REAL = 2
    TIMEFRAME_M5 = 5
    TIMEFRAME_M15 = 15
    TIMEFRAME_H1 = 60
    TIMEFRAME_H4 = 240
    def __init__(self, mode=0, server="Isolated-Broker-Demo", login=1234567):
        self.mode = mode
        self.server = server
        self.login = login
        self.orders_called = False
    def account_info(self):
        return types.SimpleNamespace(trade_mode=self.mode, server=self.server, login=self.login)
    def symbol_select(self, symbol, enabled):
        return enabled and symbol in ("XAUUSD", "BTCUSD")
    def symbol_info_tick(self, symbol):
        return types.SimpleNamespace(bid=100.0, ask=100.2, time=1799999999)
    def symbol_info(self, symbol):
        return types.SimpleNamespace(trade_tick_size=0.01,
           trade_tick_value=1.0, trade_contract_size=1)
    def copy_rates_from_pos(self, symbol, timeframe, start, count):
        duration={5:300,15:900,60:3600,240:14400}[timeframe]
        return [dict(time=1800000000-duration*i,open=100.0,high=101.0,
            low=99.0,close=100.4) for i in (3,2,1)]
    def order_send(self,*args,**kwargs):
        self.orders_called=True
        raise AssertionError("orders are forbidden")

class SensorSafetyTests(unittest.TestCase):
    def test_demo_only(self):
        self.assertIn("Demo",sensor.require_demo(MockMetaTrader5()))
        with self.assertRaisesRegex(RuntimeError,"LIVE_OR_CONTEST_ACCOUNT_REJECTED"):
            sensor.require_demo(MockMetaTrader5(mode=2,server="Live"))
        with self.assertRaisesRegex(RuntimeError,"BROKER_DEMO_SERVER_NOT_VERIFIED"):
            sensor.require_demo(MockMetaTrader5(server="Live"))
    def test_readonly_all_timeframes(self):
        broker=MockMetaTrader5()
        result=sensor.capture(broker,"XAUUSD","XAUUSD",1800000000,"Isolated-Broker-Demo")
        self.assertEqual(result["accountType"],"DEMO")
        self.assertEqual(result["accountLogin"],1234567)
        self.assertFalse(result["executionEnabled"])
        self.assertEqual(len(result["candlesM5"]),3)
        self.assertEqual(len(result["candlesH4"]),3)
        self.assertEqual(result["tickSize"],0.01)
        self.assertFalse(broker.orders_called)
    def test_identity_mismatch_and_missing_login_fail_closed(self):
        with self.assertRaisesRegex(RuntimeError,"DEMO_ACCOUNT_IDENTITY_UNVERIFIED"):
            sensor.capture(MockMetaTrader5(login=0),"XAUUSD","XAUUSD",1800000000,"Isolated-Broker-Demo")
        with self.assertRaisesRegex(RuntimeError,"DEMO_ACCOUNT_IDENTITY_UNVERIFIED"):
            sensor.capture(MockMetaTrader5(mode=2),"XAUUSD","XAUUSD",1800000000,"Isolated-Broker-Demo")
        with self.assertRaisesRegex(RuntimeError,"DEMO_ACCOUNT_IDENTITY_UNVERIFIED"):
            sensor.capture(MockMetaTrader5(),"XAUUSD","XAUUSD",1800000000,"Wrong-Demo")
    def test_stale_quotes_are_rejected(self):
        broker=MockMetaTrader5()
        with self.assertRaisesRegex(RuntimeError,"STALE_OR_INVALID_QUOTE"):
            sensor.capture(broker,"XAUUSD","XAUUSD",1800000100,"Isolated-Broker-Demo")
    def test_readonly_broker_history_requires_completed_order_guards(self):
        now=1800000000
        broker=MockMetaTrader5()
        broker.DEAL_ENTRY_IN=0
        broker.DEAL_TYPE_BUY=0
        broker.DEAL_TYPE_SELL=1
        def history_deals_get(start,end):
            return [types.SimpleNamespace(time=now-1,ticket=999001,order=888011,
                volume=0.02,entry=0,type=0,symbol="XAUUSD")]
        def history_orders_get(ticket=None):
            return [types.SimpleNamespace(ticket=ticket,symbol="XAUUSD",
                sl=97.2,tp=106.2)]
        broker.history_deals_get=history_deals_get
        broker.history_orders_get=history_orders_get
        evidence=sensor.recent_broker_history(broker,now,1234567,{"XAUUSD":"XAUUSD"})
        self.assertEqual(len(evidence["XAUUSD"]),1)
        self.assertEqual(evidence["XAUUSD"][0]["dealTicket"],999001)
        self.assertEqual(evidence["XAUUSD"][0]["stop"],97.2)
        self.assertEqual(evidence["XAUUSD"][0]["target"],106.2)
        self.assertFalse(broker.orders_called)
        broker.history_orders_get=lambda ticket=None: [
            types.SimpleNamespace(ticket=ticket,symbol="XAUUSD",sl=0,tp=0)]
        self.assertEqual(sensor.recent_broker_history(
            broker,now,1234567,{"XAUUSD":"XAUUSD"})["XAUUSD"],[])

    def test_unavailable_or_wrong_history_never_fabricates_deal(self):
        broker=MockMetaTrader5()
        self.assertEqual(sensor.recent_broker_history(
            broker,1800000000,1234567,{"XAUUSD":"XAUUSD"}),{})
        broker.history_deals_get=lambda *args: None
        broker.history_orders_get=lambda **kwargs: None
        self.assertEqual(sensor.recent_broker_history(
            broker,1800000000,1234567,{"XAUUSD":"XAUUSD"}),{})
    def test_no_order_calls_exist_in_public_surface(self):
        self.assertFalse(hasattr(sensor,"order_send"))
        self.assertEqual(sensor.TIMEFRAMES,("M5","M15","H1","H4"))

if __name__=="__main__":
    unittest.main()
