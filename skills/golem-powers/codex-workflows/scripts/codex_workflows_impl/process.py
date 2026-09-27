"""Process operations for headless Codex workflows."""

from __future__ import annotations

from pathlib import Path
from typing import Any
import json
import subprocess
import time

from .config import CodexWorkflowError, LAUNCH_FAILURE_RE
from .logs import _recognized_event


def _ps_value(pid: int, field: str) -> str:
    completed = subprocess.run(
        ["ps", "-p", str(pid), "-o", f"{field}="],
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    if completed.returncode != 0:
        return ""
    return completed.stdout.strip()


def capture_process_identity(pid: int) -> dict[str, Any]:
    """Capture fields that distinguish one process from a reused PID."""
    stat = _ps_value(pid, "stat")
    start_time = _ps_value(pid, "lstart")
    command = _ps_value(pid, "command")
    if not stat or not start_time or not command:
        raise CodexWorkflowError(f"process is not observable: {pid}")
    return {
        "pid": int(pid),
        "stat": stat,
        "start_time": start_time,
        "command": command,
    }


def process_identity_alive(identity: dict[str, Any]) -> bool:
    """Return true only for the same live, non-zombie process."""
    try:
        current = capture_process_identity(int(identity["pid"]))
    except (KeyError, TypeError, ValueError, CodexWorkflowError):
        return False
    if current["stat"].upper().startswith("Z"):
        return False
    return (
        current["start_time"] == identity.get("start_time")
        and current["command"] == identity.get("command")
    )


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
        alive = process_identity_alive(identity) if identity is not None else _pid_alive(pid)
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
