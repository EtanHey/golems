#!/usr/bin/env python3
"""Example AutoCursor gather workflow over a small file list."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.autocursor import agent, parallel, phase  # noqa: E402


FINDINGS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["file", "findings"],
    "properties": {
        "file": {"type": "string"},
        "findings": {"type": "array"},
        "summary": {"type": "string"},
    },
}


def gather_file(path: Path) -> dict:
    prompt = f"""Read this file and report concrete gather findings only.

File: {path}

Return one JSON object:
- file: the file path
- findings: array of objects with id, title, evidence, and importance
- summary: one short sentence

Do not edit files.
"""
    return agent(prompt, schema=FINDINGS_SCHEMA, label=path.name, timeout=600)


def token_ledger(results: list[dict | None]) -> dict[str, int]:
    ledger = {"inputTokens": 0, "outputTokens": 0, "totalTokens": 0}
    for result in results:
        if not result:
            continue
        usage = result.get("usage", {})
        ledger["inputTokens"] += int(usage.get("inputTokens", 0))
        ledger["outputTokens"] += int(usage.get("outputTokens", 0))
    ledger["totalTokens"] = ledger["inputTokens"] + ledger["outputTokens"]
    return ledger


def result_failed(result: dict | None) -> bool:
    if result is None:
        return True
    if result.get("status") != "ok":
        return True
    if result.get("exit_code") != 0:
        return True
    return result.get("data") is None


def main(argv: list[str]) -> int:
    files = [Path(arg) for arg in argv] or [Path("README.md"), Path("AGENTS.md")]
    existing = [path for path in files if path.exists() and path.is_file()]
    if not existing:
        print(json.dumps({"error": "no input files found", "files": [str(path) for path in files]}, indent=2))
        return 1

    phase(f"gather {len(existing)} files")
    results = parallel([lambda path=path: gather_file(path) for path in existing], concurrency=8)
    payload = {
        "results": [
            {
                "label": result.get("label"),
                "status": result.get("status"),
                "error": result.get("error"),
                "exit_code": result.get("exit_code"),
                "data": result.get("data"),
                "usage": result.get("usage"),
                "log_path": result.get("log_path"),
            }
            for result in results
            if result
        ],
        "token_ledger": token_ledger(results),
        "failed": sum(1 for result in results if result_failed(result)),
    }
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
