import importlib.util
from pathlib import Path
import tempfile
import types
import unittest
spec=importlib.util.spec_from_file_location("demo_once",Path(__file__).parent/"run-mt5-demo-once.py")
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class IsolatedRunnerTests(unittest.TestCase):
 def test_requires_independent_demo_configuration(self):
  with self.assertRaisesRegex(RuntimeError,"MISSING_EXPERIMENTAL_SETTINGS"):
   module.prepare({})
 def test_requires_32_byte_secret(self):
  with tempfile.TemporaryDirectory() as tmp:
   exe=Path(tmp)/"terminal64.exe";exe.touch()
   env={"NABD_TEST_MT5_TERMINAL_PATH":str(exe),"NABD_TEST_SENSOR_OUTPUT_DIR":tmp,
        "NABD_TEST_DEMO_SENSOR_HMAC_SECRET":"short"}
   with self.assertRaisesRegex(RuntimeError,"HMAC_SECRET_TOO_SHORT"):
    module.prepare(env)
 def test_sensor_must_pass_before_upload(self):
  with tempfile.TemporaryDirectory() as tmp:
   exe=Path(tmp)/"terminal64.exe";exe.touch()
   env={"NABD_TEST_MT5_TERMINAL_PATH":str(exe),"NABD_TEST_SENSOR_OUTPUT_DIR":tmp,
        "NABD_TEST_DEMO_SENSOR_HMAC_SECRET":"a"*36}
   calls=[]
   def runner(args,**kwargs):
    calls.append(args[-1]);return types.SimpleNamespace(returncode=1)
   with self.assertRaisesRegex(RuntimeError,"ISOLATED_RESEARCH_STEP_FAILED:SENSOR"):
    module.run_once(env,runner)
   self.assertEqual(len(calls),1)
 def test_runs_sensor_then_uploader_no_order_calls(self):
  with tempfile.TemporaryDirectory() as tmp:
   exe=Path(tmp)/"terminal64.exe";exe.touch()
   env={"NABD_TEST_MT5_TERMINAL_PATH":str(exe),"NABD_TEST_SENSOR_OUTPUT_DIR":tmp,
        "NABD_TEST_DEMO_SENSOR_HMAC_SECRET":"a"*36}
   calls=[]
   def runner(args,**kwargs):
    calls.append(args[-1]);return types.SimpleNamespace(returncode=0)
   self.assertEqual(module.run_once(env,runner),"DEMO_SENSOR_OBSERVATION_ACKNOWLEDGED")
   self.assertEqual([Path(x).name for x in calls],
                    ["mt5-demo-readonly-sensor.py","mt5-demo-upload.py"])
if __name__=="__main__":unittest.main()
