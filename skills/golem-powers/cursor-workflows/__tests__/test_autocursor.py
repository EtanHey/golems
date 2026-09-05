from __future__ import annotations

import importlib.util
import os
import stat
import sys
import time
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib import autocursor  # noqa: E402


def load_example_gather():
    script = ROOT / "scripts" / "example-gather.py"
    spec = importlib.util.spec_from_file_location("example_gather", script)
    assert spec is not None
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def install_fake_cursor(tmp_path: Path, body: str, monkeypatch: pytest.MonkeyPatch) -> Path:
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    cursor = fake_bin / "cursor-agent"
    cursor.write_text("#!/usr/bin/env python3\n" + body)
    cursor.chmod(cursor.stat().st_mode | stat.S_IXUSR)
    monkeypatch.setenv("PATH", f"{fake_bin}{os.pathsep}{os.environ.get('PATH', '')}")
    monkeypatch.setenv("AUTOCURSOR_LOG_DIR", str(tmp_path / "logs"))
    return cursor


def test_agent_validates_schema_retries_and_aggregates_tokens(tmp_path, monkeypatch):
    attempts = tmp_path / "attempts.txt"
    argv_log = tmp_path / "argv.txt"
    monkeypatch.setenv("AUTOCURSOR_FAKE_ATTEMPTS", str(attempts))
    monkeypatch.setenv("AUTOCURSOR_ARGV_LOG", str(argv_log))
    install_fake_cursor(
        tmp_path,
        r'''
import json
import os
import sys

attempts = os.environ["AUTOCURSOR_FAKE_ATTEMPTS"]
argv_log = os.environ["AUTOCURSOR_ARGV_LOG"]
open(argv_log, "w").write("\n".join(sys.argv[1:]))
try:
    n = int(open(attempts).read()) + 1
except FileNotFoundError:
    n = 1
open(attempts, "w").write(str(n))
if n == 1:
    print(json.dumps({"type": "assistant", "text": "not json"}), flush=True)
    print(json.dumps({"usage": {"inputTokens": 1, "outputTokens": 2}}), flush=True)
else:
    print(json.dumps({"type": "assistant", "text": "{\"finding_id\":\"F1\",\"severity\":2}"}), flush=True)
    print(json.dumps({"usage": {"inputTokens": 3, "outputTokens": 4}}), flush=True)
''',
        monkeypatch,
    )

    result = autocursor.agent(
        "inspect files",
        label="schema-run",
        schema={
            "type": "object",
            "required": ["finding_id", "severity"],
            "properties": {
                "finding_id": {"type": "string"},
                "severity": {"type": "number"},
            },
        },
    )

    assert result["data"] == {"finding_id": "F1", "severity": 2}
    assert result["usage"] == {"inputTokens": 4, "outputTokens": 6, "totalTokens": 10}
    assert result["exit_code"] == 0
    assert attempts.read_text() == "2"
    argv_lines = argv_log.read_text().splitlines()
    assert "--approve-mcps" in argv_lines
    assert not any(arg == "--model" or arg.startswith("--model=") for arg in argv_lines)
    assert len(result["log_paths"]) == 2
    assert "not json" in Path(result["log_paths"][0]).read_text()
    assert "F1" in Path(result["log_paths"][1]).read_text()


def test_parallel_preserves_order_and_turns_failed_thunks_into_none(monkeypatch):
    monkeypatch.setenv("MAX_CHILDREN", "2")

    def fail():
        raise RuntimeError("boom")

    assert autocursor.parallel([lambda: "a", fail, lambda: "c"], concurrency=8) == ["a", None, "c"]


def test_pipeline_drops_failed_items_to_none_and_keeps_independent_flow():
    def explode_on_two(value):
        if value == 2:
            raise ValueError("bad item")
        return value * 10

    assert autocursor.pipeline([1, 2, 3], explode_on_two, lambda value: value + 1) == [11, None, 31]


def test_loop_until_dry_deduplicates_by_stable_key_and_stops_after_dry_rounds():
    rounds = iter([
        [{"id": "A", "value": 1}],
        [{"id": "A", "value": 1}, {"id": "B", "value": 2}],
        [],
        [],
    ])
    calls = 0

    def round_fn():
        nonlocal calls
        calls += 1
        return next(rounds)

    result = autocursor.loop_until_dry(round_fn, dry_rounds=2, max_rounds=10)

    assert result == [{"id": "A", "value": 1}, {"id": "B", "value": 2}]
    assert calls == 4


def test_loop_until_dry_honors_max_rounds_with_perpetual_new_items():
    calls = 0

    def round_fn():
        nonlocal calls
        calls += 1
        return [{"id": f"item-{calls}"}]

    result = autocursor.loop_until_dry(round_fn, dry_rounds=2, max_rounds=3)

    assert [item["id"] for item in result] == ["item-1", "item-2", "item-3"]
    assert calls == 3


def test_agent_returns_nonzero_exit_and_still_reports_usage(tmp_path, monkeypatch):
    install_fake_cursor(
        tmp_path,
        r'''
import json
import sys

print(json.dumps({"type": "assistant", "text": "partial"}), flush=True)
print(json.dumps({"usage": {"inputTokens": 5, "outputTokens": 8}}), flush=True)
print("fatal detail", file=sys.stderr, flush=True)
raise SystemExit(7)
''',
        monkeypatch,
    )

    result = autocursor.agent("will fail", label="fail-run", timeout=5)

    assert result["exit_code"] == 7
    assert result["usage"]["totalTokens"] == 13
    assert result["error"] == "fatal detail"
    assert "partial" in result["text"]


def test_agent_treats_malformed_usage_counters_as_zero(tmp_path, monkeypatch):
    install_fake_cursor(
        tmp_path,
        r'''
import json

print(json.dumps({"type": "assistant", "text": "ok"}), flush=True)
print(json.dumps({"usage": {"inputTokens": "not-a-number", "outputTokens": True}}), flush=True)
''',
        monkeypatch,
    )

    result = autocursor.agent("bad usage", label="usage-run", timeout=5)

    assert result["usage"] == {"inputTokens": 0, "outputTokens": 0, "totalTokens": 0}


def test_agent_schema_validation_rejects_invalid_array_items(tmp_path, monkeypatch):
    attempts = tmp_path / "attempts.txt"
    monkeypatch.setenv("AUTOCURSOR_FAKE_ATTEMPTS", str(attempts))
    install_fake_cursor(
        tmp_path,
        r'''
import json
import os

attempts = os.environ["AUTOCURSOR_FAKE_ATTEMPTS"]
try:
    n = int(open(attempts).read()) + 1
except FileNotFoundError:
    n = 1
open(attempts, "w").write(str(n))
if n == 1:
    print(json.dumps({"type": "assistant", "text": "{\"file\":\"a\",\"findings\":[\"bad\"]}"}), flush=True)
else:
    print(json.dumps({"type": "assistant", "text": "{\"file\":\"a\",\"findings\":[{\"id\":\"F1\"}]}"}), flush=True)
''',
        monkeypatch,
    )

    result = autocursor.agent(
        "array schema",
        label="array-run",
        timeout=5,
        schema={
            "type": "object",
            "required": ["file", "findings"],
            "properties": {
                "file": {"type": "string"},
                "findings": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["id"],
                        "properties": {"id": {"type": "string"}},
                    },
                },
            },
        },
    )

    assert attempts.read_text() == "2"
    assert result["data"] == {"file": "a", "findings": [{"id": "F1"}]}


def test_agent_timeout_returns_timeout_result_with_log_file(tmp_path, monkeypatch):
    install_fake_cursor(
        tmp_path,
        r'''
import json
import time

print(json.dumps({"type": "assistant", "text": "before sleep"}), flush=True)
time.sleep(5)
''',
        monkeypatch,
    )

    result = autocursor.agent("will time out", label="timeout-run", timeout=1)

    assert result["exit_code"] is None
    assert result["status"] == "timeout"
    assert result["error"] == "timeout 1s"
    assert "before sleep" in Path(result["log_path"]).read_text()


def test_agent_timeout_kills_child_process_group_without_waiting_for_grandchild(tmp_path, monkeypatch):
    install_fake_cursor(
        tmp_path,
        r'''
import json
import subprocess
import sys
import time

subprocess.Popen([sys.executable, "-c", "import time; time.sleep(5)"])
print(json.dumps({"type": "assistant", "text": "before child sleep"}), flush=True)
time.sleep(5)
''',
        monkeypatch,
    )

    started = time.monotonic()
    result = autocursor.agent("child timeout", label="child-timeout", timeout=1)
    elapsed = time.monotonic() - started

    assert result["status"] == "timeout"
    assert elapsed < 3


def test_example_gather_counts_structured_non_success_results_as_failed():
    example = load_example_gather()
    results = [
        None,
        {"status": "ok", "exit_code": 0, "data": {"file": "a", "findings": []}},
        {"status": "timeout", "exit_code": None, "data": None},
        {"status": "ok", "exit_code": 7, "data": {"file": "b", "findings": []}},
        {"status": "ok", "exit_code": 0},
    ]

    assert sum(1 for result in results if example.result_failed(result)) == 4
