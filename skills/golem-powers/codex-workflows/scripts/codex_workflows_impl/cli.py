"""Cli operations for headless Codex workflows."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
import argparse
import json
import sys

from .config import (
    CodexWorkflowError,
    DEGRADED_MODE,
    LAUNCH_ONLY_EXIT,
    validate_worker_name,
)
from .manifest import ensure_manifest, load_manifest
from .workers import cleanup_worker
from .runs import guarded_watch_code, harvest_manifest, watch_manifest


@dataclass(frozen=True)
class CliActions:
    """Facade-bound operations whose configuration is resolved at call time."""

    build_parser: Callable[..., argparse.ArgumentParser]
    launch_worker: Callable[..., dict[str, Any]]
    run_parallel_spec: Callable[..., tuple[int, Path]]
    run_pipeline_spec: Callable[..., tuple[int, Path]]


def _agent_manifest_target(args: argparse.Namespace) -> tuple[Path, Path, str]:
    if args.run_id:
        run_id = validate_worker_name(args.run_id)
        root = Path(args.run_dir).resolve() / run_id
        return root / "manifest.json", root, run_id
    manifest_path = Path(args.manifest).resolve()
    root = manifest_path.parent
    if manifest_path.exists():
        run_id = str(load_manifest(manifest_path)["run_id"])
    else:
        run_id = validate_worker_name(root.name)
    return manifest_path, root, run_id


def _existing_manifest_target(args: argparse.Namespace) -> Path:
    if args.manifest:
        return Path(args.manifest).resolve()
    run_id = validate_worker_name(args.run_id)
    return Path(args.run_dir).resolve() / run_id / "manifest.json"


def _add_existing_run_target(parser: argparse.ArgumentParser, default_runs_dir: Path) -> None:
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--run-id")
    target.add_argument("--manifest")
    parser.add_argument("--run-dir", default=str(default_runs_dir))


def build_parser(default_runs_dir: Path) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Headless Codex worktree orchestration primitives.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    agent = subparsers.add_parser("agent", help="launch one verified headless worker")
    agent.add_argument("--repo", required=True)
    agent.add_argument("--name", required=True)
    agent.add_argument("--brief", required=True)
    agent.add_argument("--lead", required=True)
    target = agent.add_mutually_exclusive_group(required=True)
    target.add_argument("--run-id")
    target.add_argument("--manifest")
    agent.add_argument("--run-dir", default=str(default_runs_dir))
    agent.add_argument("--model", default="gpt-5.6-luna")
    agent.add_argument("--effort", choices=["xhigh", "max"], default="xhigh")
    agent.add_argument("--report-dir", action="append", default=[])
    agent.add_argument("--artifact", action="append", default=[])
    agent.add_argument("--launch-timeout", type=float, default=3.0)

    watch = subparsers.add_parser("watch", help="watch process exit, then parse logs")
    _add_existing_run_target(watch, default_runs_dir)
    watch.add_argument("--interval", type=float, default=1.0)
    watch.add_argument(
        "--timeout",
        "--watch-timeout",
        dest="timeout",
        type=float,
        default=3600.0,
    )

    status = subparsers.add_parser("status", help="print a run manifest")
    _add_existing_run_target(status, default_runs_dir)

    harvest = subparsers.add_parser("harvest", help="copy durable logs and artifacts")
    _add_existing_run_target(harvest, default_runs_dir)
    harvest.add_argument("--output-dir")

    cleanup = subparsers.add_parser("cleanup", help="remove harvested worktrees")
    _add_existing_run_target(cleanup, default_runs_dir)
    cleanup.add_argument("--worker", action="append")
    cleanup.add_argument("--delete-branches", action="store_true")
    cleanup.add_argument("--force-unmerged", action="store_true")

    parallel = subparsers.add_parser("parallel", help="launch a validated worker fan-out")
    parallel.add_argument("--spec", required=True)
    parallel.add_argument("--run-id", required=True)
    parallel.add_argument("--run-dir", default=str(default_runs_dir))
    parallel.add_argument("--watch", action="store_true")
    parallel.add_argument("--watch-timeout", type=float, default=3600.0)

    pipeline = subparsers.add_parser("pipeline", help="run ordered parallel stages")
    pipeline.add_argument("--spec", required=True)
    pipeline.add_argument("--run-id", required=True)
    pipeline.add_argument("--run-dir", default=str(default_runs_dir))
    pipeline.add_argument("--watch-timeout", type=float, default=3600.0)
    return parser


def main(argv: list[str] | None, *, actions: CliActions) -> int:
    parser = actions.build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "agent":
            manifest_path, run_root, run_id = _agent_manifest_target(args)
            ensure_manifest(
                manifest_path,
                run_id=run_id,
                repo=args.repo,
                lead=args.lead,
            )
            result = actions.launch_worker(
                manifest_path=manifest_path,
                repo=args.repo,
                run_root=run_root,
                worker_name=args.name,
                brief=args.brief,
                lead=args.lead,
                model=args.model,
                effort=args.effort,
                report_dirs=args.report_dir,
                artifacts=args.artifact,
                launch_timeout=args.launch_timeout,
            )
            result["manifest"] = str(manifest_path)
            result["degraded_mode"] = list(DEGRADED_MODE)
            print(json.dumps(result, indent=2, sort_keys=True))
            return 0 if result.get("ok") else 1
        if args.command == "watch":
            manifest_path = _existing_manifest_target(args)
            result = watch_manifest(
                manifest_path,
                interval=args.interval,
                timeout=args.timeout,
            )
            print(json.dumps(load_manifest(manifest_path), indent=2, sort_keys=True))
            return guarded_watch_code(manifest_path, result)
        if args.command == "status":
            print(
                json.dumps(
                    load_manifest(_existing_manifest_target(args)),
                    indent=2,
                    sort_keys=True,
                )
            )
            return 0
        if args.command == "harvest":
            manifest_path = _existing_manifest_target(args)
            output_dir = args.output_dir or str(manifest_path.parent / "harvest")
            print(
                json.dumps(
                    harvest_manifest(manifest_path, output_dir),
                    indent=2,
                    sort_keys=True,
                )
            )
            return 0
        if args.command == "cleanup":
            manifest_path = _existing_manifest_target(args)
            data = load_manifest(manifest_path)
            names = args.worker or list(data["workers"])
            for name in names:
                cleanup_worker(
                    manifest_path,
                    name,
                    delete_branch=args.delete_branches,
                    force_unmerged=args.force_unmerged,
                )
            return 0
        if args.command in {"parallel", "pipeline"}:
            spec_path = Path(args.spec).resolve()
            try:
                spec = json.loads(spec_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise CodexWorkflowError(f"cannot read composition spec {spec_path}: {exc}") from exc
            run_root = Path(args.run_dir).resolve() / validate_worker_name(args.run_id)
            if args.command == "parallel":
                code, manifest_path = actions.run_parallel_spec(
                    spec,
                    run_root=run_root,
                    run_id=args.run_id,
                    watch=args.watch,
                    watch_timeout=args.watch_timeout,
                )
            else:
                code, manifest_path = actions.run_pipeline_spec(
                    spec,
                    run_root=run_root,
                    run_id=args.run_id,
                    watch_timeout=args.watch_timeout,
                )
            print(json.dumps(load_manifest(manifest_path), indent=2, sort_keys=True))
            if code == LAUNCH_ONLY_EXIT:
                workers = len(load_manifest(manifest_path)["workers"])
                print(
                    f"LAUNCH_ONLY: {workers} workers running; completion unproven; run watch",
                    file=sys.stderr,
                )
            return code
    except CodexWorkflowError as exc:
        print(f"FAILED: {exc}", file=sys.stderr)
        return 1
    parser.error(f"unknown command: {args.command}")
    return 2
