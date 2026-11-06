"""Unit tests for the local, secret-free Windows profile owner binding.

Run on Windows or Linux: py -m unittest discover -s windows -p 'test_*.py'
(Windows msvcrt file locking is exercised by the actual running monitor.)
"""
import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from nabd_mt5_instance_guard import (
    IsolationError, MARKER_NAME, bind_identity, canonical_path,
    expected_identity, terminal_profile_matches, verify_terminal_path
)


ACCOUNT_ONE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
ACCOUNT_TWO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"


class IsolatedProfilesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.a = self.root / "instance_a"
        self.b = self.root / "instance_b"
        self.a.mkdir()
        self.b.mkdir()
        self.exe_a = self.a / "terminal64.exe"
        self.exe_b = self.b / "terminal64.exe"
        self.exe_a.touch()
        self.exe_b.touch()

    def identity(self, account, exe, login):
        return expected_identity(
            account, "JustMarkets", "JustMarkets-Demo2", login, "demo",
            str(exe)
        )

    def test_two_accounts_must_use_different_persistent_directories(self):
        one = self.identity(ACCOUNT_ONE, self.exe_a, "12345678")
        two = self.identity(ACCOUNT_TWO, self.exe_b, "87654321")
        bind_identity(self.a, one)
        bind_identity(self.b, two)
        self.assertEqual(bind_identity(self.a, one), str(self.a / MARKER_NAME))
        self.assertEqual(bind_identity(self.b, two), str(self.b / MARKER_NAME))
        self.assertNotEqual(one["terminal_directory"], two["terminal_directory"])
        self.assertNotIn("token", json.dumps(one).lower())
        self.assertNotIn("password", json.dumps(two).lower())

    def test_second_subscriber_cannot_claim_the_same_terminal(self):
        one = self.identity(ACCOUNT_ONE, self.exe_a, "12345678")
        bind_identity(self.a, one)
        shared = self.identity(ACCOUNT_TWO, self.exe_a, "87654321")
        with self.assertRaises(IsolationError):
            bind_identity(self.a, shared)
        self.assertEqual(
            json.loads((self.a / MARKER_NAME).read_text())["account_id"],
            ACCOUNT_ONE
        )

    def test_rotating_worker_token_does_not_change_local_account_binding(self):
        one = self.identity(ACCOUNT_ONE, self.exe_a, "12345678")
        bind_identity(self.a, one)
        self.assertEqual(bind_identity(self.a, one), str(self.a / MARKER_NAME))
        with self.assertRaises(IsolationError):
            bind_identity(
                self.a, self.identity(ACCOUNT_ONE, self.exe_a, "99999999")
            )

    def test_tampered_or_corrupted_marker_fails_closed(self):
        one = self.identity(ACCOUNT_ONE, self.exe_a, "12345678")
        marker = self.a / MARKER_NAME
        marker.write_text('{"version":1}', encoding="utf-8")
        with self.assertRaises(IsolationError):
            bind_identity(self.a, one)
        marker.write_text("{broken", encoding="utf-8")
        with self.assertRaises(IsolationError):
            bind_identity(self.a, one)
        marker.write_text("x" * 2049, encoding="utf-8")
        with self.assertRaises(IsolationError):
            bind_identity(self.a, one)

    def test_portable_profile_identity_must_match_both_install_and_data_path(self):
        expected = self.identity(ACCOUNT_ONE, self.exe_a, "12345678")
        self.assertEqual(expected["terminal_directory"], canonical_path(self.a))
        good = SimpleNamespace(path=str(self.a), data_path=str(self.a / "MQL5"))
        self.assertTrue(terminal_profile_matches(good, str(self.exe_a)))
        self.assertFalse(terminal_profile_matches(
            SimpleNamespace(path=str(self.b), data_path=str(self.a)), str(self.exe_a)
        ))
        self.assertFalse(terminal_profile_matches(
            SimpleNamespace(path=str(self.a), data_path=str(self.b)), str(self.exe_a)
        ))
        self.assertFalse(terminal_profile_matches(None, str(self.exe_a)))

    def test_invalid_live_broker_and_missing_or_linked_install_are_refused(self):
        with self.assertRaises(IsolationError):
            expected_identity(ACCOUNT_ONE, "JustMarkets", "JustMarkets-Live",
                "12345678", "live", str(self.exe_a))
        with self.assertRaises(IsolationError):
            expected_identity(ACCOUNT_ONE, "OtherBroker", "JustMarkets-Demo2",
                "12345678", "demo", str(self.exe_a))
        with self.assertRaises(IsolationError):
            verify_terminal_path(str(self.a / "missing" / "terminal64.exe"))
        with self.assertRaises(IsolationError):
            verify_terminal_path("terminal64.exe")
        if hasattr(os, "symlink") and os.name != "nt":
            link = self.root / "terminal64.exe"
            link.symlink_to(self.exe_a)
            with self.assertRaises(IsolationError):
                verify_terminal_path(str(link))


if __name__ == "__main__":
    unittest.main()
