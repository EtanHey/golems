#!/usr/bin/env python3
"""GREEN arm runner for AutoCursor parity.

The deterministic gate uses replay fixtures. A future live calibration mode can
switch this module to call skills/golem-powers/cursor-workflows/lib/autocursor.py
directly; the import guard here keeps this eval runnable while Worker A lands the
primitives library in parallel.
"""

from __future__ import annotations

import importlib
import inspect
import json
import subprocess
import sys
from pathlib import Path


def autocursor_import_status(eval_dir: Path) -> dict:
    cursor_workflows_dir = eval_dir.parents[1]
    repo_root = eval_dir.parents[4]
    lib_dir = cursor_workflows_dir / "lib"
    module_path = lib_dir / "autocursor.py"
    status = {
        "status": "missing",
        "path": str(module_path.relative_to(repo_root)),
        "signatures": {},
    }
    if not module_path.exists():
        return status

    sys.path.insert(0, str(lib_dir))
    try:
        autocursor = importlib.import_module("autocursor")
    except Exception as exc:  # pragma: no cover - depends on parallel Worker A.
        status["status"] = f"import_error:{type(exc).__name__}"
        status["error"] = str(exc)
        return status

    expected = ("agent", "parallel", "pipeline", "phase", "loop_until_dry")
    missing = [name for name in expected if not hasattr(autocursor, name)]
    if missing:
        status["status"] = "incomplete"
        status["missing"] = missing
        return status
    status["status"] = "available"
    status["signatures"] = {
        name: str(inspect.signature(getattr(autocursor, name))) for name in expected
    }
    return status


def run_smoke_replay(eval_dir: Path) -> dict:
    script = eval_dir / "smoke_replay_cursor.mjs"
    spec = eval_dir / "replay" / "cursor-smoke-spec.json"
    result = subprocess.run(
        ["node", str(script), "--spec", str(spec)],
        cwd=str(eval_dir),
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "smoke replay failed "
            f"exit={result.returncode}\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )
    try:
        report = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"smoke replay emitted malformed JSON: {exc}\n{result.stdout}") from exc
    return report


def parse_cursor_ndjson(text: str, *, label: str) -> dict:
    findings: list[dict] = []
    usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    billing: dict = {}
    round_count = 0
    for line_no, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{label}:{line_no} malformed cursor NDJSON: {exc}") from exc
        if not isinstance(event, dict):
            raise ValueError(f"{label}:{line_no} cursor NDJSON event must be an object")
        if event.get("type") == "round":
            round_count += 1
            event_findings = event.get("findings", [])
            if not isinstance(event_findings, list):
                raise ValueError(f"{label}:{line_no} round findings must be a list")
            findings.extend(event_findings)
            event_usage = event.get("usage", {})
            for key in usage:
                value = event_usage.get(key, 0)
                if not isinstance(value, int) or value < 0:
                    raise ValueError(f"{label}:{line_no} usage.{key} must be a non-negative int")
                usage[key] += value
        elif event.get("type") == "ledger":
            ledger_usage = event.get("usage", {})
            for key in usage:
                if ledger_usage.get(key) != usage[key]:
                    raise ValueError(
                        f"{label}:{line_no} ledger usage.{key}={ledger_usage.get(key)!r} "
                        f"does not match summed rounds {usage[key]}"
                    )
            billing = event.get("billing", {})
            if not isinstance(billing, dict):
                raise ValueError(f"{label}:{line_no} billing must be an object")
    return {
        "findings": findings,
        "usage": usage,
        "billing": billing,
        "round_count": round_count,
    }


def load_green_replay(eval_dir: Path) -> dict:
    smoke_report = run_smoke_replay(eval_dir)
    with_text = smoke_report.get("with", {}).get("text")
    without_text = smoke_report.get("without", {}).get("text")
    if not isinstance(with_text, str) or not isinstance(without_text, str):
        raise ValueError("smoke replay report must contain without.text and with.text")

    green = parse_cursor_ndjson(with_text, label="cursor-agent.loop-until-dry.ndjson")
    single_pass = parse_cursor_ndjson(without_text, label="cursor-agent.single-pass.ndjson")
    green["single_pass"] = single_pass
    green["smoke_report"] = smoke_report
    green["autocursor_import"] = autocursor_import_status(eval_dir)
    return green
