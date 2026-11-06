"""Phase 12 isolated Windows fleet preflight tests; run without MT5."""
import json
import tempfile
import unittest
from pathlib import Path

from nabd_mt5_fleet_preflight import FleetError, inspect_fleet, validate_fleet
from nabd_mt5_instance_guard import bind_identity

A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
WA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
WB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"


class FleetTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.a = self.root / "mt5-a"
        self.b = self.root / "mt5-b"
        for folder in (self.a, self.b):
            folder.mkdir()
            (folder / "terminal64.exe").touch()
        self.first = {
            "slot": "demo_a", "account_id": A, "worker_id": WA,
            "broker": "JustMarkets", "server": "JustMarkets-Demo2",
            "login": "12345678", "environment": "demo",
            "windows_user": "NABD-demo-a",
            "terminal_path": str(self.a / "terminal64.exe"),
        }
        self.second = {
            "slot": "demo_b", "account_id": B, "worker_id": WB,
            "broker": "JustMarkets", "server": "JustMarkets-Demo2",
            "login": "87654321", "environment": "demo",
            "windows_user": "NABD-demo-b",
            "terminal_path": str(self.b / "terminal64.exe"),
        }

    def fleet(self, *entries):
        return {"version": 1, "instances": list(entries)}

    def test_two_accounts_are_isolated_and_wait_for_first_run(self):
        result = inspect_fleet(self.fleet(self.first, self.second))
        self.assertEqual(result["count"], 2)
        self.assertFalse(result["tradeAllowed"])
        self.assertEqual([i["status"] for i in result["instances"]],
                         ["AWAITING_FIRST_MONITOR_RUN"] * 2)
        self.assertNotIn("12345678", json.dumps(result))
        self.assertNotIn("terminal64", json.dumps(result))

    def test_known_owner_binding_and_tampering(self):
        entries = validate_fleet(self.fleet(self.first, self.second))
        bind_identity(self.a, entries[0]["identity"])
        self.assertEqual(inspect_fleet(self.fleet(self.first))["instances"][0]["status"], "OWNER_BOUND")
        with open(self.a / ".nabd-monitor-owner.json", "w", encoding="utf-8") as stream:
            stream.write('{"account_id":"another-account"}')
        self.assertEqual(inspect_fleet(self.fleet(self.first))["instances"][0]["status"], "OWNER_MISMATCH")

    def test_duplicate_paths_accounts_workers_users_and_broker_logins(self):
        for field in ("terminal_path", "account_id", "worker_id", "windows_user", "login"):
            changed = dict(self.second, **{field: self.first[field]})
            with self.subTest(field=field), self.assertRaises(FleetError):
                validate_fleet(self.fleet(self.first, changed))

    def test_nested_paths_are_rejected(self):
        nested = self.a / "sub"
        nested.mkdir()
        (nested / "terminal64.exe").touch()
        changed = dict(self.second, terminal_path=str(nested / "terminal64.exe"))
        with self.assertRaises(FleetError):
            validate_fleet(self.fleet(self.first, changed))

    def test_secret_fields_live_accounts_and_missing_terminals_fail_closed(self):
        for fields in (
            {"token": "should-not-be-here"},
            {"password": "should-not-be-here"},
            {"environment": "live"},
            {"broker": "Other"},
            {"server": "JustMarkets-Live"},
            {"terminal_path": str(self.root / "not-installed" / "terminal64.exe")},
            {"windows_user": "NABD-demo-a;something"},
        ):
            with self.subTest(fields=list(fields)), self.assertRaises(FleetError):
                validate_fleet(self.fleet(dict(self.first, **fields)))

    def test_symlinked_ancestor_is_rejected(self):
        linked = self.root / "linked"
        try:
            linked.symlink_to(self.a, target_is_directory=True)
        except (NotImplementedError, OSError):
            self.skipTest("Symlinks unavailable")
        with self.assertRaises(FleetError):
            validate_fleet(self.fleet(dict(self.first, terminal_path=str(linked / "terminal64.exe"))))

    def test_manifest_structure_is_strict(self):
        bad = (
            {"version": 2, "instances": [self.first]},
            {"version": True, "instances": [self.first]},
            {"version": 1, "instances": []},
            {"version": 1, "instances": [self.first], "worker_token": "no"},
        )
        for document in bad:
            with self.subTest(document=document.get("version")), self.assertRaises(FleetError):
                validate_fleet(document)


if __name__ == "__main__":
    unittest.main()
