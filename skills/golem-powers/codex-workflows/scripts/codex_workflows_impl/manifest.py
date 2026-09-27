"""Manifest operations for headless Codex workflows."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable
import fcntl
import json
import os
import tempfile

from .config import CodexWorkflowError, DEGRADED_MODE


def atomic_write_json(path: Path | str, value: dict[str, Any]) -> None:
    """Atomically replace a JSON document with a durable same-directory write."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{target.name}.", dir=target.parent)
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, target)
    finally:
        if temp_path.exists():
            temp_path.unlink()


def locked_manifest_update(
    path: Path | str,
    mutator: Callable[[dict[str, Any]], None],
    *,
    initial: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Reload and mutate a manifest while holding its advisory lock."""
    manifest_path = Path(path)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = manifest_path.with_name(f"{manifest_path.name}.lock")
    with lock_path.open("a+", encoding="utf-8") as lock_handle:
        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX)
        try:
            if manifest_path.exists():
                data = json.loads(manifest_path.read_text(encoding="utf-8"))
            elif initial is not None:
                data = initial
            else:
                raise CodexWorkflowError(f"manifest does not exist: {manifest_path}")
            mutator(data)
            atomic_write_json(manifest_path, data)
            return data
        finally:
            fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)


def create_manifest(
    path: Path | str,
    run_id: str,
    repo: str,
    lead: str,
) -> dict[str, Any]:
    """Create a run manifest, refusing to replace an existing one."""
    manifest_path = Path(path)
    initial = {
        "version": 1,
        "run_id": run_id,
        "repo": str(repo),
        "lead": lead,
        "degraded_mode": list(DEGRADED_MODE),
        "workers": {},
    }

    def initialize(data: dict[str, Any]) -> None:
        if data != initial:
            raise CodexWorkflowError(f"manifest already exists: {manifest_path}")

    return locked_manifest_update(manifest_path, initialize, initial=initial)


def update_worker(
    path: Path | str,
    worker_name: str,
    updates: dict[str, Any],
) -> dict[str, Any]:
    """Merge fields into one worker record under the manifest lock."""

    def mutate(data: dict[str, Any]) -> None:
        workers = data.setdefault("workers", {})
        record = workers.setdefault(worker_name, {"name": worker_name})
        record.update(updates)

    return locked_manifest_update(path, mutate)


def update_manifest(path: Path | str, updates: dict[str, Any]) -> dict[str, Any]:
    def mutate(data: dict[str, Any]) -> None:
        data.update(updates)

    return locked_manifest_update(path, mutate)


def load_manifest(path: Path | str) -> dict[str, Any]:
    manifest_path = Path(path)
    if not manifest_path.is_file():
        raise CodexWorkflowError(f"manifest does not exist: {manifest_path}")
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CodexWorkflowError(f"cannot read manifest {manifest_path}: {exc}") from exc
    if not isinstance(data, dict) or not isinstance(data.get("workers"), dict):
        raise CodexWorkflowError(f"invalid manifest structure: {manifest_path}")
    return data


def ensure_manifest(
    path: Path | str,
    *,
    run_id: str,
    repo: Path | str,
    lead: str,
) -> dict[str, Any]:
    manifest_path = Path(path)
    resolved_repo = str(Path(repo).resolve())
    if not manifest_path.exists():
        return create_manifest(manifest_path, run_id, resolved_repo, lead)
    data = load_manifest(manifest_path)
    expected = {"run_id": run_id, "repo": resolved_repo, "lead": lead}
    mismatches = {
        key: (data.get(key), value)
        for key, value in expected.items()
        if data.get(key) != value
    }
    if mismatches:
        raise CodexWorkflowError(f"manifest identity mismatch: {mismatches}")
    return data
