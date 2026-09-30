"""Real-process identity regressions; shims never change the host clock."""

import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from types import SimpleNamespace

import pytest


@pytest.fixture
def workflow():
    entry = Path(__file__).resolve().parents[1] / "scripts" / "codex_workflows.py"
    spec = importlib.util.spec_from_file_location("identity_workflow", entry)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def live_pid():
    process = subprocess.Popen(["/bin/sleep", "30"])
    try:
        yield process.pid
    finally:
        process.terminate()
        process.wait(timeout=5)


def ps_shim(tmp_path, monkeypatch, mode):
    real_ps = shutil.which("ps")
    shim = tmp_path / "ps"
    counter = tmp_path / "samples"
    shim.write_text(f"""#!{sys.executable}
import os, pathlib, subprocess, sys
args = sys.argv[1:]
result = subprocess.run([{real_ps!r}] + args, capture_output=True, text=True)
output = result.stdout
if 'lstart=' in args and result.returncode == 0:
    counter = pathlib.Path({str(counter)!r})
    n = int(counter.read_text()) + 1 if counter.exists() else 1
    counter.write_text(str(n))
    if {mode!r} == 'step' and n > 1:
        output = output.strip() + ' (stepped)\\n'
    if {mode!r} == 'env':
        output = os.environ.get('TZ', '') + '/' + os.environ.get('LC_ALL', '') + '\\n'
sys.stdout.write(output)
sys.exit(result.returncode)
""")
    shim.chmod(0o755)
    monkeypatch.setenv("PATH", str(tmp_path) + os.pathsep + os.environ["PATH"])
    return counter


def linux_proc(workflow, tmp_path, monkeypatch, pid):
    """On Darwin, exercise Linux parsing with a kernel-shaped proc fixture."""
    if sys.platform.startswith("linux"):
        return
    stat = tmp_path / "proc-stat"
    stat.write_text(f"{pid} (worker (child) name) S " + "0 " * 18 + "123456 0 0\n")
    original_path = workflow._process.Path
    monkeypatch.setattr(workflow._process, "sys", SimpleNamespace(platform="linux"), raising=False)
    monkeypatch.setattr(workflow._process, "Path", lambda value: stat if str(value) == f"/proc/{pid}/stat" else original_path(value))


def test_linux_stepped_lstart_keeps_live_worker(workflow, live_pid, tmp_path, monkeypatch):
    counter = ps_shim(tmp_path, monkeypatch, "step")
    linux_proc(workflow, tmp_path, monkeypatch, live_pid)
    identity = workflow.capture_process_identity(live_pid)
    assert workflow.process_identity_alive(identity)
    # This is a start-ticks receipt, not an accidentally matching lstart sample.
    assert identity["start_kind"] == "linux-start-ticks-v1"
    assert not counter.exists()


def test_darwin_capture_and_check_pin_timezone_and_locale(workflow, live_pid, tmp_path, monkeypatch):
    ps_shim(tmp_path, monkeypatch, "env")
    monkeypatch.setattr(workflow._process, "sys", SimpleNamespace(platform="darwin"), raising=False)
    monkeypatch.setenv("TZ", "Asia/Jerusalem")
    monkeypatch.setenv("LC_ALL", "he_IL.UTF-8")
    identity = workflow.capture_process_identity(live_pid)
    monkeypatch.setenv("TZ", "UTC")
    monkeypatch.setenv("LC_ALL", "C")
    assert workflow.process_identity_alive(identity)
    assert identity["start_time"] == "UTC/C"


def test_linux_comm_with_spaces_and_parentheses(workflow, tmp_path, monkeypatch):
    stat = tmp_path / "stat"
    stat.write_text("123 (a (nested) worker) S " + "0 " * 18 + "987654 0\n")
    monkeypatch.setattr(workflow._process, "Path", lambda _: stat)
    assert workflow._process._linux_start_ticks(123) == "987654"


def test_unreadable_linux_identity_is_uncertain_not_dead(workflow, live_pid, tmp_path, monkeypatch):
    identity = workflow.capture_process_identity(live_pid)
    stat = tmp_path / "malformed-stat"
    stat.write_text("not a kernel stat record")
    original_path = workflow._process.Path
    monkeypatch.setattr(workflow._process, "sys", SimpleNamespace(platform="linux"))
    monkeypatch.setattr(workflow._process, "Path", lambda value: stat if str(value) == f"/proc/{live_pid}/stat" else original_path(value))
    with pytest.raises(workflow.CodexWorkflowError, match="cannot read process identity.*reconcile"):
        workflow.process_identity_alive(identity)


def test_reused_pid_and_changed_command_are_dead(workflow, live_pid):
    identity = workflow.capture_process_identity(live_pid)
    assert not workflow.process_identity_alive(dict(identity, start_time="different"))
    assert not workflow.process_identity_alive(dict(identity, command="different"))


def test_sweep_does_not_finalize_live_worker_after_lstart_step(workflow, live_pid, tmp_path, monkeypatch):
    ps_shim(tmp_path, monkeypatch, "step")
    linux_proc(workflow, tmp_path, monkeypatch, live_pid)
    manifest = tmp_path / "manifest.json"
    workflow.create_manifest(manifest, "fixture", str(tmp_path), "lead")
    workflow.update_worker(manifest, "worker", {"status": "running", "process": workflow.capture_process_identity(live_pid)})
    monkeypatch.setattr(workflow._runs, "finalize_worker", lambda *_: pytest.fail("live worker finalized"))
    assert workflow.watch_manifest(manifest, timeout=0) == 124
    assert workflow.load_manifest(manifest)["workers"]["worker"]["status"] == "watch_timeout"
    assert workflow.verify_launch(pid=live_pid, log_path=tmp_path / "log", initial_size=0, timeout=0)["state"] == "running"


def legacy_identity(workflow, pid):
    identity = workflow.capture_process_identity(pid)
    identity.pop("start_kind", None)
    identity["start_time"] = workflow._ps_value(pid, "lstart")
    return identity


def test_legacy_matching_identity_live_and_exited_identity_dead(workflow, live_pid):
    identity = legacy_identity(workflow, live_pid)
    assert workflow.process_identity_alive(identity)
    assert not workflow.process_identity_alive(dict(identity, command="other process"))
    child = subprocess.Popen(["/bin/sleep", "30"])
    exited = legacy_identity(workflow, child.pid)
    child.terminate()
    child.wait(timeout=5)
    assert not workflow.process_identity_alive(exited)


@pytest.mark.parametrize("consumer", ["predicate", "sweep", "cleanup", "harvest", "launch"])
def test_legacy_ambiguous_start_refuses_finalization(workflow, live_pid, tmp_path, consumer):
    identity = dict(legacy_identity(workflow, live_pid), start_time="old timezone or reused PID")
    manifest = tmp_path / "manifest.json"
    workflow.create_manifest(manifest, "fixture", str(tmp_path), "lead")
    workflow.update_worker(manifest, "worker", {"status": "running", "process": identity, "harvested_at": "fixture"})
    before = json.loads(manifest.read_text())
    calls = {
        "predicate": lambda: workflow.process_identity_alive(identity),
        "sweep": lambda: workflow.watch_manifest(manifest, timeout=0),
        "cleanup": lambda: workflow.cleanup_worker(manifest, "worker"),
        "harvest": lambda: workflow.harvest_manifest(manifest, tmp_path / "harvest"),
        "launch": lambda: workflow.verify_launch(pid=live_pid, log_path=tmp_path / "log", initial_size=0, timeout=0, identity=identity),
    }
    with pytest.raises(workflow.CodexWorkflowError, match="legacy.*identity.*reconcile"):
        calls[consumer]()
    assert json.loads(manifest.read_text()) == before


@pytest.mark.parametrize("phase", ["verify", "capture"])
def test_launch_retains_uncertain_pid_and_blocks_sweep(workflow, live_pid, tmp_path, monkeypatch, phase):
    manifest = tmp_path / "manifest.json"
    workflow.create_manifest(manifest, "fixture", str(tmp_path), "lead")
    monkeypatch.setattr(workflow, "preflight_launch_inputs", lambda **_: None)
    def create(**kwargs):
        Path(kwargs["worktree"]).mkdir(parents=True)
        return "master"
    monkeypatch.setattr(workflow, "create_worker_worktree", create)
    monkeypatch.setattr(workflow, "build_launch_argv", lambda **_: (["fixture"], "fixture"))
    monkeypatch.setattr(workflow._workers.subprocess, "Popen", lambda *_, **__: SimpleNamespace(pid=live_pid))
    def uncertain(*_, **__):
        raise workflow.CodexWorkflowError("cannot read process identity; reconcile the manifest")
    monkeypatch.setattr(workflow._workers, "verify_launch", uncertain if phase == "verify" else lambda **_: {"ok": True})
    monkeypatch.setattr(workflow._workers, "capture_process_identity", uncertain)
    result = workflow.launch_worker(manifest_path=manifest, repo=tmp_path, run_root=tmp_path, worker_name="worker", brief=tmp_path / "brief", lead="lead", model="fixture", effort="high", report_dirs=[], artifacts=[])
    assert not result["ok"]
    worker = workflow.load_manifest(manifest)["workers"]["worker"]
    assert worker["status"] == "running" and worker["pid"] == live_pid and worker["launched_at"]
    assert worker["process"] == {"pid": live_pid, "start_kind": "unobserved"}
    # Restore Popen for the real ps subprocesses used by the shared guard.
    monkeypatch.undo()
    with pytest.raises(workflow.CodexWorkflowError, match="unobserved.*reconcile"):
        workflow.watch_manifest(manifest, timeout=0)
