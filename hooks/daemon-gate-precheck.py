#!/usr/bin/env python3
"""Block admin PR merges for VoiceLayer daemon changes without runtime proof."""

from __future__ import annotations

import glob
import json
import os
import shlex
import subprocess
import sys
from pathlib import Path


DAEMON_PREFIXES = ("flow-bar/", "launchd/")
DAEMON_EXACT = {
    "src/whisper-server.ts",
    "src/mcp-daemon.ts",
    "src/mcp-framing.ts",
    "src/mcp-handler.ts",
    "src/mcp-socket-owner.ts",
    "src/mcp-tools.ts",
    "src/daemon.ts",
    "src/daemon-health.ts",
    "src/log-rotation.ts",
    "src/paths.ts",
    "src/process-lock.ts",
    "src/resolve-binary.ts",
    "src/socket-client.ts",
    "src/socket-handlers.ts",
    "src/socket-protocol.ts",
    "src/cli/voicelayer.sh",
}


def allow() -> None:
    json.dump({}, sys.stdout)
    sys.exit(0)


def block(reason: str) -> None:
    json.dump({"decision": "block", "reason": reason}, sys.stdout)
    sys.exit(2)


def run(cmd: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=str(cwd), text=True, capture_output=True, check=False)


def repo_root(start: Path) -> Path | None:
    result = run(["git", "rev-parse", "--show-toplevel"], start)
    if result.returncode != 0:
        return None
    return Path(result.stdout.strip())


def is_voicelayer_repo(root: Path) -> bool:
    """Scope the gate to the VoiceLayer repo ONLY.

    The DAEMON_PREFIXES (esp. ``launchd/``) and several src/ names are generic
    dir/file names that also occur in other repos (e.g. mcplayer ships
    ``launchd/com.mcplayer.bus.plist``). Without this check the VoiceLayer F5
    dictation gate false-fires on ANY repo's admin merge. Match via the git
    remote so VoiceLayer worktrees (voicelayer-*) still gate correctly.
    """
    result = run(["git", "remote", "get-url", "origin"], root)
    if result.returncode == 0 and "voicelayer" in result.stdout.strip().lower():
        return True
    # Fallback for a remote-less checkout: match the repo dir name.
    return root.name.lower().startswith("voicelayer")


def is_admin_pr_merge(command: str) -> bool:
    if "gh" not in command or "pr" not in command or "merge" not in command or "--admin" not in command:
        return False
    try:
        tokens = shlex.split(command)
    except ValueError:
        return False
    for i in range(len(tokens) - 2):
        if tokens[i] == "gh" and tokens[i + 1] == "pr" and tokens[i + 2] == "merge":
            return "--admin" in tokens[i + 3 :]
    return False


def pr_selector(command: str) -> str | None:
    try:
        tokens = shlex.split(command)
    except ValueError:
        return None
    for i in range(len(tokens) - 2):
        if tokens[i] == "gh" and tokens[i + 1] == "pr" and tokens[i + 2] == "merge":
            skip_value = False
            for token in tokens[i + 3 :]:
                if skip_value:
                    skip_value = False
                    continue
                if token == "--":
                    return None
                if token in ("--repo", "-R"):
                    skip_value = True
                    continue
                if not token.startswith("-"):
                    return token
            return None
    return None


def explicit_repo(command: str) -> str | None:
    """Return the --repo/-R value of the gh pr merge invocation, if any.

    Without this, a cross-repo merge run from a VoiceLayer cwd resolves the
    bare PR number against VoiceLayer and false-fires on an unrelated repo's
    PR (2026-07-17: orchestrator#95 blocked on voicelayer#95's diff).
    """
    try:
        tokens = shlex.split(command)
    except ValueError:
        return None
    for i, token in enumerate(tokens):
        if token in ("--repo", "-R") and i + 1 < len(tokens):
            return tokens[i + 1]
        if token.startswith("--repo="):
            return token.split("=", 1)[1]
    return None


def daemon_path(path: str) -> bool:
    if any(path.startswith(prefix) for prefix in DAEMON_PREFIXES):
        return True
    if path in DAEMON_EXACT:
        return True
    name = Path(path).name
    if path.startswith("src/") and name.startswith("mcp-server") and name.endswith(".ts"):
        return True
    if path.startswith("src/") and name.startswith("socket-") and name.endswith(".ts"):
        return True
    return False


def current_head_sha(root: Path) -> str | None:
    result = run(["git", "rev-parse", "HEAD"], root)
    if result.returncode != 0:
        return None
    return result.stdout.strip()


def current_branch_changed_files(root: Path) -> list[str]:
    base_ref = os.environ.get("VOICELAYER_DAEMON_GATE_BASE_REF")
    candidates = [base_ref] if base_ref else ["origin/main", "main", "HEAD~1"]
    for candidate in candidates:
        if not candidate:
            continue
        merge_base = run(["git", "merge-base", "HEAD", candidate], root)
        if merge_base.returncode == 0 and merge_base.stdout.strip():
            diff = run(["git", "diff", "--name-only", f"{merge_base.stdout.strip()}...HEAD"], root)
            if diff.returncode == 0:
                return [line for line in diff.stdout.splitlines() if line]
        diff = run(["git", "diff", "--name-only", f"{candidate}...HEAD"], root)
        if diff.returncode == 0:
            return [line for line in diff.stdout.splitlines() if line]
    return []


def pr_changed_files(root: Path, selector: str) -> tuple[list[str], str | None]:
    diff = run(["gh", "pr", "diff", selector, "--name-only"], root)
    view = run(["gh", "pr", "view", selector, "--json", "headRefOid", "--jq", ".headRefOid"], root)
    if diff.returncode != 0 or view.returncode != 0:
        return current_branch_changed_files(root), current_head_sha(root)
    return [line for line in diff.stdout.splitlines() if line], view.stdout.strip()


def has_runtime_artifact(root: Path, sha: str) -> bool:
    if not sha:
        return False
    short = sha[:7]
    verified_dir = root / ".verified"
    candidates = glob.glob(str(verified_dir / f"verified-runtime-*-{short}.txt"))
    candidates.extend(glob.glob(str(verified_dir / "verified-runtime-*.txt")))
    marker = f"Verified-Runtime: {sha}"
    for candidate in candidates:
        try:
            if marker in Path(candidate).read_text():
                return True
        except OSError:
            continue
    return False


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        allow()

    if payload.get("tool_name") != "Bash":
        allow()

    command = payload.get("tool_input", {}).get("command", "")
    if not is_admin_pr_merge(command):
        allow()

    start = Path(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())
    root = repo_root(start)
    if root is None:
        allow()

    # Gate applies ONLY to the VoiceLayer repo — never false-fire on other
    # repos that happen to have a launchd/ dir or matching src/ filenames.
    if not is_voicelayer_repo(root):
        allow()

    # An explicit --repo/-R targeting a NON-voicelayer repo is a cross-repo
    # merge; the cwd-derived root is irrelevant to it.
    target_repo = explicit_repo(command)
    if target_repo and "voicelayer" not in target_repo.lower():
        allow()

    selector = pr_selector(command)
    if selector:
        files, sha = pr_changed_files(root, selector)
    else:
        files, sha = current_branch_changed_files(root), current_head_sha(root)

    daemon_files = [path for path in files if daemon_path(path)]
    if not daemon_files:
        allow()

    if sha and has_runtime_artifact(root, sha):
        allow()

    daemon_list = "\n".join(f"  - {path}" for path in daemon_files[:20])
    expected = f"Verified-Runtime: {sha}" if sha else "Verified-Runtime: <head-sha>"
    block(
        "BLOCKED: NON-NEGOTIABLE DAEMON VERIFICATION GATE violated.\n\n"
        "You attempted `gh pr merge --admin` for a branch/PR that touches VoiceLayer "
        "daemon/socket/MCP files without a matching runtime verification artifact.\n\n"
        f"Changed daemon files:\n{daemon_list}\n\n"
        "Required remediation:\n"
        "1. Run `./scripts/voicelayer-verify.sh` from the VoiceLayer repo.\n"
        "2. Rebuild/relaunch VoiceBar when prompted.\n"
        "3. Press F5 in the real VoiceBar client, speak `verification test`, release, and confirm paste fired.\n"
        f"4. Ensure `.verified/` contains an artifact with `{expected}`.\n"
        "5. Add the same `Verified-Runtime: <sha>` line to the PR body before merging.\n\n"
        "If you used --admin without the verify artifact, brain_store the violation immediately as an orc-correction."
    )


if __name__ == "__main__":
    main()
