"""Force timeout/exit and final-turn boundaries against production run state."""
import importlib.util
import json
from pathlib import Path
import subprocess

import pytest


@pytest.fixture
def workflow():
    entry = Path(__file__).resolve().parents[1] / "scripts/codex_workflows.py"
    spec = importlib.util.spec_from_file_location("run_state_workflow", entry)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def message(text):
    return {"type": "item.completed", "item": {"id": "a", "type": "agent_message", "text": text}}


@pytest.mark.parametrize("phase", ["preparing", "running"])
def test_timeout_preserves_phase_then_exit_is_reconciled(workflow, tmp_path, phase):
    manifest = tmp_path / "manifest.json"
    log = tmp_path / "worker.log"
    workflow.create_manifest(manifest, "run", str(tmp_path), "lead")
    child = subprocess.Popen(["/bin/sleep", "30"])
    try:
        identity = workflow.capture_process_identity(child.pid)
        workflow.update_worker(manifest, "worker", {
            "status": phase, "log": str(log),
            "process" if phase == "running" else "preparation_process": identity,
        })
        assert workflow.watch_manifest(manifest, timeout=0) == 124
        worker = workflow.load_manifest(manifest)["workers"]["worker"]
        assert worker["status"] == phase
        assert worker["watch_timeout_at"]
        if phase == "preparing":
            workflow.update_worker(manifest, "worker", {"status": "running", "process": identity})
        log.write_text(json.dumps(message("TASK_DONE")) + '\n{"type":"turn.completed"}\n')
        child.terminate()
        child.wait(timeout=5)
        assert workflow.watch_manifest(manifest, timeout=0) == 0
        assert workflow.load_manifest(manifest)["workers"]["worker"]["status"] == "completed"
    finally:
        if child.poll() is None:
            child.terminate()
        child.wait(timeout=5)


@pytest.mark.parametrize("legacy", [False, True])
def test_missing_or_dead_preparation_owner_requires_reconciliation(workflow, tmp_path, legacy):
    manifest = tmp_path / "manifest.json"
    workflow.create_manifest(manifest, "run", str(tmp_path), "lead")
    child = subprocess.Popen(["/bin/sleep", "30"])
    try:
        identity = workflow.capture_process_identity(child.pid)
    finally:
        child.terminate()
        child.wait(timeout=5)
    record = {"status": "preparing"}
    if not legacy:
        record["preparation_process"] = identity
    workflow.update_worker(manifest, "worker", record)
    with pytest.raises(workflow.CodexWorkflowError, match="preparation.*reconcile"):
        workflow.watch_manifest(manifest, timeout=0)
    assert workflow.load_manifest(manifest)["workers"]["worker"]["status"] == "preparing"


@pytest.mark.parametrize("later", [
    [{"type": "turn.started"}],
    [{"type": "thread.started", "thread_id": "later"}],
    [{"type": "turn.started"}, message("still working")],
    [{"type": "turn.started"}, message("still working"), {"type": "turn.completed"}],
    [{"type": "turn.started"}, message("TASK_DONE")],
    [message("still working")],
])
def test_old_done_cannot_complete_later_turn(workflow, tmp_path, later):
    log = tmp_path / "worker.log"
    events = [message("TASK_DONE"), {"type": "turn.completed"}] + later
    log.write_text("\n".join(map(json.dumps, events)) + "\n")
    manifest = tmp_path / "manifest.json"
    workflow.create_manifest(manifest, "run", str(tmp_path), "lead")
    workflow.update_worker(manifest, "worker", {"status": "running", "log": str(log), "process": None})
    assert workflow.watch_manifest(manifest, timeout=0) == 1
    assert workflow.load_manifest(manifest)["workers"]["worker"]["status"] == "incomplete"


@pytest.mark.parametrize("events,expected", [
    ([message("TASK_DONE")], False),
    ([message("TASK_DONE"), message("more work"), {"type": "turn.completed"}], False),
    ([message("TASK_DONE\nmore work"), {"type": "turn.completed"}], False),
    ([message("done\nTASK_DONE"), {"type": "turn.completed"}], True),
    ([message("TASK_DONE"), {"type": "turn.completed"}, {"type": "turn.started"},
      message("done\nTASK_DONE"), {"type": "turn.completed"}], True),
])
def test_final_turn_requires_completion_and_terminal_marker(workflow, tmp_path, events, expected):
    log = tmp_path / "worker.log"
    log.write_text("\n".join(map(json.dumps, events)) + "\n")
    assert workflow.parse_finished_log(log)["task_done"] is expected
