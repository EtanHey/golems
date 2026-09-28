"""Path resolution policy for git-guardian rm checks."""

from __future__ import annotations

import os
import re

_SHELL_VAR_RE = re.compile(r"\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))")

def _expand_known_vars(value: str, variables: dict[str, str], shell_var_re) -> tuple[str, bool]:
    """Expand known simple variables; return (literal prefix, fully resolved)."""
    out = []
    cursor = 0
    while cursor < len(value):
        if value.startswith("$(", cursor) or value[cursor] in "`*?{[":
            return "".join(out), False
        if value[cursor] != "$":
            out.append(value[cursor])
            cursor += 1
            continue
        match = shell_var_re.match(value, cursor)
        if match is None:
            return "".join(out), False
        name = match.group(1) or match.group(2)
        replacement = variables.get(name)
        if replacement is None:
            return "".join(out), False
        out.append(replacement)
        cursor = match.end()
    return "".join(out), True


def _outermost_repo_root(path: str) -> str | None:
    """Highest ancestor (or `path` itself) holding a `.git`.

    W16: breadth has to be measured against the OUTERMOST repo, because a nested
    `.git` — a worktree's gitfile, a submodule, a throwaway fixture repo an agent
    just created — otherwise plants a fresh protected boundary deep inside the repo
    the agent is working in. That made `rm -rf <worktree>/.rmcached-proof` read as
    "0 path components" (a whole-repo delete) six levels down, and taught agents to
    route around the guard. The outer repo's boundary still governs, so the main
    checkout's root and its top-level directories stay protected.
    """
    home = os.path.normpath(os.path.expanduser("~"))
    current = os.path.abspath(path)
    outermost = None
    while True:
        # A repo AT or ABOVE $HOME — a dotfiles checkout is the common one — must never
        # become the boundary. It would swallow every real repo underneath it and turn
        # a whole-repo delete into a "deep enough" allow (`~/Gits/<repo>` measures as
        # 2 components against `~`). Home itself is covered by the home-directory rule.
        if (
            current not in (home, os.sep)
            and os.path.exists(os.path.join(current, ".git"))
        ):
            outermost = current
        parent = os.path.dirname(current)
        if parent == current or current == home:
            return outermost
        current = parent


def _within(path: str, root: str) -> bool:
    try:
        return os.path.commonpath((path, root)) == root
    except ValueError:
        return False


def _gitfile_owner(checkout: str) -> str | None:
    """The repo owning a gitfile checkout (`gitdir: <owner>/.git/worktrees/…`)."""
    try:
        with open(os.path.join(checkout, ".git"), encoding="utf-8") as handle:
            line = handle.readline().strip()
    except OSError:
        return None
    if not line.startswith("gitdir:"):
        return None
    gitdir = os.path.normpath(os.path.join(checkout, line[len("gitdir:"):].strip()))
    parts = gitdir.split(os.sep)
    if ".git" not in parts:
        return None
    return os.sep.join(parts[:parts.index(".git")]) or os.sep


def _literal_tail_after_unresolved_var(
    target: str, variables: dict[str, str], shell_var_re
) -> bool:
    """True when `target` ends in a literal path tail below an unresolved `$VAR`.

    W16 / backlog #17: an unexpanded variable is UNKNOWN, never zero-component. A
    literal tail component puts the target at least one level BELOW whatever the
    variable holds, so `$SP/mergetest` can be neither `/` nor the home directory nor
    a bare repo root whatever `$SP` turns out to be. Globs and command substitutions
    do not qualify — those leave the target unknowable in both directions.
    """
    if "$(" in target or "`" in target:
        return False
    cursor = 0
    saw_unresolved = False
    tail_parts: list[str] = []
    while cursor < len(target):
        if target[cursor] == "$":
            match = shell_var_re.match(target, cursor)
            if match is None:
                return False
            if variables.get(match.group(1) or match.group(2)) is None:
                saw_unresolved = True
                tail_parts = []  # only the tail below the LAST unknown counts
            cursor = match.end()
            continue
        char = target[cursor]
        if char in "*?[":
            return False
        if char == "/":
            tail_parts.append("")
        else:
            if not tail_parts:
                tail_parts.append("")
            tail_parts[-1] += char
        cursor += 1
    # "." does not count: `$X/.` resolves straight back to `$X`, which would defeat the
    # one-level-below guarantee the whole allowance rests on.
    return saw_unresolved and any(part not in ("", ".") for part in tail_parts)


def _rm_target_reason(
    target: str, cwd: str, variables: dict[str, str], *,
    expand_known_vars_fn, literal_tail_fn, outermost_repo_root_fn,
    gitfile_owner_fn, within_fn, is_harness_scratchpad_fn,
) -> str | None:
    literal_parts = [part for part in target.split(os.sep) if part]
    if ".." in literal_parts:
        return f"rm relative parent target too broad: {target}"
    prefix, complete = expand_known_vars_fn(target, variables)
    prefix = os.path.expanduser(prefix)
    if not prefix:
        if literal_tail_fn(target, variables):
            return None
        return f"rm target cannot be resolved safely: {target}"
    if os.path.isabs(prefix):
        resolved = os.path.normpath(prefix)
    elif cwd:
        resolved = os.path.normpath(os.path.join(cwd, prefix))
    else:
        return f"rm target cannot be resolved safely: {target}"

    home = os.path.normpath(os.path.expanduser("~"))
    if resolved in ("", "/"):
        return "rm targeting root filesystem"
    if resolved == home:
        return "rm targeting home directory"

    repo = outermost_repo_root_fn(resolved)
    # GO-5 PR-4: a repo living inside the harness session scratchpad (a throwaway
    # clone or rehearsal) is disposable. Matched by the scratchpad's exact
    # structure, never by a substring, so ~/Gits/<repo> stays protected.
    if repo is not None and is_harness_scratchpad_fn(repo):
        repo = None
    if repo is not None:
        # W16: measuring breadth against the OUTERMOST root makes a worktree's own
        # contents disposable (the point of the fix) — but the worktree ROOT itself is
        # still a whole checkout, so guard it by identity rather than by depth. A
        # gitfile `.git` means "checkout belonging to another repo": a worktree or a
        # submodule. A nested independent clone (`.git` is a directory, own object
        # store) is the throwaway-fixture case and stays exempt.
        owner = gitfile_owner_fn(resolved)
        # GO-5 PR-4 (#5): a worktree of a NESTED throwaway clone belongs to that
        # clone, not to the outer checkout, so it is as disposable as the clone.
        nested_owner = owner not in (None, repo) and within_fn(owner, repo)
        if resolved != repo and os.path.isfile(os.path.join(resolved, ".git")) and not nested_owner:
            return (
                "rm target too broad within repo (0 path components): "
                f"{target}"
            )
        relative = os.path.relpath(resolved, repo)
        repo_parts = [
            part
            for part in relative.split(os.sep)
            if part not in ("", ".")
        ]
        if len(repo_parts) < 2:
            return (
                f"rm target too broad within repo ({len(repo_parts)} path components): "
                f"{target}"
            )

    if not complete:
        if repo is None:
            return f"rm target cannot be resolved safely: {target}"
        probe = os.path.normpath(resolved + "__git_guardian_dynamic_suffix__")
        try:
            if os.path.commonpath((repo, probe)) != repo or probe == repo:
                return f"rm target cannot be resolved safely: {target}"
        except ValueError:
            return f"rm target cannot be resolved safely: {target}"
        return None

    parts = [part for part in resolved.split(os.sep) if part]
    if len(parts) < 3:
        return f"rm target too broad ({len(parts)} path components): {target}"
    return None

