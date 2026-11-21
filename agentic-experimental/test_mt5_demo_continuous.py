"""Read-only supervisor safety and outage recovery tests."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "demo_continuous", Path(__file__).parent / "run-mt5-demo-continuous.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ContinuousSupervisorTests(unittest.TestCase):
    def test_restarts_after_a_failed_cycle_without_replaying_old_snapshot(self):
        calls, sleeps, messages = [], [], []
        def once():
            calls.append("capture_and_upload")
            if len(calls) == 1:
                raise RuntimeError("ISOLATED_RESEARCH_STEP_FAILED:SENSOR")
        count = module.supervise(
            once, sleep=sleeps.append, emit=messages.append, max_cycles=3)
        self.assertEqual(count, 3)
        self.assertEqual(calls, ["capture_and_upload"] * 3)
        self.assertEqual(sleeps, [15, 5])
        self.assertTrue(messages[0].startswith("NABD_DEMO_SENSOR_CYCLE_FAILED:"))
        self.assertEqual(messages[-1], "NABD_DEMO_SENSOR_CYCLE_OK")

    def test_errors_do_not_disclose_secret_or_exception_text(self):
        messages = []
        module.supervise(
            lambda: (_ for _ in ()).throw(ValueError("secret value=abcdef")),
            sleep=lambda _: None, emit=messages.append, max_cycles=1)
        self.assertEqual(messages, ["NABD_DEMO_SENSOR_CYCLE_FAILED:ISOLATED_CYCLE_ERROR"])

    def test_unsafe_fast_loop_rejected(self):
        with self.assertRaisesRegex(ValueError, "SENSOR_CADENCE_TOO_FAST"):
            module.supervise(lambda: None, max_cycles=1, success_interval=1)


if __name__ == "__main__":
    unittest.main()
