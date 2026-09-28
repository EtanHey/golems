"""Git command and PR body policy moved from git_safety.py."""

from __future__ import annotations

import posixpath
import re
import shlex

def _norm(path: str) -> str:
    """Normalize a repo-relative path for comparison (`./a`, `a/./b` → `a`, `a/b`).
    posixpath keeps `/` separators since git pathspecs are always POSIX-style."""
    return posixpath.normpath(path)


# ── 2. PR body non-empty ─────────────────────────────────────────────────────────
_HTML_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
# Markdown skeleton lines that carry no real content on their own.
_SKELETON_LINES = {"#", "##", "###", "-", "*", "—", "---", "<!-- -->"}


def pr_body_is_empty(body: str | None, *, api: dict | None = None) -> bool:
    """True when a PR body is effectively empty: None, whitespace, or only template
    comments / bare markdown skeleton lines. Used to block `gh pr create` with no body."""
    if body is None:
        return True
    api = api or globals()
    stripped = api["_HTML_COMMENT"].sub("", body)
    meaningful = [
        line.strip()
        for line in stripped.splitlines()
        if line.strip() and line.strip() not in api["_SKELETON_LINES"]
    ]
    return len(meaningful) == 0


# ── shared git-command parser ─────────────────────────────────────────────────────
# Global options sit BETWEEN `git` and the subcommand (`git -C /repo restore …`,
# `git --no-pager checkout …`, `git -c k=v commit …`). Naively taking the token right
# after `git` as the subcommand misparses these, so split() skips global options (and
# their separate-value args) to find the real subcommand.
_GLOBAL_OPTS_WITH_SEPARATE_VALUE = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"}


def split_git(command: str, *, api: dict | None = None):
    """Return (subcommand, args) for a git invocation, skipping global options, or None
    if `command` is not a git invocation."""
    api = api or globals()
    try:
        tokens = shlex.split(command)
    except ValueError:
        tokens = command.split()
    # Match the git binary by basename, so `/usr/bin/git` and `$(brew --prefix)/bin/git`
    # are recognized too (not just the literal `git` token).
    git_idx = next((j for j, t in enumerate(tokens) if t == "git" or t.endswith("/git")), None)
    if git_idx is None:
        return None
    i = git_idx + 1
    while i < len(tokens):
        token = tokens[i]
        if not token.startswith("-"):
            return token, tokens[i + 1:]
        if token in api["_GLOBAL_OPTS_WITH_SEPARATE_VALUE"]:
            i += 2  # option takes a separate value token
        else:
            i += 1  # flag or inline --opt=value
    return None


# ── 3. --no-verify gate ───────────────────────────────────────────────────────────
_MESSAGE_FLAGS_WITH_VALUE = {"-m", "--message", "-F", "--file"}


def is_unauthorized_no_verify(command: str, authorized: bool = False, *, split_git_fn=None,
                              api: dict | None = None) -> bool:
    """True when a git commit/push uses --no-verify without explicit authorization.

    Matches `--no-verify` as a standalone ARGUMENT token, skipping `-m`/`--message`/
    `-F`/`--file` values — so `--no-verify` inside a commit message is not a false hit.
    For `commit` the short `-n` (and bundled short clusters like `-nm`) is ALSO the
    --no-verify bypass; for `push`, `-n` is --dry-run (safe) so the short form is matched
    for commit only. Global git options are handled via split_git."""
    api = api or globals()
    if authorized:
        return False
    split = (split_git_fn or split_git)(command)
    if split is None:
        return False
    sub, args = split
    if sub not in ("commit", "push"):
        return False
    skip_next = False
    for token in args:
        if skip_next:
            skip_next = False
            continue
        if token in api["_MESSAGE_FLAGS_WITH_VALUE"]:
            skip_next = True
            continue
        if token.startswith("--message=") or token.startswith("--file="):
            continue
        if token == "--no-verify":
            return True
        # commit's `-n` (incl. bundled clusters `-nm`, `-an`) == --no-verify; push -n is
        # --dry-run, so short-flag detection is commit-only. A short cluster is a single
        # dash + letters (never a long `--…` flag).
        if sub == "commit" and re.fullmatch(r"-[A-Za-z]*n[A-Za-z]*", token):
            return True
    return False


# ── 1. Destructive restore of UNOWNED changes ─────────────────────────────────────

def restore_targets(command: str, *, split_git_fn=None) -> list[str] | None:
    """Return the paths a discard-style restore would overwrite, or None if `command`
    is not a WORKING-TREE restore.

    Recognized destructive forms (these discard uncommitted working-tree changes):
      git restore <paths…> | git restore .            (default scope is --worktree)
      git restore --worktree <paths…>
      git checkout -- <paths…> | git checkout . | git checkout -- .
    NOT destructive (return None):
      git restore --staged <paths…>   — unstages only; working tree untouched
      git checkout <branch>           — a branch/ref switch, not a file discard
    Global git options (`git -C /repo restore …`) are handled via split_git."""
    split = (split_git_fn or split_git)(command)
    if split is None:
        return None
    sub, args = split

    if sub == "restore":
        has_staged = "--staged" in args or "-S" in args
        has_worktree = "--worktree" in args or "-W" in args
        # `git restore --staged` (without --worktree) only touches the index — safe.
        if has_staged and not has_worktree:
            return None
        # Collect path args, skipping the VALUE of -s/--source (a tree-ish, not a path);
        # inline `--source=<ref>` is dropped as a flag.
        paths = []
        skip_next = False
        for arg in args:
            if skip_next:
                skip_next = False
                continue
            if arg in ("-s", "--source"):
                skip_next = True
                continue
            if arg.startswith("-"):
                continue
            paths.append(arg)
        return paths or None

    if sub == "checkout":
        # Branch creation/switch flags → never a working-tree discard (precision-bias:
        # a false "destructive" on `git checkout -b feature origin/main` would block a
        # safe op, which is worse than missing an exotic restore form).
        if any(a in ("-b", "-B", "--orphan") for a in args):
            return None
        if "--" in args:
            after = args[args.index("--") + 1:]
            paths = [a for a in after if not a.startswith("-")]
            return paths or None
        nonflag = [a for a in args if not a.startswith("-")]
        if nonflag == ["."]:
            return ["."]
        if len(nonflag) >= 2:
            # `git checkout <ref> <paths…>` restores those paths FROM the ref,
            # discarding working-tree changes — the ref is nonflag[0], paths follow.
            return nonflag[1:]
        # A single arg (or none) = branch/ref switch, not a working-tree discard.
        return None

    return None


def is_destructive_restore(command: str, owned_paths=None, *, restore_targets_fn=None,
                           api: dict | None = None) -> dict:
    """Classify a restore by whether it discards UNOWNED in-session changes.

    owned_paths = paths this session created/modified (safe to discard). A restore is
    destructive when it would overwrite any path NOT in that set — including `.` which
    discards everything. Returns a verdict dict with a `git stash` suggestion."""
    api = api or globals()
    targets = (restore_targets_fn or restore_targets)(command)
    if targets is None:
        return {"destructive": False, "targets": None, "unowned": [], "suggestion": None}

    # Normalize both sides so `./src/app.py`, `src/./app.py` and `src/app.py` compare
    # equal — owned_paths is caller-provided and may use a different spelling.
    owned = {api["_norm"](p) for p in (owned_paths or [])}
    if "." in targets:
        unowned = ["."]  # blanket discard always reaches unowned work
    else:
        unowned = [t for t in targets if api["_norm"](t) not in owned]

    destructive = len(unowned) > 0
    suggestion = None
    if destructive:
        what = " ".join(unowned) if unowned != ["."] else "-- ."
        suggestion = f"git stash push {what}  # preserve unowned changes instead of discarding them"
    return {
        "destructive": destructive,
        "targets": targets,
        "unowned": unowned,
        "suggestion": suggestion,
    }
