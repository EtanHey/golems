"""Worktrees operations for headless Codex workflows."""

from __future__ import annotations

from pathlib import Path
import os
import re
import subprocess
import shutil
import math

from .config import CodexWorkflowError, validate_artifact_pattern


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
    # Skills are also installed standalone; do not depend on the monorepo helper path.
    try:
        floor = float(os.environ.get("GOLEMS_WORKTREE_MIN_FREE_GB", "15"))
        if not math.isfinite(floor) or floor < 0:
            raise ValueError("GOLEMS_WORKTREE_MIN_FREE_GB must be finite and nonnegative")
        parent = worktree_path.parent
        while not parent.exists():
            parent = parent.parent
        free = shutil.disk_usage(parent).free / 1024**3
        if free < floor:
            raise ValueError(f"{free:.1f} GiB free; requires {floor:g} GiB (GOLEMS_WORKTREE_MIN_FREE_GB)")
    except (OSError, ValueError) as exc:
        raise CodexWorkflowError(f"worktree creation refused: {exc}") from exc
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
