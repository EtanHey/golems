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
    variable holds. Preserve scratch tails such as `$SP/mergetest`, but `Gits`
    could be the protected HOME child. An unresolved in-command assignment also
    loses this allowance. Globs and command substitutions do not qualify.
    """
    if "$(" in target or "`" in target:
        return False
    cursor = 0
    saw_unresolved = False
    assigned_unknown = False
    tail_parts: list[str] = []
    while cursor < len(target):
        if target[cursor] == "$":
            match = shell_var_re.match(target, cursor)
            if match is None:
                return False
            if variables.get(match.group(1) or match.group(2)) is None:
                saw_unresolved = True
                assigned_unknown |= (match.group(1) or match.group(2)) in variables
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
    tail = [part for part in tail_parts if part not in ("", ".")]
    return saw_unresolved and bool(tail) and not assigned_unknown and tail[-1].casefold() != "gits"


def _contains_repo_root(root: str, target: str, within_fn) -> bool:
    """Ancestor identity, including case aliases on insensitive filesystems."""
    if within_fn(root, target):
        return True
    ancestor = root
    while True:
        try:
            if os.path.samefile(ancestor, target):
                return True
        except OSError:
            pass
        parent = os.path.dirname(ancestor)
        if parent == ancestor:
            return False
        ancestor = parent


def _expand_tilde(value: str, variables: dict[str, str]) -> tuple[str, bool]:
    """Shell tilde prefixes from tracked state; never consult passwd for ~user."""
    if not value.startswith("~"):
        return value, True
    head, sep, tail = value.partition("/")
    key = {"~": "HOME", "~+": "PWD", "~-": "OLDPWD"}.get(head)
    root = variables.get(key) if key else None
    if not root or not os.path.isabs(root):
        return "", False
    return root + (sep + tail if sep else ""), True


def _probe_repo_children(target: str, max_depth: int = 3, entry_cap: int = 5000) -> bool:
    """Bounded, non-symlink-following probe; uncertainty protects the container."""
    try:
        os.stat(target)
    except FileNotFoundError:
        return False
    except OSError:
        return True
    pending = [(target, 0)]
    count = 0
    try:
        while pending:
            directory, depth = pending.pop()
            with os.scandir(directory) as entries:
                for entry in entries:
                    count += 1
                    if count >= entry_cap:
                        return True
                    if entry.name.casefold() == ".git":
                        return True
                    if depth < max_depth and entry.is_dir(follow_symlinks=False):
                        pending.append((entry.path, depth + 1))
    except OSError:
        return True
    return False


def _protected_root_reason(resolved, physical, home, cwd, protected_cwd, *,
                           within_fn, outermost_repo_root_fn, is_harness_scratchpad_fn):
    container = os.path.realpath(os.path.join(home, "Gits"))
    if _contains_repo_root(container, physical, within_fn):
        return "rm targeting repo container or its ancestor"
    # Fold spelling as well as identity: APFS aliases may not exist yet.
    for home_root, candidate in ((home, resolved), (os.path.realpath(home), physical)):
        if within_fn(candidate.casefold(), home_root.casefold()):
            parts = os.path.relpath(candidate.casefold(), home_root.casefold()).split(os.sep)
            if len(parts) == 1:
                return "rm targeting top-level home directory"
            if len(parts) == 2 and parts[0] in {".claude", ".codex", ".cmux", ".config", ".ssh", "library"}:
                return "rm targeting agent configuration directory"
    for name in (".claude", ".codex", ".cmux", ".config", ".ssh", "Library"):
        config = os.path.realpath(os.path.join(home, name))
        if _contains_repo_root(config, physical, within_fn):
            return "rm targeting agent configuration root or its ancestor"
        if within_fn(physical.casefold(), config.casefold()):
            relative = os.path.relpath(physical.casefold(), config.casefold())
            if len(relative.split(os.sep)) <= 1:
                return "rm targeting agent configuration directory"
    for anchor in (protected_cwd, cwd):
        if not anchor:
            continue
        active_repo = outermost_repo_root_fn(os.path.realpath(anchor))
        if active_repo is not None and not is_harness_scratchpad_fn(active_repo):
            if physical != active_repo and _contains_repo_root(active_repo, physical, within_fn):
                return "rm targeting ancestor of active repo"
    repo = outermost_repo_root_fn(physical)
    if repo == physical and not is_harness_scratchpad_fn(repo):
        return "rm targeting repo root"
    if within_fn(physical, container) and repo is None and _probe_repo_children(physical):
        return "rm targeting nested repo container or uninspectable container"
    return None


def _rm_target_reason(
    target: str, cwd: str, variables: dict[str, str], *,
    expand_known_vars_fn, literal_tail_fn, outermost_repo_root_fn,
    gitfile_owner_fn, within_fn, is_harness_scratchpad_fn,
    protected_cwd: str | None = None,
    protected_only: bool = False,
) -> str | None:
    literal_parts = [part for part in target.split(os.sep) if part]
    if ".." in literal_parts and not protected_only:
        return f"rm relative parent target too broad: {target}"
    prefix, complete = expand_known_vars_fn(target, variables)
    prefix, tilde_complete = _expand_tilde(prefix, variables)
    if not tilde_complete:
        return "rm tilde target cannot be resolved safely"
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

    # #501: walking UP from a repo parent never encounters its children's .git.
    # Protect the fleet container even outside a checkout, plus ancestors of the
    # initial/current checkout. Resolve aliases for identity and bound descendant
    # probing to the container; keep the nested-fixture breadth boundary.
    physical = os.path.realpath(resolved)
    # Without a trailing slash, rm removes the link itself.
    follows_target = not complete or not os.path.islink(resolved) or prefix.endswith(("/", "/."))
    if follows_target:
        reason = _protected_root_reason(
            resolved, physical, home, cwd, protected_cwd, within_fn=within_fn,
            outermost_repo_root_fn=outermost_repo_root_fn,
            is_harness_scratchpad_fn=is_harness_scratchpad_fn,
        )
        if reason:
            return reason
    if protected_only:
        return None if complete else "rm target cannot be resolved safely"

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
