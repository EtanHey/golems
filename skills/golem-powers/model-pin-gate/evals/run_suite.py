#!/usr/bin/env python3
"""Offline PreToolUse hook suite for model-pin-gate.

Feeds every RED/GREEN fixture to the hook wrapper on stdin and asserts the
Claude Code stdout schema:
  allow: {}
  block: {"decision":"block","reason":"..."}
  advisory: {"systemMessage":"..."}

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
HOOK = ROOT / "scripts" / "model-pin-gate-hook.mjs"
NODE = os.environ.get("MODEL_PIN_GATE_NODE") or shutil.which("node") or "node"
TIMEOUT_SECONDS = float(os.environ.get("MODEL_PIN_GATE_TIMEOUT_SECONDS", "0.5"))


def load_cases() -> list[tuple[str, Path, dict]]:
    cases: list[tuple[str, Path, dict]] = []
    for group in ("green", "red"):
        for path in sorted((FIXTURES / group).glob("*.json")):
            cases.append((group, path, json.loads(path.read_text())))
    return cases


def run_hook(fixture: dict) -> tuple[bool, str]:
    payload = fixture["payload"]
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
        if "model:'opus'|'sonnet'|'haiku'" not in reason and violation == "MODELPIN_AGENT_UNPINNED":
            return False, f"reason missing pin fix: {reason!r}"
        return True, "block"
    if expect == "ADVISORY":
        message = parsed.get("systemMessage")
        if not isinstance(message, str) or not message.strip():
            return False, f"expected systemMessage advisory, got {parsed!r}"
        violation = fixture.get("violation")
        if violation and violation not in message:
            return False, f"advisory missing {violation}: {message!r}"
        if parsed.get("decision") == "block":
            return False, f"advisory case must not block: {parsed!r}"
        return True, "advisory"
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


def verify_transcript_path_tail() -> tuple[bool, str]:
    lines = [
        {"type": "assistant", "message": {"role": "assistant", "model": "claude-opus-4-8", "content": []}},
        {"type": "assistant", "message": {"role": "assistant", "model": "claude-fable-5", "content": []}},
    ]
    with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as tmp:
        path = Path(tmp.name)
        for line in lines:
            tmp.write(json.dumps(line) + "\n")
    try:
        proc = subprocess.run(
            [NODE, str(HOOK)],
            input=json.dumps(
                {
                    "hook_event_name": "PreToolUse",
                    "transcript_path": str(path),
                    "tool_name": "Agent",
                    "tool_input": {"prompt": "missing model"},
                }
            ),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return False, f"transcript_path hook timed out after {TIMEOUT_SECONDS}s"
    except FileNotFoundError:
        return False, f"node executable not found: {NODE}"
    finally:
        path.unlink(missing_ok=True)

    if proc.returncode != 0:
        return False, f"transcript_path exited {proc.returncode}: stderr={proc.stderr.strip()!r}"
    try:
        parsed = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError as exc:
        return False, f"transcript_path stdout not JSON: {exc}: {proc.stdout!r}"
    reason = parsed.get("reason", "")
    if parsed.get("decision") != "block" or "MODELPIN_AGENT_UNPINNED" not in reason:
        return False, f"expected transcript_path block, got {parsed!r}"
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

    for name, fn in (
        ("malformed-stdin-fail-open", verify_fail_open),
        ("transcript-path-tail", verify_transcript_path_tail),
    ):
        ok, detail = fn()
        status = "PASS" if ok else "FAIL"
        if not ok:
            failures += 1
        rows.append((status, "HOOK", name, detail))

    print("| status | group | case | detail |")
    print("|---|---|---|---|")
    for status, group, name, detail in rows:
        print(f"| {status} | {group} | {name} | {detail} |")
    print(f"\nTotals: {len(rows) - failures}/{len(rows)} passing")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
