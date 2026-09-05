#!/usr/bin/env python3
"""Headless Codex worktree orchestration primitives."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import fcntl
import filecmp
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
from typing import Any, Callable


DEGRADED_MODE = [
    "lead-reachable-only",
    "no-pane",
    "no-listen-name",
    "no-self-monitor",
]
CODEX_BIN = Path(os.environ.get("CODEX_BIN") or shutil.which("codex") or Path.home() / ".local/bin/codex")
NOHUP_BIN = Path("/usr/bin/nohup")
def _default_runs_dir() -> Path:
    """Runs dir lives INSIDE the invoking repo, per the ratified worktree convention.

    Every run creates git worktrees under this directory. A shared worktrees
    root put those worktrees outside their own repo, which (a) violates
    the `<repo>/.worktrees/<name>` convention that repoGolem and the tmp-block guard
    enforce for every other path, and (b) accumulated silently: 36 stray worktrees /
    529MB survived three weave rounds because nothing owning that directory ever pruned
    it. Falls back to the old shared root only when not invoked inside a git repo.
    """
    override = os.environ.get("CODEX_WORKFLOWS_RUNS_DIR")
    if override:
        return Path(override)
    try:
        top = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        if top:
            return Path(top) / ".worktrees" / ".codex-workflows"
    except (subprocess.CalledProcessError, OSError):
        pass
    return Path.home() / "Gits/worktrees/.codex-workflows"


DEFAULT_RUNS_DIR = _default_runs_dir()
SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$")
TERMINAL_STATES = {"completed", "failed", "incomplete", "parser_failed", "failed_launch"}
PR_URL_RE = re.compile(
    r"https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/[0-9]+"
)
LAUNCH_FAILURE_RE = re.compile(
    r"(?:No such file or directory|command not found|couldn't find remote ref|"
    r"invalid reference|failed to fetch|unexpected argument)",
    re.IGNORECASE,
)
LAUNCH_ONLY_EXIT = 75


class CodexWorkflowError(RuntimeError):
    """Raised for an explicit workflow contract failure."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def validate_worker_name(name: str) -> str:
    if not SAFE_NAME_RE.fullmatch(name):
        raise CodexWorkflowError(
            f"unsafe worker name {name!r}; expected {SAFE_NAME_RE.pattern}"
        )
    return name


def validate_artifact_pattern(pattern: str) -> str:
    candidate = Path(pattern)
    if candidate.is_absolute() or ".." in candidate.parts or not pattern:
        raise CodexWorkflowError(f"artifact pattern must be worktree-relative: {pattern!r}")
    return pattern


def resolve_artifacts(worktree: Path | str, patterns: list[str]) -> list[Path]:
    root = Path(worktree).resolve()
    found: list[Path] = []
    for pattern in patterns:
        validate_artifact_pattern(pattern)
        for candidate in sorted(root.glob(pattern)):
            if candidate.is_symlink():
                raise CodexWorkflowError(f"artifact symlink refused: {candidate}")
            resolved = candidate.resolve()
            try:
                resolved.relative_to(root)
            except ValueError as exc:
                raise CodexWorkflowError(f"artifact escapes worktree: {candidate}") from exc
            if resolved.is_file() and resolved not in found:
                found.append(resolved)
    return found


def discover_default_branch(repo: Path | str, timeout: float = 10.0) -> str:
    """Return origin's advertised HEAD branch without assuming main/master."""
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"
    try:
        completed = subprocess.run(
            ["git", "remote", "show", "origin"],
            cwd=Path(repo),
            env=env,
            check=True,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise CodexWorkflowError(f"default-branch discovery failed: {exc}") from exc

    for line in completed.stdout.splitlines():
        match = re.match(r"^\s*HEAD branch:\s*(\S+)\s*$", line)
        if match:
            branch = match.group(1)
            if branch == "(unknown)":
                break
            return branch
    raise CodexWorkflowError("default-branch discovery failed: origin has no HEAD branch")


def _run_git(
    repo: Path | str,
    *args: str,
    check: bool = True,
    timeout: float = 30.0,
) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"
    try:
        return subprocess.run(
            ["git", *args],
            cwd=Path(repo),
            env=env,
            check=check,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise CodexWorkflowError(f"git {' '.join(args)} failed: {exc}") from exc


def git_common_dir(repo: Path | str) -> Path:
    repo_path = Path(repo).resolve()
    value = _run_git(repo_path, "rev-parse", "--git-common-dir").stdout.strip()
    common = Path(value)
    if not common.is_absolute():
        common = repo_path / common
    return common.resolve()


def create_worker_worktree(
    *,
    repo: Path | str,
    branch: str,
    worktree: Path | str,
) -> str:
    repo_path = Path(repo).resolve()
    worktree_path = Path(worktree).resolve()
    if worktree_path.exists():
        raise CodexWorkflowError(f"worktree path already exists: {worktree_path}")
    ref_check = _run_git(repo_path, "check-ref-format", "--branch", branch, check=False)
    if ref_check.returncode != 0:
        raise CodexWorkflowError(f"invalid worker branch: {branch}")
    default_branch = discover_default_branch(repo_path)
    worktree_path.parent.mkdir(parents=True, exist_ok=True)
    _run_git(
        repo_path,
        "worktree",
        "add",
        "-b",
        branch,
        str(worktree_path),
        f"origin/{default_branch}",
        timeout=60.0,
    )
    return default_branch


def build_launch_argv(
    *,
    repo: Path | str,
    worktree: Path | str,
    brief: Path | str,
    model: str,
    effort: str,
    report_dirs: list[Path | str],
) -> tuple[list[str], str]:
    brief_path, common_git_dir = preflight_launch_inputs(repo=repo, brief=brief)
    worktree_path = Path(worktree).resolve()
    prompt = f"Read and follow {brief_path}. End with TASK_DONE on its own line."
    writable_dirs = [common_git_dir, brief_path.parent]
    writable_dirs.extend(Path(item).resolve() for item in report_dirs)
    deduped_dirs: list[Path] = []
    for directory in writable_dirs:
        if directory not in deduped_dirs:
            deduped_dirs.append(directory)

    argv = [
        str(NOHUP_BIN),
        str(CODEX_BIN),
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
) -> tuple[Path, Path]:
    """Validate launch dependencies before allocating a worker worktree."""
    if not CODEX_BIN.is_file() or not os.access(CODEX_BIN, os.X_OK):
        raise CodexWorkflowError(f"required Codex binary is not executable: {CODEX_BIN}")
    if not NOHUP_BIN.is_file() or not os.access(NOHUP_BIN, os.X_OK):
        raise CodexWorkflowError(f"required nohup binary is not executable: {NOHUP_BIN}")
    brief_path = Path(brief).resolve()
    if not brief_path.is_file():
        raise CodexWorkflowError(f"brief does not exist: {brief_path}")
    return brief_path, git_common_dir(repo)


def write_log_header(path: Path | str, metadata: dict[str, Any]) -> int:
    log_path = Path(path)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    fields = " ".join(f"{key}={value}" for key, value in sorted(metadata.items()))
    lines = [
        "# codex-workflows",
        f"# {fields}",
        f"# degraded_mode={','.join(DEGRADED_MODE)}",
    ]
    log_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return log_path.stat().st_size


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


def _ps_value(pid: int, field: str) -> str:
    completed = subprocess.run(
        ["ps", "-p", str(pid), "-o", f"{field}="],
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    if completed.returncode != 0:
        return ""
    return completed.stdout.strip()


def capture_process_identity(pid: int) -> dict[str, Any]:
    """Capture fields that distinguish one process from a reused PID."""
    stat = _ps_value(pid, "stat")
    start_time = _ps_value(pid, "lstart")
    command = _ps_value(pid, "command")
    if not stat or not start_time or not command:
        raise CodexWorkflowError(f"process is not observable: {pid}")
    return {
        "pid": int(pid),
        "stat": stat,
        "start_time": start_time,
        "command": command,
    }


def process_identity_alive(identity: dict[str, Any]) -> bool:
    """Return true only for the same live, non-zombie process."""
    try:
        current = capture_process_identity(int(identity["pid"]))
    except (KeyError, TypeError, ValueError, CodexWorkflowError):
        return False
    if current["stat"].upper().startswith("Z"):
        return False
    return (
        current["start_time"] == identity.get("start_time")
        and current["command"] == identity.get("command")
    )


def _pid_alive(pid: int) -> bool:
    stat = _ps_value(pid, "stat")
    return bool(stat) and not stat.upper().startswith("Z")


def _recognized_event(event: dict[str, Any]) -> bool:
    event_type = event.get("type")
    if event_type == "thread.started":
        return isinstance(event.get("thread_id"), str)
    if event_type == "turn.started":
        return True
    if event_type in {"item.started", "item.completed"}:
        item = event.get("item")
        return (
            isinstance(item, dict)
            and isinstance(item.get("id"), str)
            and isinstance(item.get("type"), str)
        )
    if event_type in {"turn.completed", "turn.failed", "error"}:
        return True
    return False


def _launch_log_evidence(path: Path, initial_size: int) -> dict[str, Any]:
    if not path.exists() or path.stat().st_size <= initial_size:
        return {"activity": False, "failure": None}
    with path.open("rb") as handle:
        handle.seek(initial_size)
        text = handle.read().decode("utf-8", errors="replace")
    activity = False
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("{"):
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                event = None
            if isinstance(event, dict) and _recognized_event(event):
                activity = True
                continue
            if activity:
                continue
        if not activity and LAUNCH_FAILURE_RE.search(line):
            return {"activity": False, "failure": line}
    return {"activity": activity, "failure": None}


def verify_launch(
    *,
    pid: int,
    log_path: Path | str,
    initial_size: int,
    timeout: float,
    identity: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Reject dead false-green launches before reporting a worker."""
    deadline = time.monotonic() + max(timeout, 0.0)
    path = Path(log_path)
    last_evidence = {"activity": False, "failure": None}
    while True:
        last_evidence = _launch_log_evidence(path, initial_size)
        if last_evidence["failure"]:
            return {
                "ok": False,
                "state": "failed_launch",
                "pid": pid,
                "reason": f"launcher diagnostic: {last_evidence['failure']}",
            }
        alive = process_identity_alive(identity) if identity is not None else _pid_alive(pid)
        if last_evidence["activity"]:
            return {
                "ok": True,
                "state": "running" if alive else "completed_fast",
                "pid": pid,
                "evidence": "codex_event",
            }
        now = time.monotonic()
        if now >= deadline:
            if alive:
                return {
                    "ok": True,
                    "state": "running",
                    "pid": pid,
                    "evidence": "process_alive_after_grace",
                }
            return {
                "ok": False,
                "state": "failed_launch",
                "pid": pid,
                "reason": "process exited before Codex activity",
            }
        if not alive:
            time.sleep(min(0.05, max(0.0, deadline - now)))
        else:
            time.sleep(min(0.05, max(0.0, deadline - now)))


def parse_finished_log(path: Path | str) -> dict[str, Any]:
    """Parse a completed Codex JSONL log without trusting tool-output prose."""
    assistant_messages: list[str] = []
    failure_signatures: list[str] = []
    output_tokens = 0
    parser_error: str | None = None
    codex_activity = False

    for line_number, raw_line in enumerate(
        Path(path).read_text(encoding="utf-8", errors="replace").splitlines(), start=1
    ):
        line = raw_line.strip()
        if not line or not line.startswith("{"):
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError as exc:
            parser_error = f"line {line_number}: {exc.msg}"
            continue
        if not isinstance(event, dict) or not _recognized_event(event):
            continue
        codex_activity = True
        event_type = event.get("type")
        if event_type == "item.completed":
            item = event.get("item", {})
            if item.get("type") == "agent_message" and isinstance(item.get("text"), str):
                assistant_messages.append(item["text"])
        elif event_type == "turn.completed":
            usage = event.get("usage")
            if isinstance(usage, dict) and isinstance(usage.get("output_tokens"), int):
                output_tokens = usage["output_tokens"]
        elif event_type in {"turn.failed", "error"}:
            detail = event.get("message") or event.get("error") or event
            failure_signatures.append(str(detail))

    task_done = any(
        line == "TASK_DONE"
        for message in assistant_messages
        for line in message.splitlines()
    )
    pr_urls: list[str] = []
    for message in assistant_messages:
        for url in PR_URL_RE.findall(message):
            if url not in pr_urls:
                pr_urls.append(url)

    return {
        "assistant_messages": assistant_messages,
        "assistant_result": assistant_messages[-1] if assistant_messages else "",
        "task_done": task_done,
        "pr_urls": pr_urls,
        "failure_signatures": failure_signatures,
        "output_tokens": output_tokens,
        "parser_error": parser_error,
        "codex_activity": codex_activity,
    }


def _terminal_status(parsed: dict[str, Any]) -> str:
    if parsed["failure_signatures"]:
        return "failed"
    if parsed["parser_error"]:
        return "parser_failed"
    if parsed["task_done"]:
        return "completed"
    return "incomplete"


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

    try:
        preflight_launch_inputs(repo=repo, brief=brief)
        default_branch = create_worker_worktree(
            repo=repo,
            branch=branch,
            worktree=worktree,
        )
        argv, prompt = build_launch_argv(
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
    except CodexWorkflowError:
        common_updates.update({"status": "completed_fast", "process": None})
        update_worker(manifest_path, name, common_updates)
        finalized = finalize_worker(manifest_path, name)
        return {"ok": finalized["status"] == "completed", "worker": name, **finalized}

    common_updates.update({"status": "running", "process": identity})
    update_worker(manifest_path, name, common_updates)
    return {"ok": True, "state": "running", "worker": name, "pid": process.pid}


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
    launch_fn: Callable[..., dict[str, Any]] | None = None,
    watch_fn: Callable[..., int] | None = None,
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
    launcher = launch_fn or launch_worker
    watcher = watch_fn or watch_manifest
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
    launch_fn: Callable[..., dict[str, Any]] | None = None,
    watch_fn: Callable[..., int] | None = None,
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
    launcher = launch_fn or launch_worker
    watcher = watch_fn or watch_manifest
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


def _add_existing_run_target(parser: argparse.ArgumentParser) -> None:
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--run-id")
    target.add_argument("--manifest")
    parser.add_argument("--run-dir", default=str(DEFAULT_RUNS_DIR))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    agent = subparsers.add_parser("agent", help="launch one verified headless worker")
    agent.add_argument("--repo", required=True)
    agent.add_argument("--name", required=True)
    agent.add_argument("--brief", required=True)
    agent.add_argument("--lead", required=True)
    target = agent.add_mutually_exclusive_group(required=True)
    target.add_argument("--run-id")
    target.add_argument("--manifest")
    agent.add_argument("--run-dir", default=str(DEFAULT_RUNS_DIR))
    agent.add_argument("--model", default="gpt-5.6-luna")
    agent.add_argument("--effort", choices=["xhigh", "max"], default="xhigh")
    agent.add_argument("--report-dir", action="append", default=[])
    agent.add_argument("--artifact", action="append", default=[])
    agent.add_argument("--launch-timeout", type=float, default=3.0)

    watch = subparsers.add_parser("watch", help="watch process exit, then parse logs")
    _add_existing_run_target(watch)
    watch.add_argument("--interval", type=float, default=1.0)
    watch.add_argument(
        "--timeout",
        "--watch-timeout",
        dest="timeout",
        type=float,
        default=3600.0,
    )

    status = subparsers.add_parser("status", help="print a run manifest")
    _add_existing_run_target(status)

    harvest = subparsers.add_parser("harvest", help="copy durable logs and artifacts")
    _add_existing_run_target(harvest)
    harvest.add_argument("--output-dir")

    cleanup = subparsers.add_parser("cleanup", help="remove harvested worktrees")
    _add_existing_run_target(cleanup)
    cleanup.add_argument("--worker", action="append")
    cleanup.add_argument("--delete-branches", action="store_true")
    cleanup.add_argument("--force-unmerged", action="store_true")

    parallel = subparsers.add_parser("parallel", help="launch a validated worker fan-out")
    parallel.add_argument("--spec", required=True)
    parallel.add_argument("--run-id", required=True)
    parallel.add_argument("--run-dir", default=str(DEFAULT_RUNS_DIR))
    parallel.add_argument("--watch", action="store_true")
    parallel.add_argument("--watch-timeout", type=float, default=3600.0)

    pipeline = subparsers.add_parser("pipeline", help="run ordered parallel stages")
    pipeline.add_argument("--spec", required=True)
    pipeline.add_argument("--run-id", required=True)
    pipeline.add_argument("--run-dir", default=str(DEFAULT_RUNS_DIR))
    pipeline.add_argument("--watch-timeout", type=float, default=3600.0)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
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
            result = launch_worker(
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
                code, manifest_path = run_parallel_spec(
                    spec,
                    run_root=run_root,
                    run_id=args.run_id,
                    watch=args.watch,
                    watch_timeout=args.watch_timeout,
                )
            else:
                code, manifest_path = run_pipeline_spec(
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


if __name__ == "__main__":
    raise SystemExit(main())
