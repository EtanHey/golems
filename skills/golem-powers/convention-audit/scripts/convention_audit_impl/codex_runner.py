"""Codex process results and execution contracts."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

@dataclass
class WorkerResult:
    label: str
    payload: dict[str, Any]
    events: list[dict[str, Any]]
    wall_seconds: float
    stdout_log: str
    stderr_log: str
