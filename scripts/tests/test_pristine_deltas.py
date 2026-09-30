import copy
import importlib.util
import json
from pathlib import Path
import subprocess
from unittest.mock import patch

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("pristine", ROOT / "scripts/ci/pristine-harness.py")
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)


def capture(text):
    return {"exit": 0, "stdout": harness.b64(text.encode()), "stderr": "", "files": {}}


def delta(result, **hashes):
    return {"case": "example", "reason": "intentional default change", "authority": "PR #1; lead ruling",
            "candidate_sha256": hashes or {"darwin": harness.capture_digest(result)}}


def check(base, actual, declarations):
    return harness.compare_captures({"example": base}, {"example": actual}, declarations, "darwin")


def test_undeclared_difference_fails():
    failures, used = check(capture("base"), capture("candidate"), [])
    assert used == 0 and "undeclared" in failures[0]


def test_exact_declaration_passes():
    actual = capture("candidate")
    assert check(capture("base"), actual, [delta(actual)]) == ([], 1)


def test_wrong_hash_fails_and_reports_observed_hash():
    actual = capture("candidate")
    failures, used = check(capture("base"), actual, [delta(actual, darwin="0" * 64)])
    assert used == 0 and harness.capture_digest(actual) in failures[0]


def test_stale_delta_fails_even_if_its_hash_matches():
    actual = capture("base")
    failures, used = check(actual, actual, [delta(actual)])
    assert used == 0 and "stale delta" in failures[0]


def test_missing_platform_fails_and_prints_hash():
    actual = capture("candidate")
    failures, used = check(capture("base"), actual, [delta(actual, linux="0" * 64)])
    assert used == 0 and "missing darwin" in failures[0]
    assert harness.capture_digest(actual) in failures[0]


def test_missing_platform_still_prints_hash_when_delta_is_stale():
    actual = capture("base")
    failures, used = check(actual, actual, [delta(actual, linux="0" * 64)])
    assert used == 0 and "stale delta" in failures[0]
    assert harness.capture_digest(actual) in failures[0]


@pytest.mark.parametrize("field", ["exit", "stdout", "stderr", "files"])
def test_mutant_changing_only_a_declared_case_is_caught(field):
    approved = capture("candidate")
    mutant = copy.deepcopy(approved)
    mutant[field] = {"artifact": "AA=="} if field == "files" else 1 if field == "exit" else "AA=="
    failures, used = check(capture("base"), mutant, [delta(approved)])
    assert used == 0 and "hash mismatch" in failures[0]


def test_declaration_schema_rejects_unknown_and_duplicate_cases(tmp_path):
    path = tmp_path / "deltas.json"
    row = delta(capture("candidate"))
    path.write_text(json.dumps([row, row]))
    with pytest.raises(ValueError, match="duplicate"):
        harness.load_deltas(path, ["example"])
    path.write_text(json.dumps([row]))
    with pytest.raises(ValueError, match="unknown"):
        harness.load_deltas(path, ["other"])


def test_record_updates_only_current_platform_and_keeps_other_hash(tmp_path):
    path = tmp_path / "deltas.json"
    actual = capture("candidate")
    path.write_text(json.dumps([delta(actual, linux="a" * 64)]))
    harness.record_delta(path, ["example"], "example", "reason", "authority", actual, "darwin")
    row = json.loads(path.read_text())[0]
    assert row["candidate_sha256"] == {"linux": "a" * 64, "darwin": harness.capture_digest(actual)}
    assert row["reason"] == "reason" and row["authority"] == "authority"


def test_base_and_candidate_execute_in_distinct_real_children(tmp_path):
    base = tmp_path / "base"
    harness.make_base(base)
    case = {"id": "parser-test", "target": "parser", "input": "echo ready"}
    with patch.object(harness.subprocess, "run", wraps=subprocess.run) as run:
        baseline = harness.capture(case, base, tmp_path)
        actual = harness.capture(case, ROOT, tmp_path)
    calls = run.call_args_list
    assert len(calls) == 2
    assert calls[0].args[0][-1] == str(base)
    assert calls[1].args[0][-1] == str(ROOT)
    assert baseline == actual and baseline["exit"] == 0


def test_record_cli_requires_case_reason_and_authority():
    proc = subprocess.run(["python3", str(ROOT / "scripts/ci/pristine-harness.py"), "record-delta"], capture_output=True)
    assert proc.returncode != 0
    assert b"--case" in proc.stderr and b"--reason" in proc.stderr and b"--authority" in proc.stderr
