from pathlib import Path as _PartsPath
__file__ = str(_PartsPath(__file__).resolve().parent.parent / 'test_tmp_block.py')

"""tmp-block PreToolUse guard — fail-CLOSED deny of durable writes to the temp path-CLASS.

Phase-2 Fix-3 (weave 2026-06-07): B-taxonomy.md §4 Fix-3 [225], adversary verdict
KEEP-with-scope-fix (B-taxonomy-adversary.md [124]): block the CANONICALIZED temp
path-class — /tmp, /private/tmp (macOS symlink), /var/folders, $TMPDIR — across
Write/Edit AND Bash write-shaped commands (heredoc, tee, output redirect,
git worktree add — creation verbs only, never reads), else "S04 recurs one
directory over" (adversary Attack 4 [100]).

FAIL CLOSED per A5 cross-cutting #2 [207]: the S04 half-hook "validated then
allowed" (A5 [21]); any hook validation error must DENY.

Calibration per adversary Attack 5.4 [113]: over-broad guards INDUCE
route-arounds — WEAVE_ALLOW_TMP=1 permits genuinely-ephemeral writes but is
LOGGED to a durable ledger (the log IS the bypass-detector seed).

RED protocol (E14 #500 pattern): run this suite with
TMP_BLOCK_HOOK_UNDER_TEST=$HOME/.claude/hooks/pre_tool_use.py
to replay every fixture against the CURRENT guard stack — it passes the S04
write straight through (pre_tool_use.py [95] explicitly allows /tmp paths with
3+ components). GREEN: default target = the new hook; all denied, escape hatch
allowed-and-logged.

The S04 SUPPRESS fixture is verbatim: Write(/tmp/orqi-tts-answer-msg.md), the
~18:14 break Etan caught live ("Wait, why are we writing those things in
temp?... What the fuck is this?" — orchestrator__10d0e9da [6219], A5 [21]).
"""


import json


import time


import os


import shutil


import subprocess


import sys


from pathlib import Path


import pytest


HOOK = Path(
    os.environ.get(
        "TMP_BLOCK_HOOK_UNDER_TEST",
        str(Path(__file__).resolve().parent.parent / "tmp-block-pretooluse.py"),
    )
).expanduser()


@pytest.fixture
def durable_path(tmp_path):
    """Unique non-temp path for tests whose expected verdict is not Rule 1."""
    path = Path.home() / f".tmp-block-test-{tmp_path.parent.name}-{tmp_path.name}"
    shutil.rmtree(path, ignore_errors=True)
    path.mkdir(parents=True)
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


def run_hook(payload=None, env_extra=None, raw_stdin=None, cwd=None):
    env = os.environ.copy()
    # Deterministic baseline: tests opt IN to the escape hatch / ledger / worker env.
    for var in (
        "WEAVE_ALLOW_TMP",
        "WEAVE_ALLOW_WT_MIGRATION",
        "TMP_BLOCK_LEDGER",
        "CLAUDE_WORKER",
    ):
        env.pop(var, None)
    if env_extra:
        env.update(env_extra)
    data = raw_stdin if raw_stdin is not None else json.dumps(payload)
    return subprocess.run(
        [sys.executable, str(HOOK)],
        input=data,
        capture_output=True,
        text=True,
        env=env,
        cwd=cwd,
        timeout=15,
    )


def assert_denied(proc, must_mention=()):
    assert proc.returncode == 2, (
        f"expected DENY (exit 2), got exit {proc.returncode} "
        f"(stdout={proc.stdout[:300]!r} stderr={proc.stderr[:300]!r})"
    )
    out = json.loads(proc.stdout)
    assert out.get("decision") == "block", f"expected decision=block, got {out!r}"
    reason = out.get("reason", "")
    for needle in must_mention:
        assert needle in reason, f"deny reason must mention {needle!r}, got: {reason!r}"


def _decision(proc):
    """PreToolUse decision carried on stdout, or None for a bare allow."""
    try:
        out = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError:
        return None
    if not isinstance(out, dict):
        return None
    specific = out.get("hookSpecificOutput")
    if isinstance(specific, dict) and specific.get("permissionDecision"):
        return specific["permissionDecision"]
    return out.get("decision")


def _prompt_decision(payload):
    """The `permissionDecision` on a payload, or None. Used by the no-prompt
    tripwires, which forbid the value `ask` — not the key itself, which the
    Codex deny dialect needs (measured/cited 2026-08-19)."""
    specific = payload.get("hookSpecificOutput")
    if isinstance(specific, dict):
        return specific.get("permissionDecision")
    return None


def assert_allowed(proc):
    assert proc.returncode == 0, (
        f"expected ALLOW (exit 0), got exit {proc.returncode} "
        f"(stdout={proc.stdout[:300]!r} stderr={proc.stderr[:300]!r})"
    )
    decision = _decision(proc)
    assert decision in (None, "allow"), (
        f"expected a clean ALLOW, got decision={decision!r} "
        f"(stdout={proc.stdout[:300]!r})"
    )


def assert_advised(proc, must_mention=()):
    """GO-5 E2: an unresolvable target with no temp hint is ALLOWED with an
    advisory systemMessage -- never a block, never a prompt."""
    assert proc.returncode == 0, (
        f"expected ADVISORY (exit 0), got exit {proc.returncode} "
        f"(stdout={proc.stdout[:300]!r} stderr={proc.stderr[:300]!r})"
    )
    out = json.loads(proc.stdout)
    assert "decision" not in out, f"an advisory must not carry a decision: {out!r}"
    # The model reads PreToolUse additionalContext (systemMessage is the human's copy).
    context = out.get("hookSpecificOutput", {})
    assert context.get("hookEventName") == "PreToolUse", out
    assert "permissionDecision" not in context, f"an advisory must not decide: {out!r}"
    message = context.get("additionalContext", "")
    assert message.startswith("TMP-BLOCK advisory"), f"expected an advisory, got {out!r}"
    for needle in must_mention:
        assert needle in message, f"advisory must mention {needle!r}, got: {message!r}"


def assert_refused(proc, must_mention=()):
    """Unresolvable target -> DENY, and never a PROMPT.

    Renamed from `assert_asked` (2026-08-17) because it no longer asserts an
    ask; a helper that says `ask` while checking a block is how the prompt
    path gets reintroduced in good faith. Same contract, same call sites. golems#676 said an unresolvable target
    must not be blind-blocked, and the answer chosen then was a prompt. Etan
    overturned that by voice on 2026-08-17: *"none of y'all would be able to
    write to temp, but also not ask me so we don't get agent stuck"*. A prompt
    strands a headless Codex or Cursor worker forever, because there is no
    human in that pane to answer it; a deny comes back as an error the agent
    reroutes around by itself. #676's real requirement — an actionable reason
    instead of a silent block — is preserved and asserted below.
    """
    assert proc.returncode == 2, (
        f"expected DENY (exit 2), got exit {proc.returncode} "
        f"(stdout={proc.stdout[:300]!r} stderr={proc.stderr[:300]!r})"
    )
    payload = json.loads(proc.stdout)
    assert payload.get("decision") == "block", (
        f"expected decision=block, got {payload.get('decision')!r} "
        f"(stdout={proc.stdout[:300]!r})"
    )
    assert _prompt_decision(payload) != "ask", (
        "an unresolvable target must never emit a PreToolUse prompt: "
        f"{proc.stdout[:300]!r}"
    )
    reason = payload.get("reason", "")
    for needle in must_mention:
        assert needle in reason, f"deny reason must mention {needle!r}, got: {reason!r}"


def write_payload(file_path, content="durable-looking notes"):
    return {
        "tool_name": "Write",
        "tool_input": {"file_path": file_path, "content": content},
        "session_id": "tmp-block-test",
    }


def bash_payload(command):
    return {
        "tool_name": "Bash",
        "tool_input": {"command": command},
        "session_id": "tmp-block-test",
    }


# --- Worktree CONVENTION: in-repo <repo>/.worktrees/<name> only --------------
#
# Ratified by Etan by voice 2026-08-09: the fleet worktree location is the
# in-repo `<repo>/.worktrees/<name>`. The pre-existing guard only judged the
# TEMP path-class, so `git worktree add ~/Gits/foo.wt/bar` sailed through and
# 18 sibling `*.wt` dirs accumulated. Etan's catch, verbatim: "I thought the
# guard's job was to guard it, so it actually goes the right way."
#
# golems#676 lesson, applied: judge the RESOLVED path, never the unexpanded
# literal; never pattern-match prose; if the target cannot be resolved, PROMPT
# instead of blocking blind.

GITS = "/Users/example/Gits"


# --- The harness session scratchpad: the one sanctioned temp location --------
#
# Claude Code's own system prompt tells every session to use
# /private/tmp/claude-<uid>/<repo-slug>/<session-uuid>/scratchpad "for temporary
# files instead of /tmp or other system temp directories". After the 2026-08-17
# two-valued contract, that instruction hit a hard deny — observed live in the
# brainlayerClaude pane (a monitor self-test write) and in skillcreatorClaude.
# Etan's ruling, 2026-08-17: allowlist that scratchpad, keep denying the rest.

SCRATCHPAD_UUID = "8c1f0b2e-5a44-4d19-9f3b-71ac0d2e6f58"


SCRATCHPAD_DIR = (
    f"/private/tmp/claude-501/-Users-example-Gits-brainlayer/"
    f"{SCRATCHPAD_UUID}/scratchpad"
)


# GO-5 #226 r2 (lead ruling 03:14Z): more temp-location words make an
# unresolvable target a hard refusal. Each command carries exactly ONE hint.
TEMP_HINT_WORD_CASES = {
    "tempfile": 'P=$(helper tempfile); printf x > "$P"',
    "mkdtemp": 'P=$(helper mkdtemp); printf x > "$P"',
    "gettempdir": "P=$(python3 -c 'import x; print(x.gettempdir())'); printf x > \"$P/f\"",
    "DARWIN_USER_TEMP_DIR": 'P=$(getconf DARWIN_USER_TEMP_DIR); printf x > "$P/f"',
    "os.tmpdir": "P=$(node -p 'require(\"os\").tmpdir()'); printf x > \"$P/f\"",
    "$TMP": 'printf x > "$TMP/f"',
    "$TEMP": 'printf x > "${TEMP}/f"',
}


__all__ = [name for name in globals() if not name.startswith("__") and name != "_PartsPath"]
