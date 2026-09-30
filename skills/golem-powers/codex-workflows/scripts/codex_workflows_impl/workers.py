"""Workers operations for headless Codex workflows."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
import filecmp
import os
import subprocess
import time

from .config import (
    CodexWorkflowError,
    DEGRADED_MODE,
    WorkflowConfig,
    utc_now,
    validate_artifact_pattern,
    validate_worker_name,
)
from .worktrees import (
    _run_git,
    discover_default_branch,
    git_common_dir,
    resolve_artifacts,
)
from .manifest import load_manifest, update_worker
from .process import _ProcessNotObservable, capture_process_identity, process_identity_alive, verify_launch
from .logs import _terminal_status, parse_finished_log, write_log_header


@dataclass(frozen=True)
class LaunchDependencies:
    """The three caller-overridable launch preparation operations."""

    preflight: Callable[..., tuple[Path, Path]]
    create_worktree: Callable[..., str]
    build_argv: Callable[..., tuple[list[str], str]]


def build_launch_argv(
    *,
    repo: Path | str,
    worktree: Path | str,
    brief: Path | str,
    model: str,
    effort: str,
    report_dirs: list[Path | str],
    config: WorkflowConfig,
    preflight: Callable[..., tuple[Path, Path]],
) -> tuple[list[str], str]:
    brief_path, common_git_dir = preflight(repo=repo, brief=brief)
    worktree_path = Path(worktree).resolve()
    prompt = f"Read and follow {brief_path}. End with TASK_DONE on its own line."
    writable_dirs = [common_git_dir, brief_path.parent]
    writable_dirs.extend(Path(item).resolve() for item in report_dirs)
    deduped_dirs: list[Path] = []
    for directory in writable_dirs:
        if directory not in deduped_dirs:
            deduped_dirs.append(directory)

    argv = [
        str(config.nohup_bin),
        str(config.codex_bin),
        "exec",
        "--approve-for-me",
        "--json",
        "--model",
        model,
        "-c",
        f'model_reasoning_effort="{effort}"',
        "-C",
        str(worktree_path),
    ]
    for directory in deduped_dirs:
        argv.extend(["--add-dir", str(directory)])
    argv.append(prompt)
    return argv, prompt


def preflight_launch_inputs(
    *,
    repo: Path | str,
    brief: Path | str,
    config: WorkflowConfig,
) -> tuple[Path, Path]:
    """Validate launch dependencies before allocating a worker worktree."""
    if not config.codex_bin.is_file() or not os.access(config.codex_bin, os.X_OK):
        raise CodexWorkflowError(f"required Codex binary is not executable: {config.codex_bin}")
    if not config.nohup_bin.is_file() or not os.access(config.nohup_bin, os.X_OK):
        raise CodexWorkflowError(f"required nohup binary is not executable: {config.nohup_bin}")
    brief_path = Path(brief).resolve()
    if not brief_path.is_file():
        raise CodexWorkflowError(f"brief does not exist: {brief_path}")
    return brief_path, git_common_dir(repo)


def finalize_worker(manifest_path: Path | str, worker_name: str) -> dict[str, Any]:
    data = load_manifest(manifest_path)
    try:
        worker = data["workers"][worker_name]
    except KeyError as exc:
        raise CodexWorkflowError(f"worker not found: {worker_name}") from exc
    parsed = parse_finished_log(worker["log"])
    finished_epoch = time.time()
    launched_epoch = float(worker.get("launched_epoch", finished_epoch))
    status = _terminal_status(parsed)
    updates = {
        "status": status,
        "finished_at": utc_now(),
        "finished_epoch": finished_epoch,
        "wall_seconds": round(max(0.0, finished_epoch - launched_epoch), 3),
        "assistant_result": parsed["assistant_result"],
        "task_done": parsed["task_done"],
        "pr_urls": parsed["pr_urls"],
        "failure_signatures": parsed["failure_signatures"],
        "output_tokens": parsed["output_tokens"],
        "parser_error": parsed["parser_error"],
    }
    update_worker(manifest_path, worker_name, updates)
    return updates


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
    dependencies: LaunchDependencies,
) -> dict[str, Any]:
    name = validate_worker_name(worker_name)
    for pattern in artifacts:
        validate_artifact_pattern(pattern)
    manifest = load_manifest(manifest_path)
    if str(Path(repo).resolve()) != manifest.get("repo") or lead != manifest.get("lead"):
        raise CodexWorkflowError("worker launch does not match manifest repo/lead")
    if name in manifest["workers"]:
        raise CodexWorkflowError(f"worker already exists in manifest: {name}")

    root = Path(run_root).resolve()
    worktree = root / "worktrees" / name
    log_path = root / "logs" / f"{name}.log"
    branch = f"codex-workflows/{manifest['run_id']}-{name}"
    initial_record = {
        "name": name,
        "status": "preparing",
        "branch": branch,
        "worktree": str(worktree),
        "log": str(log_path),
        "brief": str(Path(brief).resolve()),
        "lead": lead,
        "model": model,
        "effort": effort,
        "artifacts": list(artifacts),
        "report_dirs": [str(Path(item).resolve()) for item in report_dirs],
        "degraded_mode": list(DEGRADED_MODE),
        "created_at": utc_now(),
    }
    update_worker(manifest_path, name, initial_record)

    process = None
    try:
        dependencies.preflight(repo=repo, brief=brief)
        default_branch = dependencies.create_worktree(
            repo=repo,
            branch=branch,
            worktree=worktree,
        )
        argv, prompt = dependencies.build_argv(
            repo=repo,
            worktree=worktree,
            brief=brief,
            model=model,
            effort=effort,
            report_dirs=report_dirs,
        )
        header_size = write_log_header(
            log_path,
            {
                "worker": name,
                "lead": lead,
                "model": model,
                "effort": effort,
                "default_branch": default_branch,
            },
        )
        launched_epoch = time.time()
        with log_path.open("ab", buffering=0) as log_handle:
            process = subprocess.Popen(
                argv,
                cwd=worktree,
                stdin=subprocess.DEVNULL,
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        verdict = verify_launch(
            pid=process.pid,
            log_path=log_path,
            initial_size=header_size,
            timeout=launch_timeout,
        )
    except Exception as exc:
        if process is not None and isinstance(exc, CodexWorkflowError):
            update_worker(manifest_path, name, {
                "status": "running", "pid": process.pid, "launched_at": utc_now(),
                "process": {"pid": process.pid, "start_kind": "unobserved"}, "reason": str(exc),
            })
            return {"ok": False, "state": "running", "reason": str(exc), "worker": name}
        update_worker(
            manifest_path,
            name,
            {"status": "failed_launch", "reason": str(exc), "finished_at": utc_now()},
        )
        return {"ok": False, "state": "failed_launch", "reason": str(exc), "worker": name}

    common_updates = {
        "default_branch": default_branch,
        "prompt": prompt,
        "pid": process.pid,
        "launched_at": utc_now(),
        "launched_epoch": launched_epoch,
        "launch_evidence": verdict.get("evidence"),
    }
    if not verdict["ok"]:
        common_updates.update(
            {"status": "failed_launch", "reason": verdict["reason"], "finished_at": utc_now()}
        )
        update_worker(manifest_path, name, common_updates)
        return {**verdict, "worker": name}

    try:
        identity = capture_process_identity(process.pid)
    except _ProcessNotObservable:
        common_updates.update({"status": "completed_fast", "process": None})
        update_worker(manifest_path, name, common_updates)
        finalized = finalize_worker(manifest_path, name)
        return {"ok": finalized["status"] == "completed", "worker": name, **finalized}
    except CodexWorkflowError as exc:
        common_updates.update({"status": "running", "process": {"pid": process.pid, "start_kind": "unobserved"}, "reason": str(exc)})
        update_worker(manifest_path, name, common_updates)
        return {"ok": False, "state": "running", "reason": str(exc), "worker": name}

    common_updates.update({"status": "running", "process": identity})
    update_worker(manifest_path, name, common_updates)
    return {"ok": True, "state": "running", "worker": name, "pid": process.pid}


def cleanup_worker(
    manifest_path: Path | str,
    worker_name: str,
    *,
    delete_branch: bool = False,
    force_unmerged: bool = False,
) -> None:
    data = load_manifest(manifest_path)
    try:
        worker = data["workers"][worker_name]
    except KeyError as exc:
        raise CodexWorkflowError(f"worker not found: {worker_name}") from exc
    identity = worker.get("process")
    if isinstance(identity, dict) and process_identity_alive(identity):
        raise CodexWorkflowError(f"worker is still running: {worker_name}")
    if not worker.get("harvested_at"):
        raise CodexWorkflowError(f"harvest required before cleanup: {worker_name}")

    repo = Path(data["repo"])
    branch = worker["branch"]
    if delete_branch and not force_unmerged:
        default_branch = discover_default_branch(repo)
        ancestor = _run_git(
            repo,
            "merge-base",
            "--is-ancestor",
            branch,
            f"origin/{default_branch}",
            check=False,
        )
        if ancestor.returncode != 0:
            raise CodexWorkflowError(f"refusing to delete unmerged branch: {branch}")

    worktree = Path(worker["worktree"])
    if worktree.exists():
        status = _run_git(
            worktree,
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
        ).stdout
        dirty_entries = [entry for entry in status.split("\0") if entry]
        force_remove = False
        if dirty_entries:
            declared = {
                artifact.relative_to(worktree.resolve()): artifact
                for artifact in resolve_artifacts(worktree, list(worker.get("artifacts", [])))
            }
            harvest_root = Path(worker["harvest_output"]) / "artifacts"
            for entry in dirty_entries:
                if len(entry) < 4 or "R" in entry[:2] or "C" in entry[:2]:
                    raise CodexWorkflowError(
                        f"refusing cleanup with unsupported dirty entry: {entry!r}"
                    )
                relative = Path(entry[3:])
                source = declared.get(relative)
                harvested = harvest_root / relative
                if (
                    source is None
                    or not harvested.is_file()
                    or not filecmp.cmp(source, harvested, shallow=False)
                ):
                    raise CodexWorkflowError(
                        f"refusing cleanup with unharvested dirty path: {relative}"
                    )
            force_remove = True
        remove_args = ["worktree", "remove"]
        if force_remove:
            remove_args.append("--force")
        remove_args.append(str(worktree))
        _run_git(repo, *remove_args, timeout=60.0)
    if delete_branch:
        _run_git(repo, "branch", "-D" if force_unmerged else "-d", branch)
    update_worker(
        manifest_path,
        worker_name,
        {"cleaned_at": utc_now(), "worktree_removed": True, "branch_deleted": delete_branch},
    )
