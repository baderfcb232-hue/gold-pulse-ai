"""NABD phase 12: non-secret, read-only preflight for isolated Windows MT5 Demo fleet.

This tool never logs in to MT5, starts a terminal, handles a worker token,
provisions broker credentials, or issues trades. Intended for the VPS operator.
Run: py -3 windows\nabd_mt5_fleet_preflight.py path\to\fleet.json
"""
import json
import os
import re
import sys
from pathlib import Path

from nabd_mt5_instance_guard import (
    MARKER_NAME, IsolationError, canonical_path, expected_identity,
    verify_terminal_path,
)

UUID_PATTERN = re.compile(r"^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$")
SLOT_PATTERN = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")
WINDOWS_USER_PATTERN = re.compile(r"^(?:[a-zA-Z0-9._-]{1,40}\\)?[a-zA-Z0-9._-]{1,40}$")
FIELDS = frozenset((
    "slot", "account_id", "worker_id", "broker", "server", "login",
    "environment", "terminal_path", "windows_user",
))


class FleetError(ValueError):
    """Invalid/unsafe fleet configuration; fail closed without logging secrets."""


def _fail(reason):
    raise FleetError(reason)


def _no_links_in_ancestors(path):
    current = Path(path).absolute()
    for part in (current, *current.parents):
        if part.is_symlink() or (hasattr(part, "is_junction") and part.is_junction()):
            _fail("Instance paths cannot contain a link or junction")


def validate_fleet(document):
    """Verify tenant separation without connecting to any MT5 or remote service."""
    if not isinstance(document, dict) or set(document) != {"version", "instances"}:
        _fail("Fleet requires only version and instances keys")
    if document["version"] != 1 or isinstance(document["version"], bool):
        _fail("Unsupported fleet version")
    entries = document["instances"]
    if not isinstance(entries, list) or not 1 <= len(entries) <= 256:
        _fail("Fleet requires 1 to 256 instance records")
    seen = {k: set() for k in ("slot", "account_id", "worker_id", "windows_user",
                               "terminal_path", "broker_account")}
    validated = []
    for index, entry in enumerate(entries, 1):
        if not isinstance(entry, dict) or set(entry) != FIELDS:
            _fail(f"Slot {index}: invalid or extra fields (secrets are forbidden)")
        for key in FIELDS:
            if not isinstance(entry[key], str) or not entry[key].strip():
                _fail(f"Slot {index}: empty or invalid {key}")
        if not SLOT_PATTERN.fullmatch(entry["slot"]):
            _fail(f"Slot {index}: invalid slot label")
        if not UUID_PATTERN.fullmatch(entry["account_id"]) or not UUID_PATTERN.fullmatch(entry["worker_id"]):
            _fail(f"Slot {index}: invalid worker/account UUID")
        if not WINDOWS_USER_PATTERN.fullmatch(entry["windows_user"]):
            _fail(f"Slot {index}: use a dedicated, unambiguous Windows username")
        if entry["environment"] != "demo" or entry["broker"] != "JustMarkets":
            _fail(f"Slot {index}: JustMarkets Demo monitoring only")
        if not re.fullmatch(r"JustMarkets-Demo[0-9]{0,5}", entry["server"]):
            _fail(f"Slot {index}: unsupported Demo server")
        if not re.fullmatch(r"[1-9][0-9]{3,15}", entry["login"]):
            _fail(f"Slot {index}: invalid broker account")
        # This checks a real, dedicated installed terminal; never auto-install.
        _no_links_in_ancestors(entry["terminal_path"])
        try:
            directory = verify_terminal_path(entry["terminal_path"])
            identity = expected_identity(
                entry["account_id"], entry["broker"], entry["server"],
                entry["login"], entry["environment"], entry["terminal_path"]
            )
        except IsolationError as exc:
            _fail(f"Slot {index}: isolated terminal unavailable ({exc})")
        values = {
            "slot": entry["slot"].casefold(),
            "account_id": entry["account_id"].casefold(),
            "worker_id": entry["worker_id"].casefold(),
            "windows_user": entry["windows_user"].casefold(),
            "terminal_path": directory.casefold(),
            "broker_account": (entry["broker"].casefold(), entry["server"].casefold(), entry["login"]),
        }
        for key, value in values.items():
            if value in seen[key]:
                _fail(f"Slot {index}: duplicate {key}; shared accounts, identities and terminals are forbidden")
            seen[key].add(value)
        # Reject nested installations too: a shared portable data tree is unsafe.
        for prior in validated:
            old = prior["identity"]["terminal_directory"]
            try:
                common = os.path.commonpath([old, directory])
            except ValueError:
                continue  # Different Windows volumes cannot share a data tree.
            if common in (old, directory):
                _fail(f"Slot {index}: overlapping portable terminal folders")
        validated.append({"slot": entry["slot"], "identity": identity,
                          "windows_user": entry["windows_user"]})
    return validated


def inspect_fleet(document):
    instances = validate_fleet(document)
    statuses = []
    for item in instances:
        identity = item["identity"]
        owner_file = Path(identity["terminal_directory"]) / MARKER_NAME
        _no_links_in_ancestors(owner_file)
        if not owner_file.exists():
            status = "AWAITING_FIRST_MONITOR_RUN"
        else:
            try:
                if owner_file.stat().st_size > 2048:
                    status = "OWNER_MISMATCH"
                else:
                    current = json.loads(owner_file.read_text(encoding="utf-8"))
                    status = "OWNER_BOUND" if current == identity else "OWNER_MISMATCH"
            except (OSError, ValueError, UnicodeError):
                status = "OWNER_MISMATCH"
        statuses.append({"slot": item["slot"], "status": status,
                         "monitoringOnly": True, "tradeAllowed": False})
    return {"count": len(instances), "instances": statuses,
            "monitoringOnly": True, "tradeAllowed": False}


def main(argv):
    if len(argv) != 2:
        print("Usage: nabd_mt5_fleet_preflight.py fleet.json", file=sys.stderr)
        return 2
    try:
        path = Path(argv[1]).absolute()
        _no_links_in_ancestors(path)
        if path.stat().st_size > 128 * 1024:
            _fail("Fleet file too large")
        document = json.loads(path.read_text(encoding="utf-8"))
        result = inspect_fleet(document)
        print(json.dumps(result, separators=(",", ":")))
        return 1 if any(i["status"] == "OWNER_MISMATCH" for i in result["instances"]) else 0
    except (FleetError, ValueError, OSError, UnicodeError) as exc:
        # Never print file contents: a malformed manifest may accidentally hold secrets.
        print("NABD fleet preflight failed: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
