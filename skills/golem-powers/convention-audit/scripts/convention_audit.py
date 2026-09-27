#!/usr/bin/env python3
"""Read-only, Luna-pinned fan-out for single-source-of-truth audits."""

from __future__ import annotations

import argparse
import hashlib
import importlib
import importlib.util
import concurrent.futures
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


# Keep installed and worktree copies isolated without changing sys.path.
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

_detector = importlib.import_module(".detector", _PACKAGE_NAME)
_payloads = importlib.import_module(".payloads", _PACKAGE_NAME)
DETECTOR_IGNORED_DIRS = _detector.DETECTOR_IGNORED_DIRS
SQLITE_RECENT_WINDOW_PATTERN = _detector.SQLITE_RECENT_WINDOW_PATTERN
detect_sqlite_recent_window_candidates = _detector.detect_sqlite_recent_window_candidates
validate_payload = _payloads.validate_payload
aggregate_worker_payloads = _payloads.aggregate_worker_payloads

_runner = importlib.import_module(".codex_runner", _PACKAGE_NAME)
_reporting = importlib.import_module(".reporting", _PACKAGE_NAME)
WorkerResult = _runner.WorkerResult
_run_process = _runner._run_process
_max_is_unavailable = _runner._max_is_unavailable
_json_events = _runner._json_events
_walk_dicts = _reporting._walk_dicts
_number = _reporting._number
usage_from_events = _reporting.usage_from_events
_telemetry_for_results = _reporting._telemetry_for_results
_sum_usage = _reporting._sum_usage
_detector_seed_log = _reporting._detector_seed_log
_build_run_log = _reporting._build_run_log
_write_run_log = _reporting._write_run_log
_render_report = _reporting._render_report

MODEL = "gpt-5.6-luna"
DEFAULT_EFFORT = "max"
FALLBACK_EFFORT = "xhigh"
LENSES = {
    "time-and-query-semantics": "time windows, timestamp normalization, query predicates, pagination boundaries, and equivalent database semantics",
    "data-ownership": "multiple writers, precedence rules, state ownership, derived fields, and schema columns with competing producers",
    "lifecycle-control": "start/stop/pause/resume/drain lifecycle halves, producer-consumer coordination, queues, workers, daemons, and cleanup",
    "paths-and-identity": "path derivation, naming, worktree/project identity, configuration defaults, cache keys, and identifiers",
    "live-copy-drift": "vendored copies, generated copies, installed copies, hooks, watchers, duplicated live code trees, and deployment propagation",
    "duplicated-domain-logic": "independent algorithms, thresholds, parsing, routing, policy, validation, and business rules that should share one owner",
}


def build_codex_command(*, codex_binary: str, repo: Path, output_schema: Path,
                        effort: str, json_events: bool = True,
                        output_last_message: Path | None = None) -> list[str]:
    return _runner.build_codex_command(codex_binary=codex_binary, repo=repo,
        output_schema=output_schema, effort=effort, json_events=json_events,
        output_last_message=output_last_message, model=MODEL)


def verify_effective_pin(banner: str, *, requested_effort: str) -> dict[str, str]:
    return _runner.verify_effective_pin(banner, requested_effort=requested_effort, model=MODEL)


def preflight_pin(codex_binary: str, repo: Path, schema: Path, *, timeout: int,
                  evidence_path: Path | None = None,
                  allow_fallback: bool = True) -> dict[str, Any]:
    return _runner.preflight_pin(codex_binary, repo, schema, timeout=timeout,
        evidence_path=evidence_path, allow_fallback=allow_fallback,
        config=_runner.RunnerConfig(MODEL, DEFAULT_EFFORT, FALLBACK_EFFORT),
        build_command=build_codex_command, verify_pin=verify_effective_pin, run_process=_run_process)


def _run_worker(*, label: str, prompt: str, repo: Path, schema: Path, effort: str,
                codex_binary: str, run_dir: Path, timeout: int,
                require_divergent_subset: bool = True) -> WorkerResult:
    return _runner._run_worker(label=label, prompt=prompt, repo=repo, schema=schema,
        effort=effort, codex_binary=codex_binary, run_dir=run_dir, timeout=timeout,
        require_divergent_subset=require_divergent_subset,
        build_command=build_codex_command, run_process=_run_process)


def _worker_prompt(
    label: str,
    focus: str,
    *,
    detector_payload: dict[str, Any] | None = None,
) -> str:
    detector_context = ""
    if detector_payload is not None:
        detector_context = f"""
A cheap deterministic inventory found the following candidate evidence:
{json.dumps(detector_payload, indent=2, sort_keys=True)}

Verify this inventory first against the cited files and lines. Keep it only if the concept and
divergence are real; correct the enumeration if repository evidence requires it. Then continue
the broader lens search.
"""
    return f"""You are one read-only worker in a convention audit of the repository at your current directory.

Question: Where does ONE concept have multiple independent implementations that can silently diverge?
Your lens: {focus}.

Inspect the real repository with rg and targeted file reads. This is NOT a generic linter or style review.
Only report a finding when you can enumerate all relevant implementation sites and identify an actual divergence risk.
Shared callers of one helper are a negative control, not a finding. Do not edit files.
Do not inspect paths outside the current working directory; external skill trees, evals, reports,
collab files, and other repository checkouts are out of scope and may contain answer keys.
{detector_context}

For every finding:
- name the concept;
- list every implementation site as a repo-relative path and exact current line;
- identify only the sites that diverge and explain why;
- propose the smallest shared-helper/owner/controller shape that collapses them.

Set worker to {json.dumps(label)}. Return the schema object even when findings is empty.
"""


def _synthesis_prompt(candidates: list[dict[str, Any]]) -> str:
    return f"""You are the final read-only verifier for a single-source-of-truth convention audit.

Question: Where does one concept have multiple independent implementations that can silently diverge?
Candidate findings from independent workers follow:
{json.dumps(candidates, indent=2, sort_keys=True)}

Verify every candidate against the real files in the current repository. Deduplicate overlapping candidates.
Reject generic lint/style duplication, false positives where callers share one helper, missing-file citations, and claims whose line numbers do not contain the described implementation.
Do not inspect paths outside the current working directory; external skill trees, evals, reports,
collab files, and other repository checkouts are out of scope and may contain answer keys.
For each retained finding, enumerate every implementation site, mark only the divergent sites, and give the smallest shared-helper/owner/controller shape. Do not edit files.
Every retained divergent `path:line` must also appear verbatim in that finding's implementation-sites
array. Normalize or reject raw candidates that use a broader implementation entrypoint and a different
internal line for the divergence.
Set worker to "synthesis". Return an empty findings list if nothing survives verification.
"""


def _git_state(repo: Path) -> str:
    probe = subprocess.run(
        ["git", "-C", str(repo), "status", "--porcelain=v1", "--untracked-files=all"],
        capture_output=True,
        text=True,
    )
    if probe.returncode != 0:
        detail = probe.stderr.strip() or "git status returned no diagnostic"
        raise RuntimeError(f"could not read git state for {repo}: {detail}")
    return probe.stdout


def _revision(repo: Path) -> str:
    probe = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True
    )
    return probe.stdout.strip() if probe.returncode == 0 else "unknown"


def run_audit(args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, Any]]:
    repo = args.repo.resolve()
    if not repo.is_dir():
        raise RuntimeError(f"repository does not exist: {repo}")
    codex_binary = (
        shutil.which(args.codex_binary)
        if os.sep not in args.codex_binary
        else args.codex_binary
    )
    if not codex_binary or not Path(codex_binary).is_file():
        raise RuntimeError(f"codex binary not found: {args.codex_binary}")
    skill_dir = Path(__file__).resolve().parents[1]
    worker_schema = skill_dir / "scripts" / "worker.schema.json"
    report_schema = skill_dir / "scripts" / "report.schema.json"
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir = output_dir / f"{repo.name}-{stamp}"
    run_dir.mkdir(parents=True, exist_ok=False)
    started = time.monotonic()
    stage = "target-preflight"
    results: list[WorkerResult] = []
    before: str | None = None
    revision = "unknown"
    detector_payload: dict[str, Any] | None = None
    pin: dict[str, Any] | None = None

    def checkpoint(
        *,
        status: str = "running",
        target_git_state_unchanged: bool | None = None,
        failure: dict[str, str] | None = None,
        require_usage: bool = False,
    ) -> dict[str, Any]:
        run_log = _build_run_log(
            repo=repo.name,
            revision=revision,
            pin=pin,
            detector_payload=detector_payload,
            results=results,
            started=started,
            status=status,
            stage=stage,
            target_git_state_unchanged=target_git_state_unchanged,
            failure=failure,
            require_usage=require_usage,
        )
        _write_run_log(run_dir, run_log)
        return run_log

    try:
        before = _git_state(repo)
        revision = _revision(repo)
        detector_payload = detect_sqlite_recent_window_candidates(repo)
        checkpoint()

        stage = "pin-preflight"
        checkpoint()
        pin = preflight_pin(
            codex_binary,
            repo,
            report_schema,
            timeout=args.timeout,
            evidence_path=run_dir / "pin-preflight.log",
            allow_fallback=not args.no_effort_fallback,
        )
        effort = pin["effort"]
        checkpoint()

        stage = "analysis"
        checkpoint()
        worker_errors: dict[str, str] = {}
        with concurrent.futures.ThreadPoolExecutor(
            max_workers=args.concurrency
        ) as executor:
            futures = {
                executor.submit(
                    _run_worker,
                    label=label,
                    prompt=_worker_prompt(
                        label,
                        focus,
                        detector_payload=(
                            detector_payload
                            if label == "time-and-query-semantics"
                            else None
                        ),
                    ),
                    repo=repo,
                    schema=worker_schema,
                    effort=effort,
                    codex_binary=codex_binary,
                    run_dir=run_dir,
                    timeout=args.timeout,
                    require_divergent_subset=False,
                ): label
                for label, focus in LENSES.items()
            }
            for future in concurrent.futures.as_completed(futures):
                label = futures[future]
                try:
                    results.append(future.result())
                except Exception as exc:
                    worker_errors[label] = str(exc)
                checkpoint()
        if worker_errors:
            details = "; ".join(
                f"{label}: {worker_errors[label]}" for label in sorted(worker_errors)
            )
            raise RuntimeError(f"analysis worker failures: {details}")
        results.sort(key=lambda result: result.label)

        stage = "synthesis"
        checkpoint()
        synthesis = _run_worker(
            label="synthesis",
            prompt=_synthesis_prompt(
                [detector_payload, *[result.payload for result in results]]
            ),
            repo=repo,
            schema=report_schema,
            effort=effort,
            codex_binary=codex_binary,
            run_dir=run_dir,
            timeout=args.timeout,
            require_divergent_subset=True,
        )
        results.append(synthesis)
        checkpoint()
        report = aggregate_worker_payloads(
            [synthesis.payload], repo=repo.name, revision=revision
        )

        stage = "target-verification"
        after = _git_state(repo)
        if before != after:
            raise RuntimeError("audit mutated target repository state; refusing report")

        stage = "reporting"
        checkpoint(target_git_state_unchanged=True)
        run_log = _build_run_log(
            repo=repo.name,
            revision=revision,
            pin=pin,
            detector_payload=detector_payload,
            results=results,
            started=started,
            status="complete",
            stage="complete",
            target_git_state_unchanged=True,
            require_usage=True,
        )
        (run_dir / "report.json").write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        (run_dir / "report.md").write_text(
            _render_report(report, run_log), encoding="utf-8"
        )
        _write_run_log(run_dir, run_log)
        return report, run_log
    except (RuntimeError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
        target_git_state_unchanged: bool | None = None
        failure = {
            "stage": stage,
            "type": type(exc).__name__,
            "message": str(exc),
        }
        if before is not None:
            try:
                target_git_state_unchanged = before == _git_state(repo)
            except RuntimeError as state_exc:
                failure["target_state_error"] = str(state_exc)
        checkpoint(
            status="failed",
            target_git_state_unchanged=target_git_state_unchanged,
            failure=failure,
        )
        raise


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Find concepts with multiple independent implementations that can silently diverge."
    )
    parser.add_argument(
        "--repo", required=True, type=Path, help="Repository to inspect read-only"
    )
    parser.add_argument(
        "--output-dir",
        required=True,
        type=Path,
        help="Directory for report and raw run logs",
    )
    parser.add_argument(
        "--codex-binary",
        default="codex",
        help="Raw Codex CLI binary (never a repoGolem alias)",
    )
    parser.add_argument("--concurrency", type=int, default=3)
    parser.add_argument(
        "--timeout", type=int, default=1800, help="Per-worker timeout in seconds"
    )
    parser.add_argument(
        "--no-effort-fallback",
        action="store_true",
        help="Require max reasoning and never attempt the xhigh fallback",
    )
    return parser


def main() -> int:
    args = _parser().parse_args()
    if args.concurrency < 1 or args.concurrency > len(LENSES):
        raise SystemExit(f"--concurrency must be between 1 and {len(LENSES)}")
    try:
        report, run_log = run_audit(args)
    except (RuntimeError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
        print(f"convention-audit: {exc}", file=sys.stderr)
        return 1
    print(
        json.dumps(
            {"findings": len(report["findings"]), "telemetry": run_log["telemetry"]},
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

