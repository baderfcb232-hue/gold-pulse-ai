"""Fail-closed local binding for NABD's read-only Windows MT5 Demo monitors.

Each MT5 installation has one durable non-secret owner marker and one
machine-local exclusive lock. This is defense-in-depth against operators
accidentally pointing two workers at one terminal; not a substitute for
separate, restricted Windows service accounts/ACLs.
"""
import json
import os
import re
from pathlib import Path

MARKER_NAME = ".nabd-monitor-owner.json"
LOCK_NAME = ".nabd-monitor.lock"


class IsolationError(RuntimeError):
    pass


def canonical_path(value):
    return os.path.normcase(os.path.realpath(os.path.abspath(str(value))))


def _is_link_or_junction(path):
    return os.path.islink(path) or (
        hasattr(os.path, "isjunction") and os.path.isjunction(path)
    )


def verify_terminal_path(terminal_path):
    """Never attach to an implicit/default terminal or an NTFS junction."""
    if not isinstance(terminal_path, str) or not os.path.isabs(terminal_path):
        raise IsolationError("Dedicated absolute terminal path is required")
    if Path(terminal_path).name.casefold() != "terminal64.exe":
        raise IsolationError("Expected a dedicated terminal64.exe")
    parent = Path(terminal_path).parent
    if _is_link_or_junction(terminal_path) or _is_link_or_junction(str(parent)):
        raise IsolationError("Links and junctions are not allowed for MT5 instances")
    if not Path(terminal_path).is_file():
        raise IsolationError("Dedicated terminal64.exe does not exist")
    return canonical_path(parent)


def expected_identity(account_id, broker, server, login, environment, terminal_path):
    """No token, investor password or trading secret is ever written to disk."""
    if not re.fullmatch(r"[a-f0-9-]{36}", account_id or ""):
        raise IsolationError("Invalid account identifier")
    if broker != "JustMarkets" or environment != "demo":
        raise IsolationError("Only JustMarkets Demo monitoring is allowed")
    if not re.fullmatch(r"JustMarkets-Demo[0-9]{0,5}", server or ""):
        raise IsolationError("Unexpected broker server")
    if not re.fullmatch(r"[1-9][0-9]{3,15}", login or ""):
        raise IsolationError("Unexpected broker account login")
    return {
        "version": 1, "account_id": account_id, "broker": broker,
        "server": server, "login": login, "environment": environment,
        "terminal_directory": verify_terminal_path(terminal_path),
    }


def bind_identity(directory, expected):
    """Atomic first registration; reject conflicting owner on future starts.

    Must be invoked while holding the exclusive instance lock.
    Can be tested separately with a temporary fake terminal on Linux.
    """
    location = Path(directory) / MARKER_NAME
    if _is_link_or_junction(str(location)):
        raise IsolationError("MT5 owner marker must not be a link or junction")
    payload = json.dumps(expected, sort_keys=True, separators=(",", ":"))
    try:
        fd = os.open(str(location), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        fd = None
    if fd is not None:
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                stream.write(payload + "\n")
                stream.flush()
                os.fsync(stream.fileno())
        except BaseException:
            # Do not leave a partly written marker that might be misread.
            try:
                location.unlink()
            except OSError:
                pass
            raise
    try:
        if location.stat().st_size > 2048:
            raise IsolationError("Owner marker is unexpectedly large")
        actual = json.loads(location.read_text(encoding="utf-8"))
    except (OSError, ValueError, UnicodeError) as exc:
        raise IsolationError("Owner marker unreadable; manual review required") from exc
    if actual != expected:
        raise IsolationError(
            "MT5 instance already belongs to another account or has moved; "
            "refusing to share a terminal"
        )
    return str(location)


class InstanceLease:
    """Exclusive cross-process lock on Windows, kept for the worker lifetime."""
    def __init__(self, terminal_path, expected):
        self.directory = verify_terminal_path(terminal_path)
        if expected.get("terminal_directory") != self.directory:
            raise IsolationError("MT5 profile path does not match the owner binding")
        self._file = None
        self._locked = False
        self._msvcrt = None
        try:
            import msvcrt
            self._msvcrt = msvcrt
            lock_path = Path(self.directory) / LOCK_NAME
            if _is_link_or_junction(str(lock_path)):
                raise IsolationError("Instance lock must not be a link")
            self._file = open(lock_path, "a+b")
            self._file.seek(0, os.SEEK_END)
            if self._file.tell() < 1:
                self._file.write(b"\0")
                self._file.flush()
            self._file.seek(0)
            try:
                msvcrt.locking(self._file.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as exc:
                raise IsolationError(
                    "Another worker is already attached to this MT5 instance"
                ) from exc
            self._locked = True
            bind_identity(self.directory, expected)
        except BaseException:
            self.release()
            raise

    def release(self):
        if self._file is not None:
            if self._locked:
                try:
                    self._file.seek(0)
                    self._msvcrt.locking(
                        self._file.fileno(), self._msvcrt.LK_UNLCK, 1
                    )
                except OSError:
                    pass
            self._file.close()
            self._file = None
            self._locked = False


def terminal_profile_matches(terminal_info, terminal_path):
    """MT5 Python may auto-find another terminal; never trust that fallback."""
    if terminal_info is None:
        return False
    expected = verify_terminal_path(terminal_path)
    reported = getattr(terminal_info, "path", None)
    data = getattr(terminal_info, "data_path", None)
    if not isinstance(reported, str) or not isinstance(data, str):
        return False
    terminal_dir = canonical_path(reported)
    data_dir = canonical_path(data)
    try:
        return terminal_dir == expected and os.path.commonpath(
            [expected, data_dir]
        ) == expected
    except ValueError:
        return False
