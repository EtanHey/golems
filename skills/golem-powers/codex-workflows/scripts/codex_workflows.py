#!/usr/bin/env python3
"""Headless Codex worktree orchestration primitives."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import sys
from typing import Any, Callable

# File-based importlib callers (including the eval scripts) do not put this
# directory on sys.path. Resolve from the real entry even through a symlink.
_SCRIPT_DIR = str(Path(__file__).resolve().parent)
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

from codex_workflows_impl import cli as _cli, composition as _composition, workers as _workers
from codex_workflows_impl.config import WorkflowConfig, CodexWorkflowError
from codex_workflows_impl.config import (
    _default_runs_dir,
    utc_now,
    validate_worker_name,
    validate_artifact_pattern,
    DEGRADED_MODE,
    SAFE_NAME_RE,
    TERMINAL_STATES,
    PR_URL_RE,
    LAUNCH_FAILURE_RE,
    LAUNCH_ONLY_EXIT,
)
from codex_workflows_impl.worktrees import (
    resolve_artifacts,
    discover_default_branch,
    _run_git,
    git_common_dir,
    create_worker_worktree,
)
from codex_workflows_impl.manifest import (
    atomic_write_json,
    locked_manifest_update,
    create_manifest,
    update_worker,
    update_manifest,
    load_manifest,
    ensure_manifest,
)
from codex_workflows_impl.process import (
    _ps_value,
    capture_process_identity,
    process_identity_alive,
    _pid_alive,
    _launch_log_evidence,
    verify_launch,
)
from codex_workflows_impl.logs import (
    write_log_header,
    _recognized_event,
    parse_finished_log,
    _terminal_status,
)
from codex_workflows_impl.workers import (
    finalize_worker,
    cleanup_worker,
)
from codex_workflows_impl.runs import (
    watch_manifest,
    manifest_completion_code,
    guarded_watch_code,
    harvest_manifest,
)
from codex_workflows_impl.composition import (
    _validate_worker_spec,
    validate_composition_spec,
    _launch_spec_workers,
)
from codex_workflows_impl.cli import (
    _agent_manifest_target,
    _existing_manifest_target,
)


CODEX_BIN = Path(os.environ.get("CODEX_BIN") or shutil.which("codex") or Path.home() / ".local/bin/codex")

NOHUP_BIN = Path("/usr/bin/nohup")

DEFAULT_RUNS_DIR = _default_runs_dir()


def _config() -> WorkflowConfig:
    return WorkflowConfig(CODEX_BIN, NOHUP_BIN)


def build_launch_argv(
    *,
    repo: Path | str,
    worktree: Path | str,
    brief: Path | str,
    model: str,
    effort: str,
    report_dirs: list[Path | str],
) -> tuple[list[str], str]:
    return _workers.build_launch_argv(
        repo=repo, worktree=worktree, brief=brief, model=model, effort=effort,
        report_dirs=report_dirs, config=_config(), preflight=preflight_launch_inputs,
    )


def preflight_launch_inputs(
    *,
    repo: Path | str,
    brief: Path | str,
) -> tuple[Path, Path]:
    return _workers.preflight_launch_inputs(repo=repo, brief=brief, config=_config())


def launch_worker(
    *,
    manifest_path: Path | str,
    repo: Path | str,
    run_root: Path | str,
    worker_name: str,
    brief: Path | str,
    lead: str,
    model: str,
    effort: str,
    report_dirs: list[Path | str],
    artifacts: list[str],
    launch_timeout: float = 3.0,
) -> dict[str, Any]:
    return _workers.launch_worker(
        manifest_path=manifest_path, repo=repo, run_root=run_root,
        worker_name=worker_name, brief=brief, lead=lead, model=model, effort=effort,
        report_dirs=report_dirs, artifacts=artifacts, launch_timeout=launch_timeout,
        dependencies=_workers.LaunchDependencies(
            preflight_launch_inputs, create_worker_worktree, build_launch_argv,
        ),
    )


def run_parallel_spec(
    spec: dict[str, Any],
    *,
    run_root: Path | str,
    run_id: str,
    watch: bool,
    launch_fn: Callable[..., dict[str, Any]] | None = None,
    watch_fn: Callable[..., int] | None = None,
    watch_timeout: float = 3600.0,
) -> tuple[int, Path]:
    return _composition.run_parallel_spec(
        spec, run_root=run_root, run_id=run_id, watch=watch,
        launch_fn=launch_fn or launch_worker, watch_fn=watch_fn or watch_manifest,
        watch_timeout=watch_timeout,
    )


def run_pipeline_spec(
    spec: dict[str, Any],
    *,
    run_root: Path | str,
    run_id: str,
    launch_fn: Callable[..., dict[str, Any]] | None = None,
    watch_fn: Callable[..., int] | None = None,
    watch_timeout: float = 3600.0,
) -> tuple[int, Path]:
    return _composition.run_pipeline_spec(
        spec, run_root=run_root, run_id=run_id,
        launch_fn=launch_fn or launch_worker, watch_fn=watch_fn or watch_manifest,
        watch_timeout=watch_timeout,
    )


def build_parser() -> argparse.ArgumentParser:
    return _cli.build_parser(DEFAULT_RUNS_DIR)


def _add_existing_run_target(parser: argparse.ArgumentParser) -> None:
    return _cli._add_existing_run_target(parser, DEFAULT_RUNS_DIR)


def main(argv: list[str] | None = None) -> int:
    return _cli.main(argv, actions=_cli.CliActions(
        build_parser, launch_worker, run_parallel_spec, run_pipeline_spec,
    ))


if __name__ == "__main__":
    raise SystemExit(main())
