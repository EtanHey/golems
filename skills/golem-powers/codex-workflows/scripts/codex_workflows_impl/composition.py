"""Composition operations for headless Codex workflows."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable
import math

from .config import (
    CodexWorkflowError,
    LAUNCH_ONLY_EXIT,
    validate_artifact_pattern,
    validate_worker_name,
)
from .manifest import ensure_manifest, update_manifest
from .runs import guarded_watch_code


def _validate_worker_spec(worker: Any) -> dict[str, Any]:
    if not isinstance(worker, dict):
        raise CodexWorkflowError("worker spec must be an object")
    allowed_fields = {
        "name",
        "brief",
        "model",
        "effort",
        "report_dirs",
        "artifacts",
        "launch_timeout",
        "expected_result",
    }
    unknown_fields = sorted(set(worker) - allowed_fields)
    if unknown_fields:
        raise CodexWorkflowError(f"worker spec has unknown fields: {unknown_fields}")
    name_value = worker.get("name")
    if not isinstance(name_value, str):
        raise CodexWorkflowError("worker name must be a string")
    name = validate_worker_name(name_value)
    brief_value = worker.get("brief")
    if not isinstance(brief_value, str) or not Path(brief_value).is_absolute():
        raise CodexWorkflowError(f"worker {name} brief must be an absolute path")
    brief = Path(brief_value)
    if not brief.is_file():
        raise CodexWorkflowError(f"worker {name} brief does not exist: {brief}")
    artifacts = worker.get("artifacts", [])
    if not isinstance(artifacts, list) or not all(isinstance(item, str) for item in artifacts):
        raise CodexWorkflowError(f"worker {name} artifacts must be a string list")
    for pattern in artifacts:
        validate_artifact_pattern(pattern)
    report_dirs = worker.get("report_dirs", [])
    if not isinstance(report_dirs, list) or not all(
        isinstance(item, str) and Path(item).is_absolute() for item in report_dirs
    ):
        raise CodexWorkflowError(f"worker {name} report_dirs must contain absolute paths")
    model = worker.get("model")
    if model is not None and (not isinstance(model, str) or not model):
        raise CodexWorkflowError(f"worker {name} model must be a nonempty string")
    effort = worker.get("effort")
    if effort is not None and effort not in {"xhigh", "max"}:
        raise CodexWorkflowError(f"worker {name} effort must be xhigh or max")
    launch_timeout = worker.get("launch_timeout", 3.0)
    if (
        isinstance(launch_timeout, bool)
        or not isinstance(launch_timeout, (int, float))
        or not math.isfinite(launch_timeout)
        or launch_timeout <= 0
    ):
        raise CodexWorkflowError(f"worker {name} launch_timeout must be positive")
    expected_result = worker.get("expected_result")
    if expected_result is not None and not isinstance(expected_result, str):
        raise CodexWorkflowError(f"worker {name} expected_result must be a string")
    return {
        **worker,
        "name": name,
        "brief": str(brief.resolve()),
        "artifacts": artifacts,
        "report_dirs": report_dirs,
        "launch_timeout": float(launch_timeout),
    }


def validate_composition_spec(spec: Any, *, pipeline: bool) -> dict[str, Any]:
    if not isinstance(spec, dict):
        raise CodexWorkflowError("composition spec must be an object")
    repo_value = spec.get("repo")
    lead = spec.get("lead")
    if not isinstance(repo_value, str) or not Path(repo_value).is_absolute():
        raise CodexWorkflowError("spec repo must be an absolute path")
    repo = Path(repo_value).resolve()
    if not repo.is_dir():
        raise CodexWorkflowError(f"spec repo does not exist: {repo}")
    if not isinstance(lead, str) or not lead.strip():
        raise CodexWorkflowError("spec lead is required")
    model = spec.get("model", "gpt-5.6-luna")
    effort = spec.get("effort", "xhigh")
    if not isinstance(model, str) or not model:
        raise CodexWorkflowError("spec model must be a nonempty string")
    if effort not in {"xhigh", "max"}:
        raise CodexWorkflowError("spec effort must be xhigh or max")

    normalized: dict[str, Any] = {
        **spec,
        "repo": str(repo),
        "lead": lead,
        "model": model,
        "effort": effort,
    }
    names: set[str] = set()
    if pipeline:
        stages = spec.get("stages")
        if not isinstance(stages, list) or not stages:
            raise CodexWorkflowError("pipeline spec requires nonempty stages")
        normalized_stages = []
        for stage in stages:
            if not isinstance(stage, dict):
                raise CodexWorkflowError("pipeline stage must be an object")
            stage_name_value = stage.get("name")
            if not isinstance(stage_name_value, str):
                raise CodexWorkflowError("pipeline stage name must be a string")
            stage_name = validate_worker_name(stage_name_value)
            workers = stage.get("workers")
            if not isinstance(workers, list) or not workers:
                raise CodexWorkflowError(f"pipeline stage {stage_name} requires workers")
            normalized_workers = [_validate_worker_spec(worker) for worker in workers]
            for worker in normalized_workers:
                if worker["name"] in names:
                    raise CodexWorkflowError(f"duplicate worker name: {worker['name']}")
                names.add(worker["name"])
            normalized_stages.append(
                {**stage, "name": stage_name, "workers": normalized_workers}
            )
        continue_on_failure = spec.get("continue_on_failure", False)
        if not isinstance(continue_on_failure, bool):
            raise CodexWorkflowError("continue_on_failure must be a boolean")
        normalized["stages"] = normalized_stages
        normalized["continue_on_failure"] = continue_on_failure
    else:
        workers = spec.get("workers")
        if not isinstance(workers, list) or not workers:
            raise CodexWorkflowError("parallel spec requires nonempty workers")
        normalized_workers = [_validate_worker_spec(worker) for worker in workers]
        for worker in normalized_workers:
            if worker["name"] in names:
                raise CodexWorkflowError(f"duplicate worker name: {worker['name']}")
            names.add(worker["name"])
        normalized["workers"] = normalized_workers
    return normalized


def _launch_spec_workers(
    spec: dict[str, Any],
    workers: list[dict[str, Any]],
    *,
    manifest_path: Path,
    run_root: Path,
    launch_fn: Callable[..., dict[str, Any]],
) -> list[dict[str, Any]]:
    results = []
    for worker in workers:
        results.append(
            launch_fn(
                manifest_path=manifest_path,
                repo=spec["repo"],
                run_root=run_root,
                worker_name=worker["name"],
                brief=worker["brief"],
                lead=spec["lead"],
                model=worker.get("model", spec["model"]),
                effort=worker.get("effort", spec["effort"]),
                report_dirs=worker.get("report_dirs", []),
                artifacts=worker.get("artifacts", []),
                launch_timeout=float(worker.get("launch_timeout", 3.0)),
            )
        )
    return results


def run_parallel_spec(
    spec: dict[str, Any],
    *,
    run_root: Path | str,
    run_id: str,
    watch: bool,
    launch_fn: Callable[..., dict[str, Any]],
    watch_fn: Callable[..., int],
    watch_timeout: float = 3600.0,
) -> tuple[int, Path]:
    normalized = validate_composition_spec(spec, pipeline=False)
    safe_run_id = validate_worker_name(run_id)
    root = Path(run_root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    manifest_path = root / "manifest.json"
    ensure_manifest(
        manifest_path,
        run_id=safe_run_id,
        repo=normalized["repo"],
        lead=normalized["lead"],
    )
    update_manifest(manifest_path, {"mode": "parallel"})
    launcher = launch_fn
    watcher = watch_fn
    results = _launch_spec_workers(
        normalized,
        normalized["workers"],
        manifest_path=manifest_path,
        run_root=root,
        launch_fn=launcher,
    )
    launch_failed = any(not result.get("ok") for result in results)
    if not watch:
        update_manifest(
            manifest_path,
            {
                "completion_state": "launch_only",
                "completion_proven": False,
            },
        )
        return (1 if launch_failed else LAUNCH_ONLY_EXIT), manifest_path
    watch_code = watcher(manifest_path, timeout=watch_timeout)
    watch_code = guarded_watch_code(manifest_path, watch_code)
    return (watch_code if watch_code != 0 else (1 if launch_failed else 0)), manifest_path


def run_pipeline_spec(
    spec: dict[str, Any],
    *,
    run_root: Path | str,
    run_id: str,
    launch_fn: Callable[..., dict[str, Any]],
    watch_fn: Callable[..., int],
    watch_timeout: float = 3600.0,
) -> tuple[int, Path]:
    normalized = validate_composition_spec(spec, pipeline=True)
    safe_run_id = validate_worker_name(run_id)
    root = Path(run_root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    manifest_path = root / "manifest.json"
    ensure_manifest(
        manifest_path,
        run_id=safe_run_id,
        repo=normalized["repo"],
        lead=normalized["lead"],
    )
    update_manifest(
        manifest_path,
        {
            "mode": "pipeline",
            "continue_on_failure": normalized["continue_on_failure"],
            "stages": [stage["name"] for stage in normalized["stages"]],
        },
    )
    launcher = launch_fn
    watcher = watch_fn
    final_code = 0
    for stage in normalized["stages"]:
        update_manifest(manifest_path, {"active_stage": stage["name"]})
        results = _launch_spec_workers(
            normalized,
            stage["workers"],
            manifest_path=manifest_path,
            run_root=root,
            launch_fn=launcher,
        )
        launch_failed = any(not result.get("ok") for result in results)
        watch_code = watcher(manifest_path, timeout=watch_timeout)
        watch_code = guarded_watch_code(manifest_path, watch_code)
        stage_failed = launch_failed or watch_code != 0
        if stage_failed:
            final_code = watch_code if watch_code != 0 else 1
            if not normalized["continue_on_failure"]:
                update_manifest(manifest_path, {"stopped_after_stage": stage["name"]})
                return final_code, manifest_path
    update_manifest(manifest_path, {"active_stage": None})
    return final_code, manifest_path
