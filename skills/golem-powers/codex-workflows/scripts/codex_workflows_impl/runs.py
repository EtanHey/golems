"""Runs operations for headless Codex workflows."""

from __future__ import annotations

from pathlib import Path
from typing import Any
import shutil
import time

from .config import CodexWorkflowError, TERMINAL_STATES, utc_now
from .worktrees import resolve_artifacts
from .manifest import load_manifest, update_manifest, update_worker
from .process import process_identity_alive
from .workers import finalize_worker


def watch_manifest(
    manifest_path: Path | str,
    *,
    interval: float = 1.0,
    timeout: float = 3600.0,
) -> int:
    deadline = time.monotonic() + max(timeout, 0.0)
    while True:
        data = load_manifest(manifest_path)
        active: list[str] = []
        for name, worker in data["workers"].items():
            status = worker.get("status")
            if status in TERMINAL_STATES:
                continue
            if status == "preparing":
                active.append(name)
                continue
            identity = worker.get("process")
            if isinstance(identity, dict) and process_identity_alive(identity):
                active.append(name)
                continue
            finalize_worker(manifest_path, name)

        data = load_manifest(manifest_path)
        states = [worker.get("status") for worker in data["workers"].values()]
        if states and all(state in TERMINAL_STATES for state in states):
            return manifest_completion_code(data)
        if time.monotonic() >= deadline:
            for name in active:
                update_worker(
                    manifest_path,
                    name,
                    {"status": "watch_timeout", "watch_timeout_at": utc_now()},
                )
            return 124
        time.sleep(max(0.05, interval))


def manifest_completion_code(manifest: dict[str, Any] | Path | str) -> int:
    """Return zero only when a nonempty manifest is fully completed."""
    data = load_manifest(manifest) if isinstance(manifest, (Path, str)) else manifest
    workers = data.get("workers")
    if not isinstance(workers, dict) or not workers:
        return 1
    return 0 if all(worker.get("status") == "completed" for worker in workers.values()) else 1


def guarded_watch_code(manifest_path: Path | str, reported_code: int) -> int:
    """Preserve nonzero watch results and reject a zero with unfinished workers."""
    code = reported_code if reported_code != 0 else manifest_completion_code(manifest_path)
    update_manifest(
        manifest_path,
        {
            "completion_state": (
                "completed" if code == 0 else "watch_timeout" if code == 124 else "incomplete"
            ),
            "completion_proven": code == 0,
        },
    )
    return code


def harvest_manifest(
    manifest_path: Path | str,
    output_dir: Path | str,
) -> dict[str, Any]:
    destination = Path(output_dir).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    data = load_manifest(manifest_path)
    harvested: dict[str, list[str]] = {}
    for name, worker in data["workers"].items():
        identity = worker.get("process")
        if isinstance(identity, dict) and process_identity_alive(identity):
            raise CodexWorkflowError(f"worker is still running: {name}")
        if worker.get("status") not in TERMINAL_STATES:
            raise CodexWorkflowError(f"worker is not terminal: {name}")
        worker_output = destination / name
        worker_output.mkdir(parents=True, exist_ok=True)
        copied: list[str] = []
        log_path = Path(worker["log"])
        if not log_path.is_file():
            raise CodexWorkflowError(f"worker log missing: {log_path}")
        copied_log = worker_output / log_path.name
        shutil.copy2(log_path, copied_log)
        copied.append(str(copied_log))

        patterns = list(worker.get("artifacts", []))
        artifacts = resolve_artifacts(worker["worktree"], patterns)
        for pattern in patterns:
            if not any(Path(item).match(pattern) for item in artifacts):
                raise CodexWorkflowError(f"declared artifact missing for {name}: {pattern}")
        worktree_root = Path(worker["worktree"]).resolve()
        for artifact in artifacts:
            relative = artifact.relative_to(worktree_root)
            target = worker_output / "artifacts" / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(artifact, target)
            copied.append(str(target))

        update_worker(
            manifest_path,
            name,
            {
                "harvested_at": utc_now(),
                "harvest_output": str(worker_output),
                "harvested_files": copied,
            },
        )
        harvested[name] = copied
    shutil.copy2(manifest_path, destination / "manifest.json")
    return {"output_dir": str(destination), "workers": harvested}
