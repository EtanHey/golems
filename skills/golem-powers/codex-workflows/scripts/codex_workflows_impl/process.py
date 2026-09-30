"""Process operations for headless Codex workflows."""

from __future__ import annotations

from pathlib import Path
from typing import Any
import json
import os
import subprocess
import sys
import time

from .config import CodexWorkflowError, LAUNCH_FAILURE_RE
from .logs import _recognized_event


class _ProcessNotObservable(CodexWorkflowError):
    """The PID disappeared, rather than an identity sample being uncertain."""


def _ps_value(pid: int, field: str) -> str:
    completed = subprocess.run(
        ["ps", "-p", str(pid), "-o", f"{field}="],
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        env={**os.environ, "LC_ALL": "C", "TZ": "UTC"},
    )
    if completed.returncode != 0:
        return ""
    return completed.stdout.strip()


def _linux_start_ticks(pid: int) -> str:
    try:
        raw = Path(f"/proc/{pid}/stat").read_text()
        # comm is parenthesized but can itself contain spaces and parentheses.
        end = raw.rindex(")")
        fields = raw[end + 1:].split()  # first field is state (field 3)
        ticks = fields[19]  # starttime is field 22
        if not ticks.isdecimal():
            raise ValueError("non-numeric start ticks")
        return ticks
    except FileNotFoundError as exc:
        raise _ProcessNotObservable(f"process is not observable: {pid}") from exc
    except (OSError, ValueError, IndexError) as exc:
        raise CodexWorkflowError(f"cannot read process identity for PID {pid}; reconcile the manifest before retrying") from exc


def capture_process_identity(pid: int) -> dict[str, Any]:
    """Capture fields that distinguish one process from a reused PID."""
    stat = _ps_value(pid, "stat")
    command = _ps_value(pid, "command")
    linux = sys.platform.startswith("linux")
    start_time = _linux_start_ticks(pid) if linux else _ps_value(pid, "lstart")
    if not stat or not start_time or not command:
        raise _ProcessNotObservable(f"process is not observable: {pid}")
    return {
        "pid": int(pid),
        "stat": stat,
        "start_time": start_time,
        "start_kind": "linux-start-ticks-v1" if linux else "ps-lstart-utc-v1",
        "command": command,
    }


def process_identity_alive(identity: dict[str, Any]) -> bool:
    """Return true only for the same live, non-zombie process."""
    try:
        current = capture_process_identity(int(identity["pid"]))
    except (KeyError, TypeError, ValueError, _ProcessNotObservable):
        return False
    if current["stat"].upper().startswith("Z"):
        return False
    kind = identity.get("start_kind")
    if kind is not None and kind != current["start_kind"]:
        raise CodexWorkflowError(f"unsupported process identity kind: {kind!r}; reconcile the manifest after verifying worker exit")
    if current["command"] != identity.get("command"):
        return False
    if kind is None:
        # Old manifests stored local/locale-dependent lstart. A mismatch cannot
        # distinguish clock/TZ drift from same-command PID reuse: never finalize.
        if _ps_value(current["pid"], "lstart") == identity.get("start_time"):
            return True
        raise CodexWorkflowError(f"legacy process identity for PID {current['pid']} is ambiguous; reconcile the manifest after verifying worker exit")
    return current["start_time"] == identity.get("start_time")


def _pid_alive(pid: int) -> bool:
    stat = _ps_value(pid, "stat")
    return bool(stat) and not stat.upper().startswith("Z")


def _launch_log_evidence(path: Path, initial_size: int) -> dict[str, Any]:
    if not path.exists() or path.stat().st_size <= initial_size:
        return {"activity": False, "failure": None}
    with path.open("rb") as handle:
        handle.seek(initial_size)
        text = handle.read().decode("utf-8", errors="replace")
    activity = False
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("{"):
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                event = None
            if isinstance(event, dict) and _recognized_event(event):
                activity = True
                continue
            if activity:
                continue
        if not activity and LAUNCH_FAILURE_RE.search(line):
            return {"activity": False, "failure": line}
    return {"activity": activity, "failure": None}


def verify_launch(
    *,
    pid: int,
    log_path: Path | str,
    initial_size: int,
    timeout: float,
    identity: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Reject dead false-green launches before reporting a worker."""
    deadline = time.monotonic() + max(timeout, 0.0)
    path = Path(log_path)
    if identity is None:
        try:
            identity = capture_process_identity(pid)
        except _ProcessNotObservable:
            pass
    last_evidence = {"activity": False, "failure": None}
    while True:
        last_evidence = _launch_log_evidence(path, initial_size)
        if last_evidence["failure"]:
            return {
                "ok": False,
                "state": "failed_launch",
                "pid": pid,
                "reason": f"launcher diagnostic: {last_evidence['failure']}",
            }
        alive = process_identity_alive(identity) if identity is not None else False
        if last_evidence["activity"]:
            return {
                "ok": True,
                "state": "running" if alive else "completed_fast",
                "pid": pid,
                "evidence": "codex_event",
            }
        now = time.monotonic()
        if now >= deadline:
            if alive:
                return {
                    "ok": True,
                    "state": "running",
                    "pid": pid,
                    "evidence": "process_alive_after_grace",
                }
            return {
                "ok": False,
                "state": "failed_launch",
                "pid": pid,
                "reason": "process exited before Codex activity",
            }
        if not alive:
            time.sleep(min(0.05, max(0.0, deadline - now)))
        else:
            time.sleep(min(0.05, max(0.0, deadline - now)))
