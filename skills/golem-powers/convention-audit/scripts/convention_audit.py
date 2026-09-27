#!/usr/bin/env python3
"""Read-only, Luna-pinned fan-out for single-source-of-truth audits."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import sys
from pathlib import Path
from typing import Any

_IMPL_DIR = (Path(__file__).resolve().parent / "convention_audit_impl").resolve()
_PACKAGE_NAME = "_convention_audit_impl_" + hashlib.sha256(str(_IMPL_DIR).encode()).hexdigest()
if _PACKAGE_NAME not in sys.modules:
    _spec = importlib.util.spec_from_file_location(
        _PACKAGE_NAME, _IMPL_DIR / "__init__.py",
        submodule_search_locations=[str(_IMPL_DIR)],
    )
    if _spec is None or _spec.loader is None:
        raise ImportError(f"Cannot load convention audit implementation: {_IMPL_DIR}")
    _package = importlib.util.module_from_spec(_spec)
    sys.modules[_PACKAGE_NAME] = _package
    try:
        _spec.loader.exec_module(_package)
    except BaseException:
        del sys.modules[_PACKAGE_NAME]
        raise
_impl = sys.modules[_PACKAGE_NAME]
time = _impl.reporting.time
DETECTOR_IGNORED_DIRS = _impl.detector.DETECTOR_IGNORED_DIRS
SQLITE_RECENT_WINDOW_PATTERN = _impl.detector.SQLITE_RECENT_WINDOW_PATTERN
detect_sqlite_recent_window_candidates = _impl.detector.detect_sqlite_recent_window_candidates
validate_payload = _impl.payloads.validate_payload
aggregate_worker_payloads = _impl.payloads.aggregate_worker_payloads
WorkerResult = _impl.codex_runner.WorkerResult
_run_process = _impl.codex_runner._run_process
_max_is_unavailable = _impl.codex_runner._max_is_unavailable
_json_events = _impl.codex_runner._json_events
_walk_dicts = _impl.reporting._walk_dicts
_number = _impl.reporting._number
usage_from_events = _impl.reporting.usage_from_events
_telemetry_for_results = _impl.reporting._telemetry_for_results
_sum_usage = _impl.reporting._sum_usage
_detector_seed_log = _impl.reporting._detector_seed_log
_build_run_log = _impl.reporting._build_run_log
_write_run_log = _impl.reporting._write_run_log
_render_report = _impl.reporting._render_report
LENSES = _impl.audit.LENSES
_worker_prompt = _impl.audit._worker_prompt
_synthesis_prompt = _impl.audit._synthesis_prompt
_git_state = _impl.audit._git_state
_revision = _impl.audit._revision
_parser = _impl.cli._parser
MODEL = "gpt-5.6-luna"
DEFAULT_EFFORT = "max"
FALLBACK_EFFORT = "xhigh"


def build_codex_command(*, codex_binary: str, repo: Path, output_schema: Path,
                        effort: str, json_events: bool = True,
                        output_last_message: Path | None = None) -> list[str]:
    return _impl.codex_runner.build_codex_command(codex_binary=codex_binary, repo=repo,
        output_schema=output_schema, effort=effort, json_events=json_events,
        output_last_message=output_last_message, model=MODEL)


def verify_effective_pin(banner: str, *, requested_effort: str) -> dict[str, str]:
    return _impl.codex_runner.verify_effective_pin(banner, requested_effort=requested_effort, model=MODEL)


def preflight_pin(codex_binary: str, repo: Path, schema: Path, *, timeout: int,
                  evidence_path: Path | None = None,
                  allow_fallback: bool = True) -> dict[str, Any]:
    return _impl.codex_runner.preflight_pin(codex_binary, repo, schema, timeout=timeout,
        evidence_path=evidence_path, allow_fallback=allow_fallback,
        config=_impl.codex_runner.RunnerConfig(MODEL, DEFAULT_EFFORT, FALLBACK_EFFORT),
        build_command=build_codex_command, verify_pin=verify_effective_pin, run_process=_run_process)


def _run_worker(*, label: str, prompt: str, repo: Path, schema: Path, effort: str,
                codex_binary: str, run_dir: Path, timeout: int,
                require_divergent_subset: bool = True) -> WorkerResult:
    return _impl.codex_runner._run_worker(label=label, prompt=prompt, repo=repo, schema=schema,
        effort=effort, codex_binary=codex_binary, run_dir=run_dir, timeout=timeout,
        require_divergent_subset=require_divergent_subset,
        build_command=build_codex_command, run_process=_run_process)


def run_audit(args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, Any]]:
    return _impl.audit.run_audit(args, skill_dir=Path(__file__).resolve().parents[1],
        preflight=preflight_pin, run_worker=_run_worker, lenses=LENSES)


def main() -> int:
    return _impl.cli.main(parser=_parser, run_audit=run_audit, lens_count=len(LENSES))


if __name__ == "__main__":
    raise SystemExit(main())
