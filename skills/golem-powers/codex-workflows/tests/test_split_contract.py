"""Characterization captured before the module split (baseline 51459cd3).

Goldens retain stdout/stderr whitespace and JSON serialization. Only the isolated
fixture root is replaced with <ROOT>; no timestamps/PIDs are hidden by the diff.
"""

import importlib.util
import inspect
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

import pytest


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
GOLDEN = Path(__file__).parent / "fixtures" / "split-contract.json"


def load_module(path=SCRIPTS / "codex_workflows.py"):
    # Existing callers do not insert the entry module in sys.modules.
    spec = importlib.util.spec_from_file_location("isolated_workflows", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def capture(module, args):
    stdout, stderr = io.StringIO(), io.StringIO()
    with mock.patch.object(sys, "argv", ["codex_workflows.py"]), redirect_stdout(stdout), redirect_stderr(stderr):
        try:
            code = module.main(args)
        except SystemExit as exc:
            code = exc.code
    return {"stdout": stdout.getvalue(), "stderr": stderr.getvalue(), "code": code}


def snapshot(root):
    module = load_module()
    result = {}
    result["signatures"] = {
        name: str(inspect.signature(getattr(module, name)))
        for name in (
            "validate_worker_name", "validate_artifact_pattern", "resolve_artifacts",
            "discover_default_branch", "git_common_dir", "create_worker_worktree",
            "build_launch_argv", "preflight_launch_inputs", "write_log_header",
            "atomic_write_json", "locked_manifest_update", "create_manifest",
            "update_worker", "update_manifest", "load_manifest", "ensure_manifest",
            "capture_process_identity", "process_identity_alive", "verify_launch",
            "parse_finished_log", "finalize_worker", "launch_worker", "watch_manifest",
            "manifest_completion_code", "guarded_watch_code", "harvest_manifest",
            "cleanup_worker", "validate_composition_spec", "run_parallel_spec",
            "run_pipeline_spec", "build_parser", "main",
        )
    }
    for command in ([], ["unknown"], ["--help"], *[[name, "--help"] for name in (
        "agent", "watch", "status", "harvest", "cleanup", "parallel", "pipeline"
    )]):
        result["cli:" + " ".join(command)] = capture(module, command)
    result["missing_manifest"] = capture(module, ["status", "--manifest", str(root / "absent")])

    manifest = root / "manifest.json"
    module.create_manifest(manifest, "fixture-run", "/fixture/repo", "fixture-lead")
    result["manifest_empty"] = manifest.read_text()
    module.update_worker(manifest, "worker-a", {"status": "running"})
    result["guard_running"] = module.guarded_watch_code(manifest, 0)
    result["manifest_running"] = manifest.read_text()
    module.update_worker(manifest, "worker-a", {"status": "completed"})
    result["guard_completed"] = module.guarded_watch_code(manifest, 0)
    result["manifest_completed"] = manifest.read_text()
    result["status"] = capture(module, ["status", "--manifest", str(manifest)])
    spec_path = root / "spec.json"
    spec_path.write_text("{}")
    with mock.patch.object(module, "run_parallel_spec", return_value=(75, manifest)):
        result["launch_only"] = capture(module, ["parallel", "--spec", str(spec_path), "--run-id", "fixture-run"])

    log = root / "worker.log"
    event = lambda text: {"type": "item.completed", "item": {"id": "a", "type": "agent_message", "text": text}}
    cases = {
        "empty": [],
        "incomplete": [event("TASK_DONE-ish")],
        "success": [event("https://github.com/example/repo/pull/1\nTASK_DONE"), {"type": "turn.completed", "usage": {"output_tokens": 12}}],
        "failed": [event("TASK_DONE"), {"type": "turn.failed", "message": "fixture failure"}],
        "malformed": ['{broken'],
        "tool_prose": [{"type": "item.completed", "item": {"id": "tool", "type": "command_execution", "aggregated_output": "TASK_DONE"}}],
    }
    for name, events in cases.items():
        log.write_text("\n".join(item if isinstance(item, str) else json.dumps(item) for item in events))
        parsed = module.parse_finished_log(log)
        result["log:" + name] = {"parsed": parsed, "status": module._terminal_status(parsed)}
    module.write_log_header(log, {"worker": "a", "model": "fixture", "effort": "xhigh"})
    result["log_header"] = log.read_text()
    module.update_worker(manifest, "worker-a", {
        "log": str(log), "worktree": str(root), "artifacts": ["missing.md"]
    })
    try:
        module.harvest_manifest(manifest, root / "harvest")
    except module.CodexWorkflowError as exc:
        result["missing_artifact"] = str(exc)
    # Serialize once, then replace only the explicitly declared volatile root.
    return json.loads(json.dumps(result).replace(str(root), "<ROOT>"))


def test_baseline_golden_contract(tmp_path):
    assert snapshot(tmp_path) == json.loads(GOLDEN.read_text())


def test_golden_comparison_rejects_a_changed_exit_code(tmp_path):
    changed = snapshot(tmp_path)
    changed["launch_only"]["code"] = 0
    assert changed != json.loads(GOLDEN.read_text())


@pytest.mark.parametrize("via_shell", [False, True])
def test_copied_entry_runs_outside_checkout(tmp_path, via_shell):
    copied = tmp_path / "copied"
    shutil.copytree(SCRIPTS, copied, ignore=shutil.ignore_patterns("__pycache__"))
    executable = copied / ("codex-workflows.sh" if via_shell else "codex_workflows.py")
    argv = [str(executable)] if via_shell else [sys.executable, str(executable)]
    result = subprocess.run(argv + ["--help"], cwd=tmp_path, capture_output=True, text=True, timeout=10)
    assert {"stdout": result.stdout, "stderr": result.stderr, "code": result.returncode} == json.loads(GOLDEN.read_text())["cli:--help"]


def test_facade_worktree_override_reaches_launch(tmp_path):
    module = load_module()
    manifest = tmp_path / "manifest.json"
    module.create_manifest(manifest, "fixture", str(tmp_path), "lead")
    with mock.patch.object(module, "preflight_launch_inputs"), mock.patch.object(
        module, "create_worker_worktree", side_effect=module.CodexWorkflowError("fixture worktree refusal")
    ) as create:
        result = module.launch_worker(
            manifest_path=manifest, repo=tmp_path, run_root=tmp_path,
            worker_name="a", brief=tmp_path / "brief", lead="lead", model="fixture",
            effort="xhigh", report_dirs=[], artifacts=[],
        )
    create.assert_called_once()
    assert result == {"ok": False, "state": "failed_launch", "reason": "fixture worktree refusal", "worker": "a"}


def test_separate_imports_keep_binary_configuration_isolated(tmp_path):
    with mock.patch.dict(os.environ, {"CODEX_BIN": str(tmp_path / "a")}):
        first = load_module()
    with mock.patch.dict(os.environ, {"CODEX_BIN": str(tmp_path / "b")}):
        second = load_module()
    assert first.CODEX_BIN == tmp_path / "a"
    assert second.CODEX_BIN == tmp_path / "b"
    for module, name in ((first, "a"), (second, "b")):
        with pytest.raises(module.CodexWorkflowError, match=f"not executable: {tmp_path / name}"):
            module.preflight_launch_inputs(repo=tmp_path, brief=tmp_path / "brief")
