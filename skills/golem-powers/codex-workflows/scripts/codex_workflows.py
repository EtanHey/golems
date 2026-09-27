#!/usr/bin/env python3
"""Headless Codex worktree orchestration primitives."""

from __future__ import annotations

import argparse
import hashlib
import importlib
import importlib.util
import os
from pathlib import Path
import shutil
import sys
from typing import Any, Callable

# Anchor each package to this entry's real location. Installed and worktree
# copies can coexist without sharing modules or changing the caller's sys.path.
_IMPL_DIR = (Path(__file__).resolve().parent / "codex_workflows_impl").resolve()
_PACKAGE_NAME = "_codex_workflows_impl_" + hashlib.sha256(str(_IMPL_DIR).encode()).hexdigest()
if _PACKAGE_NAME not in sys.modules:
    _spec = importlib.util.spec_from_file_location(
        _PACKAGE_NAME, _IMPL_DIR / "__init__.py",
        submodule_search_locations=[str(_IMPL_DIR)],
    )
    if _spec is None or _spec.loader is None:
        raise ImportError(f"Cannot load Codex workflow implementation: {_IMPL_DIR}")
    _package = importlib.util.module_from_spec(_spec)
    sys.modules[_PACKAGE_NAME] = _package
    try:
        _spec.loader.exec_module(_package)
    except BaseException:
        del sys.modules[_PACKAGE_NAME]
        raise

_settings = importlib.import_module(".config", _PACKAGE_NAME)
_worktrees = importlib.import_module(".worktrees", _PACKAGE_NAME)
_manifest = importlib.import_module(".manifest", _PACKAGE_NAME)
_process = importlib.import_module(".process", _PACKAGE_NAME)
_logs = importlib.import_module(".logs", _PACKAGE_NAME)
_workers = importlib.import_module(".workers", _PACKAGE_NAME)
_runs = importlib.import_module(".runs", _PACKAGE_NAME)
_composition = importlib.import_module(".composition", _PACKAGE_NAME)
_cli = importlib.import_module(".cli", _PACKAGE_NAME)

# Explicit compatibility exports; assignment avoids unused-import (F401) noise.
WorkflowConfig = _settings.WorkflowConfig
CodexWorkflowError = _settings.CodexWorkflowError
_default_runs_dir = _settings._default_runs_dir
utc_now = _settings.utc_now
validate_worker_name = _settings.validate_worker_name
validate_artifact_pattern = _settings.validate_artifact_pattern
DEGRADED_MODE = _settings.DEGRADED_MODE
SAFE_NAME_RE = _settings.SAFE_NAME_RE
TERMINAL_STATES = _settings.TERMINAL_STATES
PR_URL_RE = _settings.PR_URL_RE
LAUNCH_FAILURE_RE = _settings.LAUNCH_FAILURE_RE
LAUNCH_ONLY_EXIT = _settings.LAUNCH_ONLY_EXIT
resolve_artifacts = _worktrees.resolve_artifacts
discover_default_branch = _worktrees.discover_default_branch
_run_git = _worktrees._run_git
git_common_dir = _worktrees.git_common_dir
create_worker_worktree = _worktrees.create_worker_worktree
atomic_write_json = _manifest.atomic_write_json
locked_manifest_update = _manifest.locked_manifest_update
create_manifest = _manifest.create_manifest
update_worker = _manifest.update_worker
update_manifest = _manifest.update_manifest
load_manifest = _manifest.load_manifest
ensure_manifest = _manifest.ensure_manifest
_ps_value = _process._ps_value
capture_process_identity = _process.capture_process_identity
process_identity_alive = _process.process_identity_alive
_pid_alive = _process._pid_alive
_launch_log_evidence = _process._launch_log_evidence
verify_launch = _process.verify_launch
write_log_header = _logs.write_log_header
_recognized_event = _logs._recognized_event
parse_finished_log = _logs.parse_finished_log
_terminal_status = _logs._terminal_status
finalize_worker = _workers.finalize_worker
cleanup_worker = _workers.cleanup_worker
watch_manifest = _runs.watch_manifest
manifest_completion_code = _runs.manifest_completion_code
guarded_watch_code = _runs.guarded_watch_code
harvest_manifest = _runs.harvest_manifest
_validate_worker_spec = _composition._validate_worker_spec
validate_composition_spec = _composition.validate_composition_spec
_launch_spec_workers = _composition._launch_spec_workers
_agent_manifest_target = _cli._agent_manifest_target
_existing_manifest_target = _cli._existing_manifest_target

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
