"""Moving a checked-out branch: the same effect as `git reset --hard`.

`git branch -f <b>`, `git checkout -B <b>`, `git switch -C <b>` and
`git update-ref refs/heads/<b>` repoint a branch, and so do the
`update|create|delete` lines `git update-ref --stdin` reads. When <b> is checked out (in
this worktree or a linked one), its commits drop out of the branch just as a
`reset --hard` drops them, so the guard refuses them with the same message.
Moving a branch that no worktree has checked out keeps today's behaviour.
When the command does not show update-ref's stdin (a `<` file, an unseen
producer), the guard cannot tell which branches it moves and refuses.
"""

from __future__ import annotations

import os
import subprocess

from .paths import _expand_tilde
from .branch_aliases import (AliasUnknown, git_alias, shell_alias_bodies,
                             alias_input_is_unseen, inspect_shell_alias, shell_alias_context_uncertain)
from .update_ref_stdin import ANY_REF, NO_DEREF, visible_targets, with_raw_command

# Reads as reset --hard in the hook's operation names; never says "local branch".
REASON = "Dangerous command: moving a checked-out branch is the same as git reset --hard"
# The hook adds its own sentence for this case; keep the "update-ref --stdin input" needle.
STDIN_UNSEEN_REASON = (REASON + "; the update-ref --stdin input is not in the command, "
                       "so the guard cannot tell which branches it moves")
_STDIN = "\0stdin"

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
    index = 0
    while index < len(arguments):
        word = arguments[index]
        index += 1
        if word == "--":
            break
        if long and word.startswith(long + "="):
            return [f"refs/heads/{word.split('=', 1)[1]}"]
        if long and word == long:
            return [f"refs/heads/{arguments[index]}"] if index < len(arguments) else []
        if word.startswith('-') and not word.startswith('--'):
            for offset, flag in enumerate(word[1:], 2):
                if flag in {short[1], 'b' if short == '-B' else 'c'}:
                    operand = word[offset:] or (arguments[index] if index < len(arguments) else '')
                    if flag == short[1] and operand:
                        return [f"refs/heads/{operand}"]
                    if offset == len(word):
                        index += 1  # non-forced create option consumes its branch name
                    break
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
            return [_STDIN + ("-no-deref" if "--no-deref" in arguments else "")]
        elif not word.startswith("-") or word == "-":
            positionals.append(word)
        index += 1
    if not positionals:
        return []
    ref = positionals[0]
    if ref == "HEAD":
        return [] if no_deref else ["HEAD"]
    return [(NO_DEREF if no_deref else "") + ref]


def _targets(subcommand: str, arguments: list[str]) -> list[str]:
    if subcommand == "branch":
        return _branch_targets(arguments)
    if subcommand == "checkout":
        return _created_branch(arguments, "-B")
    if subcommand == "switch":
        return _created_branch(arguments, "-C", "--force-create")
    if subcommand == "update-ref":
        return _update_ref_targets(arguments)
    if subcommand == "symbolic-ref":
        # Creating an alias to a checked-out ref can make a subsequent update
        # destructive in the same call. Check the destination as well as name.
        positionals = []
        index = 0
        while index < len(arguments):
            word = arguments[index]
            if word == "-m":
                index += 2
                continue
            if not word.startswith('-'):
                positionals.append(word)
            index += 1
        return positionals if len(positionals) >= 2 else []
    return []


def _resolved_ref(directory: str, ref: str) -> str | None:
    """Resolve existing symref chains; rc=1 means a literal, nonsymbolic ref.

    Git resolves the chain and rejects cycles. Any other failure is unknown.
    No user config helpers or inherited Git environment are used.
    """
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    try:
        result = subprocess.run(
            ["/usr/bin/git", "-c", "core.fsmonitor=false", "-C", directory,
             "symbolic-ref", "-q", "--", ref],
            env=env, capture_output=True, timeout=1, check=False)
        if result.returncode == 1:
            return ref
        if result.returncode == 0:
            return os.fsdecode(result.stdout).strip() or None
    except (OSError, subprocess.SubprocessError):
        pass
    return None


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
                                   variables: dict[str, str], *, depth: int = 0,
                                   git_environment: dict | None = None) -> str | None:
    git_environment = variables if git_environment is None else git_environment
    alias_bodies = shell_alias_bodies(words[position])
    if alias_bodies and any(key.startswith('GIT_') and value != variables.get(key)
                            for key, value in git_environment.items()):
        return REASON  # command-local Git environment is not argv expansion state
    for body in alias_bodies:
        try:
            blocked, reason = inspect_shell_alias(api, body, cwd, variables, depth)
        except AliasUnknown:
            return REASON
        if blocked:
            return reason
    family = api["git_family"](words[position])
    arguments = words[position + 1:]
    directory = None if shell_alias_context_uncertain() else (cwd or None)
    configs = []
    if family == "":
        index = 0
        while index < len(arguments) and arguments[index].startswith("-"):
            word = arguments[index]
            if word == "-c" and index + 1 < len(arguments):
                configs.append(arguments[index + 1])
                index += 2
                continue
            if word.startswith("-c") and len(word) > 2:
                configs.append(word[2:])
                index += 1
                continue
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
    if family is not None and family not in {"branch", "checkout", "switch", "update-ref", "symbolic-ref"}:
        try:
            expanded = git_alias(family, arguments, directory, configs, config_unknown=(
                any(word.startswith('--config-env') for word in words[position + 1:])
                or any(key.startswith('GIT_CONFIG') and value for key, value in git_environment.items())))
        except AliasUnknown:
            return REASON
        if expanded:
            family, arguments = expanded[0], expanded[1:]
    literal_targets = _targets(family, arguments)
    options = arguments[:arguments.index("--")] if "--" in arguments else arguments
    if (family == "branch" and "--list" in options and not literal_targets
            and not any("$" in word or "`" in word for word in arguments)):
        return None  # a literal listing pattern is data, not a mutation option

    # An expansion may supply the force option itself (or an entire argv array),
    # before literal target extraction has a chance to recognize the mutation.
    if family in {"branch", "checkout", "switch", "update-ref", "symbolic-ref"}:
        resolved = []
        for index, word in enumerate(arguments):
            if word == "--":
                resolved.extend(arguments[index:])
                break
            if any(char in word for char in "$`*?[]{}\\"):
                word, complete = api["_expand_known_vars"](word, variables)
                if not complete or not word or any(char.isspace() or char in "$`*?[]{}\\" for char in word):
                    return REASON
            resolved.append(word)
        arguments = resolved
    targets = _targets(family, arguments)
    if not targets:
        return None
    stdin = targets[0].startswith(_STDIN)
    if stdin:
        if alias_input_is_unseen():
            return STDIN_UNSEEN_REASON
        targets = visible_targets(no_deref=targets[0].endswith("-no-deref"))
        if targets == []:
            return None
    # Quote provenance is intentionally read conservatively. An operand such as
    # '$REF' can be a literal symbolic ref even when REF has a known assignment.
    # Check that spelling as well as the expanded argv, without treating an
    # unexpanded stdin marker as a ref.
    literal_targets = {target for target in literal_targets
                       if targets is not None and target not in targets
                       and not target.startswith(_STDIN)}
    if targets is not None:
        targets = targets + list(literal_targets)
    if any(git_environment.get(name) for name in ("GIT_DIR", "GIT_WORK_TREE")):
        return REASON
    if not directory or not os.path.isdir(directory):
        return REASON  # cannot tell which branch is checked out there
    state = _checked_out(directory)
    if state is None:
        return REASON
    branches, current = state
    if targets is None or ANY_REF in targets:
        if branches or current is not None:
            return REASON if targets is not None else STDIN_UNSEEN_REASON
        return None
    for target in targets:
        literal_target = target in literal_targets
        no_deref = target.startswith(NO_DEREF)
        if no_deref:
            target = target[len(NO_DEREF):]
        # The shell parser preserves unresolved expansions in operand spelling.
        # Do not compare them as if they were literal branch/ref names.
        if not literal_target and any(char in target for char in "$`*?[]{}\\"):
            return REASON
        if not no_deref:
            target = _resolved_ref(directory, target)
            if target is None:
                return REASON
        if target == "HEAD" and current is not None:
            return REASON
        if target in branches:
            return REASON
    return None
