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

@pytest.mark.parametrize("raw", [
    '[{"case":"other","case":"example","reason":"r","authority":"a","candidate_sha256":{"darwin":"' + 'a' * 64 + '"}}]',
    '[{"case":"example","reason":"r","authority":"a","candidate_sha256":{"darwin":"' + 'b' * 64 + '","darwin":"' + 'a' * 64 + '"}}]',
])
def test_duplicate_json_keys_are_rejected(tmp_path, raw):
    path = tmp_path / "deltas.json"
    path.write_text(raw)
    with pytest.raises(ValueError, match="duplicate JSON key"):
        harness.load_deltas(path, ["example", "other"])


@pytest.mark.parametrize("change", ["extra", "missing-reason", "missing-authority"])
def test_schema_requires_exact_keys(tmp_path, change):
    row = delta(capture("candidate"))
    if change == "extra":
        row["extra"] = "ignored"
    else:
        del row[change.removeprefix("missing-")]
    path = tmp_path / "deltas.json"
    path.write_text(json.dumps([row]))
    with pytest.raises(ValueError, match="delta requires"):
        harness.load_deltas(path, ["example"])


@pytest.mark.parametrize("key", ["reason", "authority"])
@pytest.mark.parametrize("value", ["", " \n\t", None, 7])
def test_schema_rejects_invalid_metadata(tmp_path, key, value):
    row = delta(capture("candidate"))
    row[key] = value
    path = tmp_path / "deltas.json"
    path.write_text(json.dumps([row]))
    with pytest.raises(ValueError, match="nonempty strings"):
        harness.load_deltas(path, ["example"])


@pytest.mark.parametrize("hashes", [
    {"windows": "a" * 64}, {"*": "a" * 64}, {"darwin": "A" * 64},
    {"linux": "a" * 63}, {"darwin": "a" * 64 + "\n"}, {"darwin": None}, [],
])
def test_schema_rejects_invalid_platform_hashes(tmp_path, hashes):
    row = delta(capture("candidate"))
    row["candidate_sha256"] = hashes
    path = tmp_path / "deltas.json"
    path.write_text(json.dumps([row]))
    with pytest.raises(ValueError, match="invalid platform hashes"):
        harness.load_deltas(path, ["example"])


@pytest.mark.parametrize("rows", [{}, {"example": {}}, "", None, 1])
def test_schema_rejects_non_list_top_level(tmp_path, rows):
    path = tmp_path / "deltas.json"
    path.write_text(json.dumps(rows))
    with pytest.raises(ValueError, match="deltas must be a list"):
        harness.load_deltas(path, ["example"])


@pytest.mark.parametrize("options", [[], ["--reason", "r"], ["--authority", "a"]])
def test_record_cli_rejects_case_without_both_metadata_options(options):
    proc = subprocess.run(["python3", str(ROOT / "scripts/ci/pristine-harness.py"),
                           "record-delta", "--case", "unknown", *options], capture_output=True)
    assert proc.returncode == 2
    assert b"record-delta requires --case, --reason and --authority" in proc.stderr


def test_record_cli_stale_case_refuses_to_write(tmp_path):
    from argparse import ArgumentParser, Namespace
    path = tmp_path / harness.DELTA_PATH
    path.parent.mkdir(parents=True)
    path.write_text("[]\n")
    args = Namespace(action="record-delta", case="example", reason="r", authority="a", candidate_root=tmp_path)
    with patch.object(harness, "make_base"), patch.object(harness, "execute", return_value={"example": capture("base")}):
        with pytest.raises(SystemExit) as error:
            harness.run_locked(args, ArgumentParser(), [{"id": "example", "target": "parser"}], tmp_path)
    assert error.value.code == 2
    assert path.read_text() == "[]\n"


def test_used_delta_prints_case_reason_and_authority(capsys):
    actual = capture("candidate")
    row = delta(actual)
    assert check(capture("base"), actual, [row]) == ([], 1)
    output = capsys.readouterr().out
    assert "PRISTINE DELTA USED" in output
    assert all(json.dumps(row[key]) in output for key in ("case", "reason", "authority"))


@pytest.mark.parametrize("base_exit", [1, 2, 127])
def test_hook_deny_to_allow_requires_and_prints_lead_ruling(base_exit, capsys):
    base, actual = capture("base"), capture("candidate")
    base["exit"] = base_exit
    row = delta(actual)
    failures, used = harness.compare_captures({"example": base}, {"example": actual}, [row], "darwin", hook_cases={"example"})
    assert used == 0 and "deny→allow" in failures[0]
    assert "PRISTINE DELTA DENY→ALLOW" in capsys.readouterr().out
    row["allow_deny_to_allow"] = "lead ruling PR #1"
    assert harness.compare_captures({"example": base}, {"example": actual}, [row], "darwin", hook_cases={"example"}) == ([], 1)
    assert row["allow_deny_to_allow"] in capsys.readouterr().out
    # Non-hook exits and hook deny→deny changes do not need this exception.
    assert check(base, actual, [delta(actual)]) == ([], 1)
    actual["exit"] = 1
    assert harness.compare_captures({"example": base}, {"example": actual}, [delta(actual)], "darwin", hook_cases={"example"}) == ([], 1)


@pytest.mark.parametrize("ruling", ["", " \t", None, 1])
def test_schema_rejects_empty_or_non_string_deny_to_allow_ruling(tmp_path, ruling):
    row = delta(capture("candidate"))
    row["allow_deny_to_allow"] = ruling
    path = tmp_path / "deltas.json"
    path.write_text(json.dumps([row]))
    with pytest.raises(ValueError, match="lead ruling"):
        harness.load_deltas(path, ["example"])


def test_schema_accepts_explicit_deny_to_allow_ruling(tmp_path):
    row = delta(capture("candidate"))
    row["allow_deny_to_allow"] = "lead ruling PR #1"
    path = tmp_path / "deltas.json"
    path.write_text(json.dumps([row]))
    assert harness.load_deltas(path, ["example"]) == [row]


@pytest.mark.parametrize("target", ["tmp-block", "git-guardian"])
def test_check_wires_hook_targets_into_deny_to_allow_gate(tmp_path, target, capsys):
    from argparse import ArgumentParser, Namespace
    base, actual = capture("base"), capture("candidate")
    base["exit"] = 2
    goldens = tmp_path / "goldens.json"
    goldens.write_text(json.dumps({"base": harness.BASE, "results": {"example": base}}))
    path = tmp_path / harness.DELTA_PATH
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps([delta(actual, **{harness.sys.platform: harness.capture_digest(actual)})]))
    args = Namespace(action="check", candidate_root=tmp_path)
    with patch.object(harness, "GOLDENS", goldens), patch.object(harness, "make_base"), \
         patch.object(harness, "validate_baseline"), \
         patch.object(harness, "execute", side_effect=[{"example": base}, {"example": actual}]):
        assert harness.run_locked(args, ArgumentParser(), [{"id": "example", "target": target}], tmp_path) == 1
    output = capsys.readouterr()
    assert "PRISTINE DECLARED DELTAS USED 0" in output.out
    assert "deny→allow requires" in output.err


def test_deny_to_allow_ruling_does_not_bypass_exact_hash():
    base, actual = capture("base"), capture("candidate")
    base["exit"] = 2
    row = delta(actual, darwin="0" * 64)
    row["allow_deny_to_allow"] = "lead ruling PR #1"
    failures, used = harness.compare_captures({"example": base}, {"example": actual}, [row], "darwin", hook_cases={"example"})
    assert used == 0 and "hash mismatch" in failures[0]
