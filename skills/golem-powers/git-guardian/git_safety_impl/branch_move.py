"""Moving a checked-out branch: the same effect as `git reset --hard`.

`git branch -f <b>`, `git checkout -B <b>`, `git switch -C <b>` and
`git update-ref refs/heads/<b>` repoint a branch. When <b> is checked out (in
this worktree or a linked one), its commits drop out of the branch just as a
`reset --hard` drops them, so the guard refuses them with the same message.
Moving a branch that no worktree has checked out keeps today's behaviour.
"""

from __future__ import annotations

import os
import subprocess

from .paths import _expand_tilde

# Reads as reset --hard in the hook's operation names; never says "local branch".
REASON = "Dangerous command: moving a checked-out branch is the same as git reset --hard"

_GLOBAL_WITH_VALUE = {"-c", "--namespace", "--exec-path", "--config-env", "--super-prefix"}
_BRANCH_WITH_VALUE = {
    "-u", "--set-upstream-to", "--contains", "--no-contains", "--merged",
    "--no-merged", "--points-at", "--sort", "--format",
}


def _short_flags(word: str) -> str:
    return word[1:] if word.startswith("-") and not word.startswith("--") else ""


def _branch_targets(arguments: list[str]) -> list[str]:
    positionals, flags, long_flags = [], "", set()
    index, options = 0, True
    while index < len(arguments):
        word = arguments[index]
        if options and word == "--":
            options = False
        elif options and word in _BRANCH_WITH_VALUE:
            index += 1
        elif options and word.startswith("--"):
            long_flags.add(word.split("=", 1)[0])
        elif options and word.startswith("-") and word != "-":
            flags += _short_flags(word)
        else:
            positionals.append(word)
        index += 1
    force = "f" in flags or "--force" in long_flags
    if set(flags) & set("dD") or "--delete" in long_flags:
        return []  # deletion has its own rule
    if set(flags) & set("mMcC") or long_flags & {"--move", "--copy"}:
        forced = force or set(flags) & set("MC")
        return [f"refs/heads/{positionals[-1]}"] if forced and positionals else []
    return [f"refs/heads/{positionals[0]}"] if force and positionals else []


def _created_branch(arguments: list[str], short: str, long: str | None = None) -> list[str]:
    for index, word in enumerate(arguments):
        if word == "--":
            break
        if word in (short, long) and index + 1 < len(arguments):
            return [f"refs/heads/{arguments[index + 1]}"]
        if long and word.startswith(long + "="):
            return [f"refs/heads/{word.split('=', 1)[1]}"]
        if word.startswith(short) and len(word) > len(short):
            return [f"refs/heads/{word[len(short):]}"]
    return []


def _update_ref_targets(arguments: list[str]) -> list[str]:
    positionals, no_deref, index = [], False, 0
    while index < len(arguments):
        word = arguments[index]
        if word == "-m":
            index += 1
        elif word == "--no-deref":
            no_deref = True
        elif word == "--stdin":
            return []
        elif not word.startswith("-") or word == "-":
            positionals.append(word)
        index += 1
    if not positionals:
        return []
    ref = positionals[0]
    if ref == "HEAD":
        return [] if no_deref else ["HEAD"]
    return [ref] if ref.startswith("refs/heads/") else []


def _targets(subcommand: str, arguments: list[str]) -> list[str]:
    if subcommand == "branch":
        return _branch_targets(arguments)
    if subcommand == "checkout":
        return _created_branch(arguments, "-B")
    if subcommand == "switch":
        return _created_branch(arguments, "-C", "--force-create")
    if subcommand == "update-ref":
        return _update_ref_targets(arguments)
    return []


def _checked_out(directory: str):
    """(branch refs checked out in any worktree, this worktree's ref) or None if unsure."""
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}

    def read(*args):
        return subprocess.run(["/usr/bin/git", "-c", "core.fsmonitor=false", "-C", directory, *args],
                              env=env, capture_output=True, timeout=1, check=False)

    try:
        listing = read("worktree", "list", "--porcelain", "-z")
        if listing.returncode != 0:
            if b"not a git repository" in listing.stderr:
                return set(), None
            return None
        branches = {os.fsdecode(field[len(b"branch "):])
                    for field in listing.stdout.split(b"\0") if field.startswith(b"branch ")}
        head = read("symbolic-ref", "-q", "HEAD")
        current = os.fsdecode(head.stdout).strip() if head.returncode == 0 else None
        return branches, current
    except (OSError, subprocess.SubprocessError):
        return None


def checked_out_branch_move_reason(api, words: list[str], position: int, cwd: str,
                                   variables: dict[str, str]) -> str | None:
    family = api["git_family"](words[position])
    arguments = words[position + 1:]
    directory = cwd or None
    if family == "":
        index = 0
        while index < len(arguments) and arguments[index].startswith("-"):
            word = arguments[index]
            if word in {"--git-dir", "--work-tree"} or word.startswith(("--git-dir=", "--work-tree=")):
                directory = None  # another repository: cannot be read from here
                index += 1 if "=" in word else 2
                continue
            if word == "-C" and index + 1 < len(arguments):
                expanded, complete = api["_expand_known_vars"](arguments[index + 1], variables)
                expanded, tilde_complete = _expand_tilde(expanded, variables)
                directory = (os.path.join(directory, expanded)
                             if directory and complete and tilde_complete else None)
                index += 2
                continue
            index += 2 if word in _GLOBAL_WITH_VALUE else 1
        if index >= len(arguments):
            return None
        family, arguments = arguments[index], arguments[index + 1:]
    targets = _targets(family, arguments)
    if not targets:
        return None
    if any(variables.get(name) for name in ("GIT_DIR", "GIT_WORK_TREE")):
        return REASON
    if not directory or not os.path.isdir(directory):
        return REASON  # cannot tell which branch is checked out there
    state = _checked_out(directory)
    if state is None:
        return REASON
    branches, current = state
    for target in targets:
        if target == "HEAD" and current is not None:
            return REASON
        if target in branches:
            return REASON
    return None
