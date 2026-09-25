"""Harness path shapes shared by golems PreToolUse hooks (GO-5 PR-4).

Moved verbatim from tmp-block/hooks/tmp-block-pretooluse.py so git-guardian's
rm guard can use the same STRUCTURAL scratchpad check instead of a substring.
"""

import os
import re


def _temp_prefixes():
    """The canonicalized temp path-CLASS. realpath() both the literal and the
    resolved form so /tmp (symlink) and /private/tmp (canonical) both match."""
    prefixes = {"/tmp", "/private/tmp", "/var/folders", "/private/var/folders"}
    tmpdir = os.path.expanduser(os.environ.get("TMPDIR", "")).rstrip("/")
    if tmpdir:
        prefixes.add(tmpdir)
    out = set()
    for p in prefixes:
        p = p.rstrip("/")
        if not p:
            continue
        out.add(p)
        try:
            out.add(os.path.realpath(p).rstrip("/"))
        except (OSError, ValueError):
            pass
    # Never let a pathological TMPDIR ("/") turn this into a deny-everything.
    out.discard("")
    out.discard("/")
    return out


# ── The one sanctioned temp location: the harness session scratchpad ─────────
#
# Claude Code's own system prompt hands every session a scratchpad directory
# and instructs it, verbatim: "IMPORTANT: Always use this scratchpad directory
# for temporary files instead of /tmp or other system temp directories". The
# path it supplies lives INSIDE the class this guard denies:
#
#     /private/tmp/claude-<uid>/<repo-slug>/<session-uuid>/scratchpad/...
#
# So the harness says "put temp files here" and, after the 2026-08-17
# two-valued contract turned the prompt into a hard deny, the guard says no.
# Observed live 2026-08-17: brainlayerClaude took two consecutive denials
# arming a monitor (`mktemp`, then a scratchpad self-test write), and
# skillcreatorClaude hit the same wall writing a test fixture earlier the same
# day. Every agent walks into it indefinitely, because they are following
# instructions correctly — a false positive at fleet scale.
#
# Etan's ruling, 2026-08-17: allowlist the harness session scratchpad, keep
# denying every other temp path. The scratchpad is session-scoped and nothing
# durable belongs there, so allowing it costs nothing Rule 1 was protecting.
#
# The exception is deliberately narrow and STRUCTURAL — never a hardcoded uid
# or session id, and never a widening of _temp_prefixes(). The whole
# `claude-<uid>/<slug>/<session-uuid>/scratchpad` component chain must sit
# directly under a temp root, so `/private/tmp/scratchpad/x.txt` (no session
# chain) and `/private/tmp/claude-501/x.txt` (no scratchpad component) still
# deny, and `$(mktemp)` — a bare temp path with no chain at all, one of the
# three live escapes #726 closed — stays denied.
_CLAUDE_UID_DIR_RE = re.compile(r"^claude-\d+$")


_SESSION_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


HARNESS_SCRATCHPAD_DIR = "scratchpad"


def is_harness_scratchpad(path, prefixes=None):
    """True if `path` is the harness's session scratchpad, or lives under it.

    Matches the structure, not any particular session: `claude-<digits>`, then
    a repo-slug component, then a session UUID, then `scratchpad` — all four
    immediately below a temp root. Every component check is exact: a `pad`
    match relaxed to a substring opens `.../<uuid>/scratchpad-evil/`, and a
    dropped uid-shape check opens `/private/tmp/<anything>/<slug>/<uuid>/
    scratchpad/`. Both are pinned by tests (#727 review found both mutations
    surviving the suite).

    `..` traversal is NOT defended here. It is defended by the callers, which
    is where the path is canonicalized: in_temp_class normalizes each candidate
    (normpath AND realpath) before asking this function about it, so
    `.../scratchpad/../../../../leak.txt` arrives as `/private/tmp/leak.txt`
    and never matches the shape; _literal_prefix_class rejects a literal `..`
    component outright before it builds a probe. The normalization below is
    defense-in-depth for a future direct caller — removing it leaves the suite
    green and opens no hole (#727 review, mutation M5).
    """
    if not isinstance(path, str):
        return False
    s = path.strip().strip('"').strip("'")
    if not s:
        return False
    cand = os.path.normpath(os.path.expanduser(s))
    if not cand.startswith("/"):
        return False
    if prefixes is None:
        prefixes = _temp_prefixes()
    for prefix in prefixes:
        if not cand.startswith(prefix + "/"):
            continue
        rest = cand[len(prefix) + 1:].split("/")
        if len(rest) < 4:
            continue
        uid_dir, slug, session, pad = rest[0], rest[1], rest[2], rest[3]
        if (
            _CLAUDE_UID_DIR_RE.match(uid_dir)
            and slug
            and slug not in (".", "..")
            and _SESSION_UUID_RE.match(session)
            and pad == HARNESS_SCRATCHPAD_DIR
        ):
            return True
    return False
