#!/usr/bin/env python3
"""Offline merge-gate suite for fleet-wrap-gate.

Feeds every RED/GREEN fixture to the Claude Stop hook wrapper on stdin and
asserts the hook stdout schema:
  allow: {}
  block: {"decision":"block","reason":"..."}

The suite is local-only and bounded by a short per-case timeout.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).resolve().parent / "fixtures"
HOOK = ROOT / "scripts" / "fleet-wrap-gate-hook.mjs"
NODE = os.environ.get("FLEET_WRAP_GATE_NODE") or shutil.which("node") or "node"
TIMEOUT_SECONDS = float(os.environ.get("FLEET_WRAP_GATE_TIMEOUT_SECONDS", "0.5"))


def load_cases() -> list[tuple[str, Path, dict]]:
    cases: list[tuple[str, Path, dict]] = []
    for group in ("green", "red"):
        for path in sorted((FIXTURES / group).glob("*.json")):
            cases.append((group, path, json.loads(path.read_text())))
    return cases


def run_hook(fixture: dict) -> tuple[bool, str]:
    payload = {
        "hook_event_name": "Stop",
        "transcript": fixture,
        "state": fixture.get("state", {}),
    }
    try:
        proc = subprocess.run(
            [NODE, str(HOOK)],
            input=json.dumps(payload),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return False, f"hook timed out after {TIMEOUT_SECONDS}s"
    except FileNotFoundError:
        return False, f"node executable not found: {NODE}"
    if proc.returncode != 0:
        return False, f"hook exited {proc.returncode}: stderr={proc.stderr.strip()!r}"
    try:
        parsed = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError as exc:
        return False, f"stdout is not JSON: {exc}: {proc.stdout!r}"

    expect = fixture.get("expect")
    if expect == "PASS":
        if parsed == {}:
            return True, "allow"
        return False, f"expected allow {{}}, got {parsed!r}"
    if expect == "FLAG":
        if parsed.get("decision") != "block":
            return False, f"expected block decision, got {parsed!r}"
        reason = parsed.get("reason")
        if not isinstance(reason, str) or not reason.strip():
            return False, f"block reason missing: {parsed!r}"
        violation = fixture.get("violation")
        if violation and violation not in reason:
            return False, f"reason missing {violation}: {reason!r}"
        if "delete cron " not in reason and "TaskStop " not in reason:
            return False, f"reason missing exact cleanup action: {reason!r}"
        return True, "block"
    return False, f"unknown expect={expect!r}"


def verify_fail_open() -> tuple[bool, str]:
    try:
        proc = subprocess.run(
            [NODE, str(HOOK)],
            input="{not json",
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return False, f"malformed stdin hook timed out after {TIMEOUT_SECONDS}s"
    except FileNotFoundError:
        return False, f"node executable not found: {NODE}"
    if proc.returncode != 0:
        return False, f"malformed stdin exited {proc.returncode}"
    try:
        parsed = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError as exc:
        return False, f"malformed stdin stdout not JSON: {exc}: {proc.stdout!r}"
    if parsed != {}:
        return False, f"malformed stdin should fail-open with {{}}, got {parsed!r}"
    return True, "allow"


def verify_transcript_path_jsonl_and_state_path() -> tuple[bool, str]:
    lines = [
        {
            "type": "user",
            "message": {
                "role": "user",
                "content": [{"type": "text", "text": "wrap the fleet"}],
            },
        },
        {
            "type": "assistant",
            "message": {
                "role": "assistant",
                "content": [{"type": "text", "text": "Fleet wrapped. All crons deleted, going silent."}],
            },
        },
    ]
    with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as transcript_tmp:
        transcript_path = Path(transcript_tmp.name)
        for line in lines:
            transcript_tmp.write(json.dumps(line) + "\n")
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as state_tmp:
        state_path = Path(state_tmp.name)
        json.dump(
            {
                "crons": [
                    {
                        "id": "cron-state-path",
                        "status": "active",
                        "prompt": "health-watch poll",
                    }
                ]
            },
            state_tmp,
        )
    try:
        proc = subprocess.run(
            [NODE, str(HOOK)],
            input=json.dumps(
                {
                    "hook_event_name": "Stop",
                    "transcript_path": str(transcript_path),
                    "state_path": str(state_path),
                }
            ),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return False, f"transcript_path/state_path hook timed out after {TIMEOUT_SECONDS}s"
    except FileNotFoundError:
        return False, f"node executable not found: {NODE}"
    finally:
        transcript_path.unlink(missing_ok=True)
        state_path.unlink(missing_ok=True)

    if proc.returncode != 0:
        return False, f"transcript_path/state_path exited {proc.returncode}: stderr={proc.stderr.strip()!r}"
    try:
        parsed = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError as exc:
        return False, f"transcript_path/state_path stdout not JSON: {exc}: {proc.stdout!r}"
    reason = parsed.get("reason", "")
    if parsed.get("decision") != "block":
        return False, f"expected transcript_path/state_path block, got {parsed!r}"
    if "FLEETWRAP_CRON_ALIVE" not in reason or "delete cron cron-state-path" not in reason:
        return False, f"expected typed cron cleanup reason, got {reason!r}"
    return True, "block"


def main() -> int:
    rows: list[tuple[str, str, str, str]] = []
    failures = 0
    cases = load_cases()
    if not cases:
        rows.append(("FAIL", "SUITE", "fixtures-present", "no RED/GREEN fixture JSON files found"))
        failures += 1

    for group, path, fixture in cases:
        ok, detail = run_hook(fixture)
        status = "PASS" if ok else "FAIL"
        if not ok:
            failures += 1
        rows.append((status, group.upper(), path.name, detail))

    ok, detail = verify_fail_open()
    status = "PASS" if ok else "FAIL"
    if not ok:
        failures += 1
    rows.append((status, "HOOK", "malformed-stdin-fail-open", detail))

    ok, detail = verify_transcript_path_jsonl_and_state_path()
    status = "PASS" if ok else "FAIL"
    if not ok:
        failures += 1
    rows.append((status, "HOOK", "transcript-path-jsonl-state-path", detail))

    print("| status | group | case | detail |")
    print("|---|---|---|---|")
    for status, group, name, detail in rows:
        print(f"| {status} | {group} | {name} | {detail} |")
    print(f"\nTotals: {len(rows) - failures}/{len(rows)} passing")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
