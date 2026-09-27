"""Goldens captured from unchanged cfe1ab39 before extraction."""

import importlib.util
import json
from pathlib import Path
import subprocess
import sys
from unittest import mock

import pytest

SCRIPTS = Path(__file__).resolve().parents[1]
GOLDEN = Path(__file__).parent / "fixtures" / "split-contract.json"


def load_runner(path=SCRIPTS / "convention_audit.py"):
    spec = importlib.util.spec_from_file_location("split_audit", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def outcome(call):
    try:
        return {"value": call()}
    except (RuntimeError, subprocess.TimeoutExpired) as exc:
        return {"error": type(exc).__name__, "message": str(exc)}


def snapshot(root):
    audit = load_runner()
    expected = SCRIPTS.parent / "evals" / "expected"
    known = json.loads((expected / "known-answer.json").read_text())
    control = json.loads((expected / "shared-helper-control.json").read_text())
    result = {"known": audit.validate_payload(known), "control": audit.validate_payload(control)}
    result["aggregate"] = audit.aggregate_worker_payloads([known, control, known], repo="fixture", revision="fixed-revision")
    for index, payload in enumerate((None, {}, {"worker": "a"}, {"worker": "a", "findings": [{}]})):
        result[f"invalid:{index}"] = outcome(lambda: audit.validate_payload(payload))
    orphan = json.loads(json.dumps(known))
    orphan["findings"][0]["divergent_sites"][0]["line"] = 99999
    result["orphan_strict"] = outcome(lambda: audit.validate_payload(orphan))
    result["orphan_raw"] = audit.validate_payload(orphan, require_divergent_subset=False)
    repo = root / "repo"
    repo.mkdir()
    (repo / "a.py").write_text("created_at > datetime('now', '-1 day')\n")
    (repo / "b.py").write_text("datetime(created_at) >= datetime('now', '-1 day')\n")
    (repo / "tests").mkdir()
    (repo / "tests" / "ignored.py").write_text("created_at > datetime('now')\n")
    result["detector"] = audit.detect_sqlite_recent_window_candidates(repo)
    result["commands"] = [audit.build_codex_command(codex_binary="codex", repo=Path("/repo"), output_schema=Path("/schema"), effort=effort) for effort in ("max", "xhigh")]
    for banner in ("", "model: other\nreasoning effort: max", "model: gpt-5.6-luna\nreasoning effort: xhigh", "model: gpt-5.6-luna\nreasoning effort: max"):
        result["pin:" + banner] = outcome(lambda: audit.verify_effective_pin(banner, requested_effort="max"))
    evidence = root / "pin.log"
    rejected = subprocess.CompletedProcess([], 1, "", "invalid value 'max' for model_reasoning_effort")
    accepted = subprocess.CompletedProcess([], 0, "model: gpt-5.6-luna\nreasoning effort: xhigh\n", "")
    with mock.patch.object(audit, "_run_process", side_effect=[rejected, accepted]) as process:
        result["fallback"] = audit.preflight_pin("codex", repo, Path("/schema"), timeout=3, evidence_path=evidence)
        result["fallback_efforts"] = [call.args[0][call.args[0].index("-c") + 1] for call in process.call_args_list]
    result["fallback_evidence"] = evidence.read_text()
    with mock.patch.object(audit, "_run_process", return_value=rejected):
        result["no_fallback"] = outcome(lambda: audit.preflight_pin("codex", repo, Path("/schema"), timeout=3, allow_fallback=False))
    events = [{"type": "turn.completed", "usage": {"input_tokens": 7, "output_tokens": 3, "cost_usd": 0.02}}]
    result["usage"] = audit.usage_from_events(events)
    result["unobserved"] = audit.usage_from_events([{"type": "other", "tokens": 7}])
    worker = audit.WorkerResult("worker", known, events, 1.25, "worker.jsonl", "worker.stderr.log")
    with mock.patch.object(audit.time, "monotonic", return_value=12.5):
        run_log = audit._build_run_log(repo="fixture", revision="fixed-revision", pin=result["fallback"], detector_payload=result["detector"], results=[worker], started=10.0, status="complete", stage="complete", target_git_state_unchanged=True, require_usage=True)
    audit._write_run_log(root, run_log)
    result["run_log_bytes"] = (root / "run-log.json").read_text()
    result["report_bytes"] = audit._render_report(result["aggregate"], run_log)
    result["control_report_bytes"] = audit._render_report({"repo": "fixture", "revision": "fixed-revision", "findings": []}, run_log)
    with mock.patch.object(audit, "_run_process", side_effect=subprocess.TimeoutExpired("fixture-command", 3)):
        result["timeout"] = outcome(lambda: audit._run_worker(label="worker", prompt="fixture", repo=repo, schema=Path("/schema"), effort="max", codex_binary="codex", run_dir=root, timeout=3))
    return json.loads(json.dumps(result).replace(str(root), "<ROOT>"))


def test_baseline_golden(tmp_path):
    assert snapshot(tmp_path) == json.loads(GOLDEN.read_text())


def test_comparator_rejects_changed_pin(tmp_path):
    changed = snapshot(tmp_path)
    changed["fallback"]["effort"] = "max"
    assert changed != json.loads(GOLDEN.read_text())


@pytest.mark.parametrize("mutate", [False, True])
def test_real_cli_preserves_target_state_gate(tmp_path, mutate):
    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    fake = tmp_path / "fake-codex"
    source = (GOLDEN.parent / "fake-codex.py").read_text()
    fake.write_text(source.replace("MUTATE = False", f"MUTATE = {mutate}"))
    fake.chmod(0o755)
    completed = subprocess.run([sys.executable, str(SCRIPTS / "convention_audit.py"), "--repo", str(repo), "--output-dir", str(tmp_path / "output"), "--codex-binary", str(fake)], capture_output=True, text=True, timeout=15)
    logs = list((tmp_path / "output").glob("*/run-log.json"))
    assert len(logs) == 1
    log = json.loads(logs[0].read_text())
    assert log["target_git_state_unchanged"] is not mutate
    if mutate:
        assert completed.returncode == 1
        assert completed.stderr == "convention-audit: audit mutated target repository state; refusing report\n"
        assert log["status"] == "failed"
        assert log["failure"]["stage"] == "target-verification"
        assert not list((tmp_path / "output").glob("*/report.json"))
    else:
        assert completed.returncode == 0, completed.stderr
        assert completed.stderr == ""
        assert log["status"] == "complete"
        assert json.loads(completed.stdout)["findings"] == 0


def test_two_copies_and_symlink_resolve_their_own_code(tmp_path):
    import shutil

    copies = [tmp_path / name for name in ("a", "b")]
    for copy in copies:
        shutil.copytree(SCRIPTS, copy, ignore=shutil.ignore_patterns("__pycache__"))
    source = copies[1] / "convention_audit_impl" / "detector.py"
    if not source.exists():  # The same contract also runs against the monolith.
        source = copies[1] / "convention_audit.py"
    source.write_text(source.read_text().replace("static-sqlite-recent-window-detector", "copy-b-detector"))
    link = tmp_path / "symlink.py"
    link.symlink_to(copies[1] / "convention_audit.py")
    original_path = sys.path[:]
    first = load_runner(copies[0] / "convention_audit.py")
    second = load_runner(link)
    assert sys.path == original_path
    empty = tmp_path / "empty"
    empty.mkdir()
    assert first.detect_sqlite_recent_window_candidates(empty)["worker"] == "static-sqlite-recent-window-detector"
    assert second.detect_sqlite_recent_window_candidates(empty)["worker"] == "copy-b-detector"
    if hasattr(second, "_detector"):
        assert Path(second._detector.__file__).resolve() == source
