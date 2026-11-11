import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location("test_demo_upload",Path(__file__).parent/"mt5-demo-upload.py")
u=importlib.util.module_from_spec(spec)
spec.loader.exec_module(u)
SECRET="unit-test-demo-only-32-byte-secret-123456"

class Response:
    def __enter__(self): return self
    def __exit__(self,*args): pass
    def read(self,n): return b'{"status":"OBSERVED","tradeAllowed":false,"symbols":["XAUUSD"]}'

class UploadSafetyTests(unittest.TestCase):
    def test_hmac_signature_is_present_and_fixed_server_url(self):
        raw=b'{"source":"ISOLATED_MT5_DEMO_SENSOR"}'
        h=u.make_signed_request(raw,SECRET,1800000000)
        self.assertEqual(len(h["X-NABD-Sensor-Signature"]),64)
        self.assertEqual(u.ALLOWED_URL,
                         "https://nabd-agentic-ai-test.onrender.com/demo-sensor/observe")
    def test_no_real_network_is_used_in_unit_test(self):
        now=1800000000
        body={"source":"ISOLATED_MT5_DEMO_SENSOR","ordersSupported":False,"capturedAt":now}
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/"snapshot.json"
            path.write_text(json.dumps(body),encoding="utf8")
            called=[]
            def fake_open(req,timeout):
                called.append((req.full_url,timeout,req.get_method()))
                return Response()
            result=u.upload_file(path,SECRET,now=now,opener=fake_open)
            self.assertEqual(result["status"],"SENSOR_OBSERVATION_ACKNOWLEDGED")
            self.assertEqual(called,[(u.ALLOWED_URL,8,"POST")])
    def test_outdated_file_and_weak_secret_are_rejected(self):
        now=1800000000
        body={"source":"ISOLATED_MT5_DEMO_SENSOR","ordersSupported":False,
              "capturedAt":now-100}
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/"snapshot.json"
            path.write_text(json.dumps(body),encoding="utf8")
            with self.assertRaisesRegex(ValueError,"SENSOR_FILE_TOO_OLD"):
                u.upload_file(path,SECRET,now=now)
        with self.assertRaisesRegex(ValueError,"ISOLATED_HMAC_SECRET_MISSING"):
            u.make_signed_request(b"{}",'weak',now)

if __name__=="__main__": unittest.main()
