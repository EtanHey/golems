"""Temp/worktree policy objects, moved verbatim from the executable hook."""
import os
import re


# $TMPDIR token with an identifier boundary: `$TMPDIR/x`, `${TMPDIR}/x`,
# `${TMPDIR:-/tmp}/x`, `${TMPDIR%/}/x` — but not `$TMPDIR_EXTRA`/`${TMPDIR2}`.
_TMPDIR_TOKEN_RE = re.compile(r"^\$(?:TMPDIR(?![A-Za-z0-9_])|\{TMPDIR(?![A-Za-z0-9_]))")

# Rule 2: the ratified in-repo worktree directory name.
WORKTREE_DIR_NAME = ".worktrees"

# Command words that move the shell's cwd, making a relative target
# unresolvable from the hook's own cwd.
_CWD_CHANGING_CMDS = {"cd", "pushd", "popd", "chdir"}


class Unresolvable(Exception):
    """The target cannot be judged statically -> REFUSE with the reason.

    golems#676: git-guardian blocked a legitimate cleanup because it counted
    components of an UNEXPANDED literal. A guard that cannot see the real path
    must not guess — it must say so. #676 answered that with a prompt; the
    2026-08-17 two-valued contract keeps the requirement (name the exact
    resolution failure) and drops the prompt (see refuse_unresolvable)."""


# GO-5 E2: an unresolvable target is only refused when the command itself shows
# a temp hint (`P=$(mktemp); echo x > $P`, `${TMPDIR:-/tmp}/x`). A target that is
# unreadable for any other reason (a conditional assignment, a loop value) gets
# an advisory: an unknown value with no temp hint is not evidence of a temp write.
_TEMP_HINT_RE = re.compile(
    r"\bmktemp\b|\bTMPDIR\w*|/tmp\b|/var/folders\b"
    # GO-5 #226 r2 (lead ruling): library/OS spellings of the temp location.
    r"|\btempfile\b|\bmkdtemp\b|\bgettempdir\b|\bDARWIN_USER_TEMP_DIR\b|\.tmpdir\s*\("
    r"|\$\{?(?:TMP|TEMP)\b"
)
# Literal temp-rooted paths in the command; a harness-scratchpad one is the
# sanctioned location, so it is not a temp hint (the live GO-5 fixture).
_TEMP_PATH_TOKEN_RE = re.compile(r"(?:/private)?(?:/tmp|/var/folders)/[^\s'\";|&)<>]*")


def _has_temp_hint(text):
    unsanctioned = _TEMP_PATH_TOKEN_RE.sub(
        lambda m: "" if is_harness_scratchpad(m.group(0)) else m.group(0), text or ""
    )
    return bool(_TEMP_HINT_RE.search(unsanctioned))


def in_temp_class(raw_path):
    """True if raw_path canonicalizes into the temp path-CLASS."""
    if not isinstance(raw_path, str):
        return False
    s = raw_path.strip().strip('"').strip("'")
    if not s:
        return False
    # A $TMPDIR token (incl. `${TMPDIR:-/tmp}`-style expansions, Codex P1
    # round 9) is temp-intent by definition; an identifier boundary is
    # required so `$TMPDIR_EXTRA`/`${TMPDIR2}` do NOT match (Bugbot Low).
    if _TMPDIR_TOKEN_RE.match(s):
        return True
    if not (s.startswith("/") or s.startswith("~")):
        return False
    # Check BOTH the lexical form and the symlink-resolved form (Bugbot HIGH
    # 6b9b2c5c): a /tmp-shaped path whose symlink resolves to durable storage
    # is still temp-class (the path itself dies on reboot), and a
    # durable-shaped path that resolves INTO the class is caught by realpath.
    expanded = os.path.expanduser(s)
    candidates = {os.path.normpath(expanded)}
    try:
        candidates.add(os.path.realpath(expanded))
    except (OSError, ValueError):
        pass
    prefixes = _temp_prefixes()
    for cand in candidates:
        # The harness session scratchpad is the one sanctioned temp location
        # (see is_harness_scratchpad). Skipping the candidate — rather than
        # returning False outright — keeps the both-forms conservatism above:
        # a scratchpad path whose symlink resolves into the bare temp class
        # is still a temp write, because the OTHER candidate then matches.
        if is_harness_scratchpad(cand, prefixes):
            continue
        for prefix in prefixes:
            if cand == prefix or cand.startswith(prefix + "/"):
                return True
    return False


def on_convention(path):
    """True iff the RESOLVED path sits inside a `.worktrees/` directory.

    Both the lexical and the symlink-resolved forms must conform, so a
    `.worktrees` symlink pointing at a sibling `*.wt` dir is not a route-around."""
    candidates = {os.path.normpath(path)}
    try:
        candidates.add(os.path.normpath(os.path.realpath(path)))
    except (OSError, ValueError):
        pass
    for cand in candidates:
        parts = [p for p in cand.split(os.sep) if p]
        if WORKTREE_DIR_NAME not in parts[:-1]:
            return False
    return True
