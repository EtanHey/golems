"""Config operations for headless Codex workflows."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import os
import re
import subprocess


DEGRADED_MODE = [
    "lead-reachable-only",
    "no-pane",
    "no-listen-name",
    "no-self-monitor",
]


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


@dataclass(frozen=True)
class WorkflowConfig:
    """Executable choices resolved by each facade import, never shared state."""

    codex_bin: Path
    nohup_bin: Path


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


def default_model() -> str:
    """Resolve the stable implementation role at dispatch, including installed links."""
    configured = os.environ.get("GOLEMS_MODEL_ROLES_ROOT")
    roots = [Path(configured)] if configured else Path(__file__).resolve().parents
    root = next((p for p in roots if (p / "scripts/model-roles.mjs").is_file()), None)
    if root is None:
        raise CodexWorkflowError("Missing model-role resolver; set GOLEMS_MODEL_ROLES_ROOT to a golems checkout")
    try:
        result = subprocess.run(
            ["node", str(root / "scripts/model-roles.mjs"), "codex.implement", "--field", "model", "--stable"],
            env={**os.environ, "GOLEMS_MODEL_ROLES_ROOT": str(root)},
            capture_output=True, text=True, check=True, timeout=10,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise CodexWorkflowError("Cannot resolve stable codex.implement model") from error
    model = result.stdout.strip()
    if not model or "\n" in model:
        raise CodexWorkflowError("Invalid model-role resolver output")
    return model
