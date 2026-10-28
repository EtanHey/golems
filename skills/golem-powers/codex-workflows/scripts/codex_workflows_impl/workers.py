"""Workers operations for headless Codex workflows."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
import json
import os
import subprocess
import sys
import tempfile
import time
import uuid

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
)
from .manifest import load_manifest, update_worker
from .process import _ProcessNotObservable, capture_process_identity, process_identity_alive, verify_launch
from .logs import _terminal_status, parse_finished_log, write_log_header


def lifecycle_tool(tool: str, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    root = next((p for p in Path(__file__).resolve().parents
                 if (p / "scripts/workspace/lease.py").is_file()), None)
    if root is None:
        raise CodexWorkflowError("golems lifecycle tools not found")
    try:
        result = subprocess.run([sys.executable, str(root / "scripts/workspace" / tool), *args],
                                text=True, capture_output=True, timeout=120)
    except (OSError, subprocess.SubprocessError) as exc:
        raise CodexWorkflowError(f"{tool} failed: {exc}") from exc
    if check and result.returncode:
        raise CodexWorkflowError(f"{tool} failed: {result.stderr.strip() or result.stdout.strip()}")
    return result


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
        lease_id = "codex-workflows-" + uuid.uuid4().hex
        lifecycle_tool("lease.py", "reserve", "--lease-id", lease_id,
                       "--allocator", "codex-workflows", "--owner", f"{manifest['run_id']}/{name}",
                       "--repo", str(git_common_dir(repo)), "--kind", "worktree",
                       "--ownership", "created", "--branch", branch)
        update_worker(manifest_path, name, {"lease_id": lease_id})
        default_branch = dependencies.create_worktree(
            repo=repo,
            branch=branch,
            worktree=worktree,
        )
        head = _run_git(worktree, "rev-parse", "HEAD").stdout.strip()
        update_worker(manifest_path, name, {"head": head})
        lifecycle_tool("lease.py", "bind", "--lease-id", lease_id, "--path", str(worktree),
                       "--head", head, "--branch", branch)
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

    if not worker.get("lease_id") or not worker.get("head"):
        raise CodexWorkflowError("cleanup requires a bound lease and allocation head")
    worktree = Path(worker["worktree"])
    receipt_path = Path(manifest_path).resolve().parent / f"{worker_name}.retire.json"
    try:
        records = json.loads(lifecycle_tool("lease.py", "audit", "--json").stdout)
        lease = next(record for record in records if record["lease_id"] == worker["lease_id"])
        if (lease["state"] not in {"bound", "closing", "retained"}
                or lease["path"] != str(worktree.resolve())
                or lease["repo_common_dir"] != str(git_common_dir(repo))
                or lease.get("head") != worker["head"]
                or lease["ownership"] != "created" or lease["resource_kind"] != "worktree"
                or lease["allocator"] != "codex-workflows"
                or lease["owner"] != f"{data['run_id']}/{worker_name}"):
            raise ValueError("lease identity or state does not permit retirement")
    except (ValueError, KeyError, TypeError, StopIteration) as exc:
        raise CodexWorkflowError(f"cannot verify lease before retirement: {exc}") from exc

    token_path = Path(manifest_path).resolve().parent / f".{worker_name}.close-token"
    if token_path.is_relative_to(worktree.resolve()):
        raise CodexWorkflowError("close token must be outside the retiring worktree")
    token = None
    if token_path.is_symlink():
        raise CodexWorkflowError("close token symlink refused")
    if token_path.exists():
        if token_path.stat().st_mode & 0o077:
            raise CodexWorkflowError("close token file permissions are not private")
        token = token_path.read_text(encoding="utf-8")
    if lease["state"] == "closing":
        if not token:
            raise CodexWorkflowError("closing lease token unavailable; reconciliation required")
    else:
        if token:
            raise CodexWorkflowError("close token exists but lease is not closing")
        git_root = _run_git(token_path.parent, "rev-parse", "--show-toplevel", check=False)
        if git_root.returncode == 0:
            ignored = _run_git(token_path.parent, "check-ignore", "-q", "--no-index", "--", str(token_path), check=False)
            if ignored.returncode != 0:
                raise CodexWorkflowError("close token path is not verified gitignored")
        elif "not a git repository" not in git_root.stderr.lower():
            raise CodexWorkflowError("cannot verify close token path")
        try:
            result = lifecycle_tool("lease.py", "begin-close", "--lease-id", worker["lease_id"])
            token = json.loads(result.stdout)["close_token"]
            if not isinstance(token, str) or not token:
                raise ValueError("empty close token")
        except CodexWorkflowError as exc:
            update_worker(manifest_path, worker_name, {"retirement_disposition": "RETAINED",
                          "retirement_reason": str(exc), "worktree_removed": False})
            raise
        except (ValueError, KeyError, TypeError) as exc:
            raise CodexWorkflowError(f"invalid begin-close response: {exc}") from exc
        temporary = None
        published = False
        try:
            fd, temporary_name = tempfile.mkstemp(prefix=f".{worker_name}.close-token.", dir=token_path.parent)
            temporary = Path(temporary_name)
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                if git_root.returncode == 0:
                    ignored_temp = _run_git(token_path.parent, "check-ignore", "-q", "--no-index", "--", str(temporary), check=False)
                    if ignored_temp.returncode != 0:
                        raise OSError("temporary close token path is not verified gitignored")
                handle.write(token)
                handle.flush()
                os.fsync(handle.fileno())
            os.rename(temporary, token_path)
            published = True
            dir_fd = os.open(token_path.parent, os.O_RDONLY)
            try:
                os.fsync(dir_fd)
            finally:
                os.close(dir_fd)
        except (OSError, CodexWorkflowError) as exc:
            try:
                lifecycle_tool("lease.py", "abort-close", "--lease-id", worker["lease_id"], "--close-token", token)
            except CodexWorkflowError as abort_error:
                raise CodexWorkflowError(f"cannot preserve close token: {exc}; abort-close failed: {abort_error}; reconciliation required") from exc
            if temporary is not None and temporary.exists():
                temporary.unlink()
            if published:
                token_path.unlink()
            raise CodexWorkflowError(f"cannot preserve close token; close aborted: {exc}") from exc

    if receipt_path.is_symlink():
        raise CodexWorkflowError("retirement receipt symlink refused")
    existing_receipt = receipt_path.exists()
    if existing_receipt:
        try:
            receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
            if (receipt.get("schema") != "workspace-lifecycle/receipt/v1"
                    or receipt.get("path") != lease["path"]
                    or receipt.get("repo_common_dir") != lease["repo_common_dir"]):
                raise ValueError("receipt identity mismatch")
            if receipt.get("disposition") == "RETAINED":
                if not isinstance(receipt.get("reason"), str) or not receipt["reason"].strip():
                    raise ValueError("retained receipt missing reason")
            elif (receipt.get("disposition") != "REMOVED"
                    or receipt.get("registered_after") is not False
                    or receipt.get("physical_after") is not False
                    or type(receipt.get("remove_rc")) is not int or receipt["remove_rc"] != 0):
                raise ValueError("receipt removal proof mismatch")
            if receipt["disposition"] == "REMOVED":
                try:
                    os.lstat(worktree)
                except FileNotFoundError:
                    pass
                else:
                    raise ValueError("retired path exists again")
        except (OSError, ValueError, TypeError) as exc:
            raise CodexWorkflowError(f"cannot resume retirement receipt: {exc}") from exc
    else:
        result = lifecycle_tool("retire.py", "--repo", str(repo), "--path", str(worktree),
                                "--expect-head", worker["head"], "--receipt-out", str(receipt_path), check=False)
        try:
            receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
            if receipt["disposition"] not in {"REMOVED", "RETAINED"} or (receipt["disposition"] == "REMOVED" and result.returncode != 0):
                raise ValueError("invalid retirement outcome")
        except (OSError, ValueError, KeyError, TypeError) as exc:
            raise CodexWorkflowError(f"retirement receipt unavailable or invalid: {exc}; {result.stderr.strip()}") from exc

    disposition = receipt["disposition"]
    reason = receipt["reason"]
    update_worker(manifest_path, worker_name, {"retirement_disposition": disposition,
                  "retirement_reason": reason, "retirement_receipt": str(receipt_path),
                  "worktree_removed": disposition == "REMOVED"})
    if disposition == "RETAINED":
        if existing_receipt:
            lifecycle_tool("lease.py", "close", "--lease-id", worker["lease_id"], "--close-token", token, "--retained", reason)
        else:
            lifecycle_tool("lease.py", "abort-close", "--lease-id", worker["lease_id"], "--close-token", token)
        token_path.unlink()
        raise CodexWorkflowError(f"worktree retained: {reason}")
    lifecycle_tool("lease.py", "close", "--lease-id", worker["lease_id"],
                   "--close-token", token, "--receipt", str(receipt_path))
    token_path.unlink()
    if delete_branch:
        _run_git(repo, "branch", "-D" if force_unmerged else "-d", branch)
    update_worker(
        manifest_path,
        worker_name,
        {"cleaned_at": utc_now(), "worktree_removed": True, "branch_deleted": delete_branch},
    )
