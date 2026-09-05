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


# --- Write/Edit: the canonicalized temp path-CLASS ---------------------------


def test_s04_replay_write_tmp_denied():
    """S04 verbatim replay: Write(/tmp/orqi-tts-answer-msg.md) must DENY and
    redirect to the durable alternative (docs.local/ or the repo)."""
    proc = run_hook(
        write_payload(
            "/tmp/orqi-tts-answer-msg.md",
            "ORQI TTS answer draft — durable content that belongs in collab/docs.local",
        )
    )
    assert_denied(proc, must_mention=("docs.local",))


def test_write_private_tmp_denied():
    """/tmp is a symlink on macOS — the canonical form must be caught too
    (adversary Attack 4 route 2)."""
    proc = run_hook(write_payload("/private/tmp/orqi-tts-answer-msg.md"))
    assert_denied(proc, must_mention=("docs.local",))


def test_write_var_folders_denied():
    """macOS's real temp realm (adversary Attack 4 route 1)."""
    proc = run_hook(write_payload("/var/folders/zz/abcdefgh1234/T/scratch-notes.md"))
    assert_denied(proc)


def test_write_tmpdir_env_denied():
    """$TMPDIR is part of the path-CLASS even when it points somewhere custom —
    the class comes from the env, not a hardcoded list."""
    fake_tmpdir = os.path.expanduser("~/.tmp-block-test-faketmpdir")
    proc = run_hook(
        write_payload(fake_tmpdir + "/notes.md"),
        env_extra={"TMPDIR": fake_tmpdir},
    )
    assert_denied(proc)


def test_edit_tmp_denied():
    proc = run_hook(
        {
            "tool_name": "Edit",
            "tool_input": {
                "file_path": "/tmp/plan.md",
                "old_string": "a",
                "new_string": "b",
            },
            "session_id": "tmp-block-test",
        }
    )
    assert_denied(proc)


def test_worker_env_does_not_bypass():
    """Cover every actor (A5 cross-cutting #3): S04's violator WAS a worker.
    CLAUDE_WORKER must not exempt."""
    proc = run_hook(
        write_payload("/tmp/orqi-tts-answer-msg.md"),
        env_extra={"CLAUDE_WORKER": "1"},
    )
    assert_denied(proc)


# --- Bash: write-shaped commands only (creation verbs, never reads) ----------


def test_bash_heredoc_redirect_tmp_denied():
    proc = run_hook(
        bash_payload(
            "cat <<'EOF' > /tmp/scratch-notes.md\nplan: ship fix-3\nEOF"
        )
    )
    assert_denied(proc, must_mention=("docs.local",))


def test_bash_tee_tmp_denied():
    proc = run_hook(bash_payload("echo findings | tee /tmp/findings.md"))
    assert_denied(proc)
    proc = run_hook(bash_payload("echo more | tee -a /private/tmp/findings.md"))
    assert_denied(proc)


def test_bash_redirect_tmp_denied():
    proc = run_hook(bash_payload("echo hi >> /tmp/notes.md"))
    assert_denied(proc)
    proc = run_hook(bash_payload("grep -r pattern . > /private/tmp/out.txt"))
    assert_denied(proc)
    proc = run_hook(bash_payload('echo hi > "$TMPDIR/x.md"'))
    assert_denied(proc)


def test_bash_worktree_add_tmp_denied():
    """A5 F2 [175]: the block must cover worktree creation in /tmp, not just
    Write paths (the harness fix stranded in a prunable /tmp worktree; Etan's
    own terminal burned by a /tmp-worktree-held branch)."""
    proc = run_hook(bash_payload("git worktree add /tmp/leak-fix-wt -b fix/leak"))
    assert_denied(proc, must_mention=(".worktrees",))
    proc = run_hook(
        bash_payload(
            "git -C /Users/example/Gits/golems worktree add -b p2/x /private/tmp/wt origin/master"
        )
    )
    assert_denied(proc)


def test_bash_reads_and_deletes_allowed():
    """Never reads: ls/cat/rm/grep over /tmp are not creation verbs."""
    for cmd in (
        "ls /tmp",
        "cat /tmp/whatever.md",
        "grep -ril tmp /tmp",
        "rm /tmp/claude-pre-tool-use-sleep-history.json",
        "git worktree list",
        "echo hi > /dev/null 2>&1",
        'echo "see /tmp/x for the old notes" >> /opt/private/coordination/docs.local/notes.md',
    ):
        proc = run_hook(bash_payload(cmd))
        assert_allowed(proc)


def test_durable_writes_allowed():
    proc = run_hook(
        write_payload("/Users/example/Gits/golems/docs.local/scratch-notes.md")
    )
    assert_allowed(proc)
    proc = run_hook(
        bash_payload(
            "git -C /Users/example/Gits/golems worktree add "
            "/Users/example/Gits/golems/.worktrees/p2-foo -b p2/foo origin/master"
        )
    )
    assert_allowed(proc)


def test_plain_literal_redirect_uses_post_operator_operand(durable_path):
    proc = run_hook(
        bash_payload("node extract.mjs > learning_entry.txt"),
        cwd=str(durable_path),
    )
    assert_allowed(proc)

    proc = run_hook(
        bash_payload("node extract.mjs > /tmp/learning_entry.txt"),
        cwd=str(durable_path),
    )
    assert_denied(proc, must_mention=("/tmp/learning_entry.txt",))


# --- Reviewer-named route-arounds (PR #505: Bugbot 3x Medium, Codex 2x P1) ---


def test_bash_noclobber_redirect_tmp_denied():
    """Codex P1: `>|` (noclobber-override) is a one-character bypass of `>`."""
    proc = run_hook(bash_payload("echo data >| /tmp/out.md"))
    assert_denied(proc)


def test_bash_append_both_redirect_tmp_denied():
    """&>> append-both redirect into the class."""
    proc = run_hook(bash_payload("make build &>> /tmp/build-log.md"))
    assert_denied(proc)


def test_bash_redirect_both_word_form_denied():
    """Codex P1 round 2: `>&word` is Bash's second redirect-both-to-file form;
    only `>&N`/`>&-` are fd-dups."""
    proc = run_hook(bash_payload("echo hi >& /tmp/out.md"))
    assert_denied(proc)
    proc = run_hook(bash_payload("echo hi >&/tmp/out.md"))
    assert_denied(proc)
    # fd-dups stay allowed
    proc = run_hook(bash_payload("echo err >&2"))
    assert_allowed(proc)


def test_bash_noclobber_append_shapes_denied():
    """Bugbot 4749534e round 8: `>>|`/`&>>|` shapes bind the path, not `|`."""
    proc = run_hook(bash_payload("echo data >>| /tmp/out.md"))
    assert_denied(proc)
    proc = run_hook(bash_payload("make &>>| /tmp/log.md"))
    assert_denied(proc)


def test_bash_noclobber_both_redirect_denied():
    """Macroscope Medium round 2: `&>|` noclobber-override-both into the class."""
    proc = run_hook(bash_payload("make build &>| /tmp/log.md"))
    assert_denied(proc)
    proc = run_hook(bash_payload("make build &>|/tmp/log.md"))
    assert_denied(proc)


def test_inline_hatch_only_in_prefix_position():
    """Bugbot cbe4994c + Codex P1: WEAVE_ALLOW_TMP=1 in a DIFFERENT segment
    than the write, as an argument, or in a comment must NOT unlock the
    command — only an assignment prefix on the writing simple command
    counts (Bash assignment-prefix scope)."""
    for cmd in (
        "echo hi > /tmp/x.md && WEAVE_ALLOW_TMP=1 true",
        "echo durable > /tmp/x.md # WEAVE_ALLOW_TMP=1",
        "echo WEAVE_ALLOW_TMP=1 > /tmp/x.md",
    ):
        proc = run_hook(bash_payload(cmd))
        assert_denied(proc)
    # Prefix-assignment after other env assignments still counts (and logs).
    proc = run_hook(
        bash_payload("FOO=bar WEAVE_ALLOW_TMP=1 echo hi > /tmp/x.md"),
        env_extra={"TMP_BLOCK_LEDGER": "/dev/null"},
    )
    assert_allowed(proc)


def test_inline_hatch_scoped_to_first_simple_command(tmp_path):
    """Codex P1 round 3: `VAR=1 cmd` applies to that simple command only —
    a hatch on a harmless first command must not unlock a later segment's
    temp write."""
    proc = run_hook(
        bash_payload("WEAVE_ALLOW_TMP=1 true && echo durable > /tmp/x.md"),
        env_extra={"TMP_BLOCK_LEDGER": str(tmp_path / "ledger.jsonl")},
    )
    assert_denied(proc)


def test_process_substitution_tee_denied():
    """Codex P1 round 4: `> >(tee /tmp/out.md)` runs tee and creates the temp
    file — parens are token boundaries so the tee target is visible."""
    proc = run_hook(bash_payload("echo hi > >(tee /tmp/out.md)"))
    assert_denied(proc)


def test_comments_and_heredoc_bodies_do_not_false_fire():
    """Bugbot b5f80501 round 4: redirects/paths that exist only in comments or
    heredoc BODY text are not real writes — denying them is the C4
    discount-effect class (A5 cross-cutting #7)."""
    for cmd in (
        "echo hi > ./out.md # example: > /tmp/x.md",
        "ls -la # tee /tmp/never-runs.md",
        "cat <<'EOF' > /Users/example/Gits/golems/docs.local/notes.md\n"
        "doc example: echo x > /tmp/y.md\n"
        "EOF",
    ):
        proc = run_hook(bash_payload(cmd))
        assert_allowed(proc)
    # ...but a real redirect on the heredoc line itself is still caught.
    proc = run_hook(
        bash_payload("cat <<'EOF' > /tmp/real-write.md\nbody\nEOF")
    )
    assert_denied(proc)


def test_unquoted_heredoc_command_substitution_is_scanned():
    proc = run_hook(
        bash_payload(
            "cat <<EOF >/dev/null\n"
            "$(tee /tmp/leak </dev/null)\n"
            "EOF"
        )
    )
    assert_denied(proc)

    for opener in ("<<'EOF'", '<<"EOF"', "<<\\EOF"):
        literal = run_hook(
            bash_payload(
                f"cat {opener} >/dev/null\n"
                "$(tee /tmp/leak </dev/null)\n"
                "EOF"
            )
        )
        assert_allowed(literal)


def test_parameter_expansion_paren_does_not_close_command_substitution():
    proc = run_hook(
        bash_payload(
            'unset x; X="$(echo ${x:-)}; tee /tmp/leak </dev/null)"'
        )
    )
    assert_denied(proc)


def test_case_pattern_paren_does_not_close_command_substitution():
    proc = run_hook(
        bash_payload(
            'X="$(case x in x) tee /tmp/leak </dev/null;; esac)"'
        )
    )
    assert_denied(proc)

    leading = run_hook(
        bash_payload(
            'X="$(case x in (x) tee /tmp/leak </dev/null;; esac)"'
        )
    )
    assert_denied(leading)

    for terminator in (";&", ";;&"):
        fallthrough = run_hook(
            bash_payload(
                f'X="$(case x in x) true {terminator} '
                'y) tee /tmp/leak </dev/null;; esac)"'
            )
        )
        assert_denied(fallthrough)


def test_multiline_unquoted_heredoc_substitution_is_scanned():
    proc = run_hook(
        bash_payload(
            "cat <<EOF >/dev/null\n"
            "$(\n"
            "tee /tmp/leak </dev/null\n"
            ")\n"
            "EOF"
        )
    )
    assert_denied(proc)

    literal = run_hook(
        bash_payload(
            "cat <<'EOF' >/dev/null\n"
            "$(\n"
            "tee /tmp/leak </dev/null\n"
            ")\n"
            "EOF"
        )
    )
    assert_allowed(literal)

    unterminated = run_hook(
        bash_payload(
            "cat <<EOF >/dev/null\n"
            "$(tee /tmp/leak </dev/null)"
        )
    )
    assert_denied(unterminated)


def test_partially_quoted_heredoc_delimiter_does_not_hide_later_command():
    proc = run_hook(
        bash_payload(
            "cat <<E'OF'\n"
            "literal\n"
            "EOF\n"
            "git worktree add /workspace/off HEAD"
        )
    )
    assert_denied(proc)


def test_compound_keywords_reopen_command_position_for_worktree_add():
    for command in (
        "if true; then git worktree add /workspace/off HEAD; fi",
        "while false; do git worktree add /workspace/off HEAD; done",
        "until true; do git worktree add /workspace/off HEAD; done",
    ):
        proc = run_hook(bash_payload(command))
        assert_denied(proc)

    nested_case = run_hook(
        bash_payload(
            'X="$(if true; then case x in x) '
            'tee /tmp/leak </dev/null;; esac; fi)"'
        )
    )
    assert_denied(nested_case)


def test_heredoc_body_paren_does_not_close_enclosing_substitution():
    proc = run_hook(
        bash_payload(
            'X="$(cat <<EOF >/dev/null\n'
            ")\n"
            "EOF\n"
            "tee /tmp/leak </dev/null\n"
            ')"'
        )
    )
    assert_denied(proc)


def test_esac_argument_does_not_close_case_inside_substitution():
    proc = run_hook(
        bash_payload(
            "X=$(case y in "
            "x) echo esac;; "
            "y) tee /tmp/leak </dev/null;; "
            "esac)"
        )
    )
    assert_denied(proc)


def test_invoked_function_bodies_are_scanned_but_uninvoked_are_literal():
    bodies = (
        "tee /tmp/leak </dev/null",
        "git worktree add /workspace/off HEAD",
    )
    for body in bodies:
        invoked = run_hook(bash_payload(f"f() {{ {body}; }}; f"))
        assert_denied(invoked)

        uninvoked = run_hook(bash_payload(f"f() {{ {body}; }}"))
        assert_allowed(uninvoked)


def test_function_call_before_definition_does_not_activate_later_body():
    commands = (
        "f; f() { tee /tmp/leak </dev/null; }",
        "f() { true; }; f; f() { tee /tmp/leak </dev/null; }",
        "f() { tee /tmp/leak </dev/null; }; f() { true; }; f",
    )
    for command in commands:
        assert_allowed(run_hook(bash_payload(command)))


def test_coproc_commands_are_scanned_in_named_and_unnamed_forms():
    for command in (
        "coproc tee /tmp/leak </dev/null",
        "coproc WT { git worktree add /workspace/off HEAD; }",
    ):
        proc = run_hook(bash_payload(command))
        assert_denied(proc)


def test_invoked_alias_body_is_scanned_only_when_expansion_is_enabled():
    definition = "alias makewt='git worktree add /workspace/off HEAD'"
    enabled = run_hook(
        bash_payload(f"shopt -s expand_aliases; {definition}\nmakewt")
    )
    assert_denied(enabled)

    uninvoked = run_hook(
        bash_payload(f"shopt -s expand_aliases; {definition}")
    )
    assert_allowed(uninvoked)

    disabled = run_hook(bash_payload(f"{definition}\nmakewt"))
    assert_allowed(disabled)

    inherited_cwd = run_hook(
        bash_payload(
            "shopt -s expand_aliases; "
            "alias leak='git worktree add ../tmp/.worktrees/leak HEAD'\n"
            "cd /tmp\n"
            "leak"
        )
    )
    assert_denied(inherited_cwd)

    distinct_scope = run_hook(
        bash_payload(
            "shopt -s expand_aliases; "
            "alias leak='tee /tmp/leak </dev/null'\n"
            "X=$(WEAVE_ALLOW_TMP=1 true) leak"
        )
    )
    assert_denied(distinct_scope)


def test_alias_shaped_text_in_quoted_heredoc_is_not_invoked():
    proc = run_hook(
        bash_payload(
            "shopt -s expand_aliases; "
            "alias leak='tee /tmp/leak </dev/null'\n"
            "cat <<'EOF'\n"
            "leak\n"
            "EOF"
        )
    )
    assert_allowed(proc)

    executable_substitution = run_hook(
        bash_payload(
            "shopt -s expand_aliases; "
            "alias leak='tee /tmp/leak </dev/null'\n"
            "cat <<EOF\n"
            "$(leak)\n"
            "EOF"
        )
    )
    assert_denied(executable_substitution)


def test_heredoc_delimiter_indentation_matches_bash_rules():
    normal = run_hook(
        bash_payload(
            "cat <<EOF\n"
            " EOF\n"
            "git worktree add /workspace/off HEAD\n"
            "EOF"
        )
    )
    assert_allowed(normal)

    tab_stripped = run_hook(
        bash_payload(
            "cat <<-EOF\n"
            "\tEOF\n"
            "git worktree add /workspace/off HEAD"
        )
    )
    assert_denied(tab_stripped)


def test_commented_heredoc_marker_does_not_hide_later_command():
    proc = run_hook(
        bash_payload("echo ok # <<EOF\ntee /tmp/leak </dev/null")
    )
    assert_denied(proc)


def test_transitively_invoked_function_body_is_scanned():
    proc = run_hook(
        bash_payload(
            "g() { tee /tmp/leak </dev/null; }; "
            "f() { g; }; f"
        )
    )
    assert_denied(proc)

    positional = run_hook(
        bash_payload('f() { tee "$1" </dev/null; }; f /tmp/leak')
    )
    assert_refused(positional, must_mention=("tee", "$1"))


def test_alias_inside_invoked_function_body_is_scanned():
    proc = run_hook(
        bash_payload(
            "shopt -s expand_aliases; "
            "alias leak='tee /tmp/leak </dev/null'\n"
            "f() { leak; }\n"
            "f"
        )
    )
    assert_denied(proc)

    multiline_definition = (
        "shopt -s expand_aliases\n"
        "alias leak='tee /tmp/leak </dev/null'\n"
        "f() {\n"
        "  leak\n"
        "}"
    )
    assert_allowed(run_hook(bash_payload(multiline_definition)))
    assert_denied(run_hook(bash_payload(f"{multiline_definition}\nf")))

    next_line_brace = (
        "shopt -s expand_aliases\n"
        "alias leak='tee /tmp/leak </dev/null'\n"
        "f()\n"
        "{\n"
        "  echo \"}\"\n"
        "  leak\n"
        "}"
    )
    assert_allowed(run_hook(bash_payload(next_line_brace)))
    assert_denied(run_hook(bash_payload(f"{next_line_brace}\nf")))

    closed_signature_does_not_swallow_later_lines = run_hook(
        bash_payload(
            "shopt -s expand_aliases\n"
            "f()\n"
            "{ true; }\n"
            "alias leak='tee /tmp/leak </dev/null'\n"
            "leak"
        )
    )
    assert_denied(closed_signature_does_not_swallow_later_lines)

    multiline_quoted_brace = (
        "shopt -s expand_aliases\n"
        "alias leak='tee /tmp/leak </dev/null'\n"
        "f() {\n"
        "  echo \"foo\n"
        "}\n"
        "bar\"\n"
        "  leak\n"
        "}"
    )
    assert_allowed(run_hook(bash_payload(multiline_quoted_brace)))
    assert_denied(run_hook(bash_payload(f"{multiline_quoted_brace}\nf")))

    nested_substitution_quotes = (
        "shopt -s expand_aliases\n"
        "alias leak='tee /tmp/leak </dev/null'\n"
        "f() {\n"
        "  echo \"$(printf \"foo\n"
        "}\n"
        "bar\")\"\n"
        "  leak\n"
        "}"
    )
    assert_allowed(run_hook(bash_payload(nested_substitution_quotes)))
    assert_denied(run_hook(bash_payload(f"{nested_substitution_quotes}\nf")))

    escaped_signature_newline = (
        "shopt -s expand_aliases\n"
        "alias leak='tee /tmp/leak </dev/null'\n"
        "f() \\\n"
        "{ leak; }"
    )
    assert_allowed(run_hook(bash_payload(escaped_signature_newline)))
    assert_denied(run_hook(bash_payload(f"{escaped_signature_newline}\nf")))


def test_nested_invoked_alias_body_is_scanned():
    proc = run_hook(
        bash_payload(
            "shopt -s expand_aliases; "
            "alias leak='tee /tmp/leak </dev/null'; "
            "alias outer='leak'\n"
            "outer"
        )
    )
    assert_denied(proc)

    multi_command = run_hook(
        bash_payload(
            "shopt -s expand_aliases; "
            "alias leak='tee /tmp/leak </dev/null'; "
            "alias outer='true; leak'\n"
            "outer"
        )
    )
    assert_denied(multi_command)


def test_trailing_space_alias_expands_following_alias_word():
    proc = run_hook(
        bash_payload(
            "shopt -s expand_aliases; "
            "alias outer='command '; "
            "alias leak='tee /tmp/leak </dev/null'\n"
            "outer leak"
        )
    )
    assert_denied(proc)


def test_alias_invoked_function_body_is_scanned():
    proc = run_hook(
        bash_payload(
            "shopt -s expand_aliases; "
            "f() { tee /tmp/leak </dev/null; }; "
            "alias outer='f'\n"
            "outer"
        )
    )
    assert_denied(proc)

    for definition in (
        "function f { tee /tmp/leak </dev/null; }",
        "function f() { tee /tmp/leak </dev/null; }",
    ):
        keyword_form = run_hook(
            bash_payload(
                f"shopt -s expand_aliases; {definition}; "
                "alias outer='f'\nouter"
            )
        )
        assert_denied(keyword_form)


def test_alias_invoked_function_respects_definition_order():
    commands = (
        "shopt -s expand_aliases; alias outer='f'\n"
        "outer\n"
        "f() { tee /tmp/leak </dev/null; }",
        "shopt -s expand_aliases; alias outer='f'\n"
        "f() { true; }\n"
        "outer\n"
        "f() { tee /tmp/leak </dev/null; }",
    )
    for command in commands:
        assert_allowed(run_hook(bash_payload(command)))

    same_line_definition = run_hook(
        bash_payload(
            "shopt -s expand_aliases; alias outer='f'\n"
            "f() { tee /tmp/leak </dev/null; }; outer"
        )
    )
    assert_denied(same_line_definition)


def test_alias_to_function_keeps_parse_time_alias_expansion():
    proc = run_hook(
        bash_payload(
            "shopt -s expand_aliases\n"
            "alias leak='tee /tmp/leak </dev/null'\n"
            "f() { leak; }\n"
            "alias outer='f'\n"
            "outer"
        )
    )
    assert_denied(proc)


def test_alias_invocation_arguments_are_preserved():
    for definition, invocation in (
        ("alias leak='tee'", "leak /tmp/leak </dev/null"),
        (
            "alias wt='git worktree add'",
            "wt /workspace/off HEAD",
        ),
    ):
        proc = run_hook(
            bash_payload(
                f"shopt -s expand_aliases; {definition}\n{invocation}"
            )
        )
        assert_denied(proc)


def test_alias_synthesis_preserves_quoted_literal_metacharacters():
    proc = run_hook(
        bash_payload(
            "shopt -s expand_aliases; "
            'alias harmless="echo \'safe; tee /tmp/leak\'"\n'
            "harmless"
        )
    )
    assert_allowed(proc)


def test_alias_invocation_hatches_cover_first_expanded_command(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    commands = (
        (
            "alias leak='tee /tmp/leak </dev/null'",
            "WEAVE_ALLOW_TMP=1 leak",
        ),
        (
            "alias leak='git worktree add /workspace/off HEAD'",
            "WEAVE_ALLOW_WT_MIGRATION=1 leak",
        ),
    )
    for definition, invocation in commands:
        proc = run_hook(
            bash_payload(
                f"shopt -s expand_aliases; {definition}\n{invocation}"
            ),
            env_extra={"TMP_BLOCK_LEDGER": str(ledger)},
        )
        assert_allowed(proc)


def test_unalias_removes_tracked_alias_state():
    prefix = (
        "shopt -s expand_aliases; "
        "alias leak='tee /tmp/leak </dev/null'\n"
    )
    for removal in ("unalias leak", "unalias -a"):
        proc = run_hook(bash_payload(f"{prefix}{removal}\nleak"))
        assert_allowed(proc)


def test_alias_expansion_precedes_execution_in_multiline_compound():
    compounds = (
        "if true; then\n  unalias leak\n  leak\nfi",
        "{\n  unalias leak\n  leak\n}",
        "{\n  ./}\n  unalias leak\n  leak\n}",
        "{\n  echo hi >}\n  unalias leak\n  leak\n}",
        "{\n  echo hi >|}\n  unalias leak\n  leak\n}",
        "{\n  echo hi >&}\n  unalias leak\n  leak\n}",
        "{\n  echo hi <&}\n  unalias leak\n  leak\n}",
        "(\n  unalias leak\n  leak\n)",
        "(\n  echo hi >(cat)\n  unalias leak\n  leak\n)",
        "(\n  case x in x) true;; esac\n  unalias leak\n  leak\n)",
        "coproc {\n  unalias leak\n  leak\n}",
        "coproc LEAKER {\n  unalias leak\n  leak\n}",
        "coproc LEAKER if true; then\n  unalias leak\n  leak\nfi",
        "coproc LEAKER while true; do\n  unalias leak\n  leak\n  break\ndone",
        "if echo \\\nfi; then\n  unalias leak\n  leak\nfi",
        "i\\\nf true; then\n  unalias leak\n  leak\nfi",
    )
    for compound in compounds:
        proc = run_hook(
            bash_payload(
                "shopt -s expand_aliases\n"
                "alias leak='tee /tmp/leak </dev/null'\n"
                f"{compound}"
            )
        )
        assert_denied(proc)

    ordinary_brace_argument = run_hook(
        bash_payload(
            "shopt -s expand_aliases\n"
            "echo {\n"
            "alias leak='tee /tmp/leak </dev/null'\n"
            "leak"
        )
    )
    assert_denied(ordinary_brace_argument)

    attached_brace_word = run_hook(
        bash_payload(
            "shopt -s expand_aliases\n"
            "{foo\n"
            "alias leak='tee /tmp/leak </dev/null'\n"
            "leak"
        )
    )
    assert_denied(attached_brace_word)

    doubled_brace_word = run_hook(
        bash_payload(
            "shopt -s expand_aliases\n"
            "{{\n"
            "alias leak='tee /tmp/leak </dev/null'\n"
            "leak"
        )
    )
    assert_denied(doubled_brace_word)

    redirected_group_close = run_hook(
        bash_payload(
            "shopt -s expand_aliases\n"
            "{\n"
            "  true\n"
            "}>>/dev/null\n"
            "alias leak='tee /tmp/leak </dev/null'\n"
            "leak"
        )
    )
    assert_denied(redirected_group_close)


def test_parent_aliases_expand_in_hidden_command_substitutions():
    commands = (
        'echo "$(leak)"',
        "echo \"`leak`\"",
        'echo "$(( $(leak) + 0 ))"',
    )
    for command in commands:
        proc = run_hook(
            bash_payload(
                "shopt -s expand_aliases\n"
                "alias leak='tee /tmp/leak </dev/null'\n"
                f"{command}"
            )
        )
        assert_denied(proc)


def test_parent_function_runs_in_hidden_command_substitution():
    proc = run_hook(
        bash_payload(
            "leakfn() { tee /tmp/leak </dev/null; }\n"
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_same_unit_function_runs_in_hidden_command_substitution():
    proc = run_hook(
        bash_payload(
            "leakfn() { tee /tmp/leak </dev/null; }; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_skipped_function_is_not_inherited_by_hidden_substitution():
    proc = run_hook(
        bash_payload(
            "if false; then "
            "leakfn() { tee /tmp/leak </dev/null; }; "
            "fi; "
            'echo "$(leakfn)"'
        )
    )
    assert_allowed(proc)


def test_executed_compound_function_is_inherited_by_hidden_substitution():
    commands = (
        "if true; then "
        "leakfn() { tee /tmp/leak </dev/null; }; "
        "fi; ",
        "{ leakfn() { tee /tmp/leak </dev/null; }; }; ",
    )
    for prefix in commands:
        proc = run_hook(
            bash_payload(prefix + 'echo "$(leakfn)"')
        )
        assert_denied(proc)


def test_literal_condition_inherits_only_executed_branch():
    false_else = run_hook(
        bash_payload(
            "if false; then :; else "
            "leakfn() { tee /tmp/leak </dev/null; }; "
            "fi; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(false_else)

    true_else = run_hook(
        bash_payload(
            "if true; then :; else "
            "leakfn() { tee /tmp/leak </dev/null; }; "
            "fi; "
            'echo "$(leakfn)"'
        )
    )
    assert_allowed(true_else)


def test_literal_condition_list_uses_last_command_status():
    proc = run_hook(
        bash_payload(
            "if false; true; then "
            "leakfn() { tee /tmp/leak </dev/null; }; "
            "fi; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_literal_condition_honors_short_circuit_and_assignments():
    conditions = ("true || false", "X=1 true")
    for condition in conditions:
        proc = run_hook(
            bash_payload(
                f"if {condition}; then "
                "leakfn() { tee /tmp/leak </dev/null; }; "
                "fi; "
                'echo "$(leakfn)"'
            )
        )
        assert_denied(proc)


def test_literal_condition_honors_negation_and_elif():
    conditions = (
        "if ! false; then",
        "if false; then :; elif true; then",
    )
    for condition in conditions:
        proc = run_hook(
            bash_payload(
                f"{condition} "
                "leakfn() { tee /tmp/leak </dev/null; }; "
                "fi; "
                'echo "$(leakfn)"'
            )
        )
        assert_denied(proc)


def test_colon_is_a_statically_true_condition():
    proc = run_hook(
        bash_payload(
            "if :; then "
            "leakfn() { tee /tmp/leak </dev/null; }; "
            "fi; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_skipped_unalias_does_not_mutate_alias_state():
    proc = run_hook(
        bash_payload(
            "shopt -s expand_aliases\n"
            "alias leak='tee /tmp/leak </dev/null'\n"
            "if false; then unalias leak; fi\n"
            "leak"
        )
    )
    assert_denied(proc)


def test_definite_for_loop_propagates_function_definition():
    proc = run_hook(
        bash_payload(
            "for x in one; do "
            "leakfn() { tee /tmp/leak </dev/null; }; "
            "done; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_empty_quoted_for_word_still_executes_loop():
    proc = run_hook(
        bash_payload(
            'for x in ""; do '
            "leakfn() { tee /tmp/leak </dev/null; }; "
            "done; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_newline_delimited_empty_for_word_executes_loop():
    proc = run_hook(
        bash_payload(
            'for x in ""\n'
            "do\n"
            "leakfn() { tee /tmp/leak </dev/null; }\n"
            "done\n"
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_quoted_substitution_is_one_definite_for_word():
    proc = run_hook(
        bash_payload(
            'for x in "$(false)"; do '
            "leakfn() { tee /tmp/leak </dev/null; }; "
            "done; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_unquoted_substitution_internals_are_not_for_words():
    proc = run_hook(
        bash_payload(
            "for x in $(false); do "
            "leakfn() { tee /tmp/leak </dev/null; }; "
            "done; "
            'echo "$(leakfn)"'
        )
    )
    assert_allowed(proc)


def test_literal_case_arm_propagates_function_definition():
    proc = run_hook(
        bash_payload(
            "case x in x) "
            "leakfn() { tee /tmp/leak </dev/null; };; "
            "esac; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_later_literal_case_arm_propagates_function_definition():
    proc = run_hook(
        bash_payload(
            "case y in x) :;; y) "
            "leakfn() { tee /tmp/leak </dev/null; };; "
            "esac; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_case_glob_arm_propagates_function_definition():
    proc = run_hook(
        bash_payload(
            "case x in *) "
            "leakfn() { tee /tmp/leak </dev/null; };; "
            "esac; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_case_preserves_first_matching_arm():
    proc = run_hook(
        bash_payload(
            "case x in x) :;; x) "
            "leakfn() { tee /tmp/leak </dev/null; };; "
            "esac; "
            'echo "$(leakfn)"'
        )
    )
    assert_allowed(proc)


def test_case_matches_alternative_pattern():
    proc = run_hook(
        bash_payload(
            "case y in x|y) "
            "leakfn() { tee /tmp/leak </dev/null; };; "
            "esac; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_case_resets_after_unmatched_fallthrough_arm():
    proc = run_hook(
        bash_payload(
            "case y in x) :;& y) "
            "leakfn() { tee /tmp/leak </dev/null; };; "
            "esac; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_quoted_case_wildcard_remains_literal():
    proc = run_hook(
        bash_payload(
            'case x in "*") '
            "leakfn() { tee /tmp/leak </dev/null; };; "
            "esac; "
            'echo "$(leakfn)"'
        )
    )
    assert_allowed(proc)


def test_nested_case_arms_keep_independent_pattern_state():
    proc = run_hook(
        bash_payload(
            "case x in x) case y in z) :;; y) "
            "leakfn() { tee /tmp/leak </dev/null; };; "
            "esac;; esac; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_dynamic_case_subject_is_treated_as_uncertain():
    proc = run_hook(
        bash_payload(
            "x=y; case $x in y) "
            "leakfn() { tee /tmp/leak </dev/null; };; "
            "esac; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_tilde_case_subject_is_treated_as_uncertain():
    proc = run_hook(
        bash_payload(
            "HOME=/durable; case ~ in /durable) "
            "leakfn() { tee /tmp/leak </dev/null; };; "
            "esac; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_function_body_preserves_quoted_redirect_text():
    proc = run_hook(bash_payload('f() { echo ">" "/tmp/leak"; }; f'))
    assert_allowed(proc)


def test_definite_while_and_until_propagate_function_definition():
    loops = ("while true", "until false")
    for loop in loops:
        proc = run_hook(
            bash_payload(
                f"{loop}; do "
                "leakfn() { tee /tmp/leak </dev/null; }; break; "
                "done; "
                'echo "$(leakfn)"'
            )
        )
        assert_denied(proc)


def test_short_circuit_inside_definite_loop_skips_function_definition():
    proc = run_hook(
        bash_payload(
            "for x in one; do "
            "false && leakfn() { tee /tmp/leak </dev/null; }; "
            "done; "
            'echo "$(leakfn)"'
        )
    )
    assert_allowed(proc)


def test_top_level_short_circuit_skips_function_definition():
    proc = run_hook(
        bash_payload(
            "false && leakfn() { tee /tmp/leak </dev/null; }; "
            'echo "$(leakfn)"'
        )
    )
    assert_allowed(proc)


def test_unknown_short_circuit_remains_fail_closed():
    proc = run_hook(
        bash_payload(
            "test x = x && "
            "leakfn() { tee /tmp/leak </dev/null; }; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_uncertain_unalias_does_not_remove_alias_state():
    proc = run_hook(
        bash_payload(
            "shopt -s expand_aliases\n"
            "alias leak='tee /tmp/leak </dev/null'\n"
            "if test x = y; then unalias leak; fi\n"
            "leak"
        )
    )
    assert_denied(proc)


def test_unsupported_for_header_remains_fail_closed():
    proc = run_hook(
        bash_payload(
            "for ((i=0;i<1;i++)); do "
            "leakfn() { tee /tmp/leak </dev/null; }; "
            "done; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_select_body_remains_fail_closed():
    proc = run_hook(
        bash_payload(
            "select x in a; do "
            "leakfn() { tee /tmp/leak </dev/null; }; break; "
            "done <<<1; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_function_definition_in_condition_is_inherited():
    proc = run_hook(
        bash_payload(
            "if leakfn() { tee /tmp/leak </dev/null; }; then :; fi; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_case_fallthrough_uses_resolved_assignment_subject():
    proc = run_hook(
        bash_payload(
            "x=z; case $x in y) :;& q) "
            "leakfn() { tee /tmp/leak </dev/null; };; "
            "esac; "
            'echo "$(leakfn)"'
        )
    )
    assert_allowed(proc)


def test_skipped_assignment_does_not_override_case_subject():
    proc = run_hook(
        bash_payload(
            "x=y; false && x=z; case $x in y) "
            "leakfn() { tee /tmp/leak </dev/null; };; "
            "esac; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_dynamic_assignment_invalidates_stale_case_subject():
    proc = run_hook(
        bash_payload(
            "v=y; x=z; x=$v; case $x in y) "
            "f() { tee /tmp/leak </dev/null; };; "
            "esac; "
            'echo "$(f)"'
        )
    )
    assert_denied(proc)


def test_posix_case_class_remains_fail_closed():
    proc = run_hook(
        bash_payload(
            "case x in [[:alpha:]]) "
            "leakfn() { tee /tmp/leak </dev/null; };; "
            "esac; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_nocasematch_case_arm_remains_fail_closed():
    proc = run_hook(
        bash_payload(
            "shopt -s nocasematch\n"
            "case X in x) f() { tee /tmp/leak </dev/null; };; esac\n"
            'echo "$(f)"'
        )
    )
    assert_denied(proc)


def test_nocasematch_after_other_shopt_operand_remains_fail_closed():
    proc = run_hook(
        bash_payload(
            "shopt -s expand_aliases nocasematch; "
            "case X in x) f() { tee /tmp/leak </dev/null; };; esac; "
            'echo "$(f)"'
        )
    )
    assert_denied(proc)


def test_caret_negated_case_class_remains_fail_closed():
    proc = run_hook(
        bash_payload(
            "case x in [^a]) f() { tee /tmp/leak </dev/null; };; esac; "
            'echo "$(f)"'
        )
    )
    assert_denied(proc)


def test_command_builtin_suppresses_function_lookup():
    proc = run_hook(
        bash_payload(
            "leakfn() { tee /tmp/leak </dev/null; }; command leakfn"
        )
    )
    assert_allowed(proc)


def test_pipeline_function_definition_is_not_inherited():
    proc = run_hook(
        bash_payload("true | f() { tee /tmp/leak </dev/null; }; f")
    )
    assert_allowed(proc)


def test_boolean_after_function_definition_is_parent_local():
    proc = run_hook(
        bash_payload(
            "f() { tee /tmp/leak </dev/null; } && true; f"
        )
    )
    assert_denied(proc)


def test_unset_function_removal_precedes_later_call():
    proc = run_hook(
        bash_payload(
            "f() { tee /tmp/leak </dev/null; }; unset -f f; f"
        )
    )
    assert_allowed(proc)


def test_pipeline_unset_does_not_remove_parent_function():
    proc = run_hook(
        bash_payload(
            "f() { tee /tmp/leak </dev/null; }; unset -f f | cat; f"
        )
    )
    assert_denied(proc)


def test_pipeline_unalias_does_not_remove_parent_alias():
    proc = run_hook(
        bash_payload(
            "shopt -s expand_aliases\n"
            "alias leak='tee /tmp/leak </dev/null'\n"
            "unalias leak | cat\n"
            "leak"
        )
    )
    assert_denied(proc)


def test_env_operand_does_not_use_shell_function_lookup():
    proc = run_hook(
        bash_payload(
            "f_tmp_block_unique() { tee /tmp/leak </dev/null; }; "
            "env f_tmp_block_unique"
        )
    )
    assert_allowed(proc)


def test_variable_invoked_function_body_is_scanned():
    proc = run_hook(
        bash_payload("f() { echo hi > /tmp/leak; }; x=f; $x")
    )
    assert_denied(proc)


def test_eval_invoked_function_body_is_scanned():
    proc = run_hook(
        bash_payload("f() { echo hi > /tmp/leak; }; eval f")
    )
    assert_denied(proc)


def test_eval_quoted_payload_invoked_function_body_is_scanned():
    proc = run_hook(
        bash_payload("f() { echo hi > /tmp/leak; }; eval 'f arg'")
    )
    assert_denied(proc)


def test_eval_variable_invoked_function_body_is_scanned():
    proc = run_hook(
        bash_payload('f() { echo hi > /tmp/leak; }; x=f; eval "$x"')
    )
    assert_denied(proc)


def test_eval_command_operand_does_not_use_shell_function_lookup():
    proc = run_hook(
        bash_payload("f() { tee /tmp/leak </dev/null; }; eval 'command f'")
    )
    assert_allowed(proc)


def test_eval_direct_redirect_is_scanned():
    proc = run_hook(bash_payload("eval 'echo hi > /tmp/leak'"))
    assert_denied(proc)


def test_eval_direct_tee_is_scanned():
    proc = run_hook(bash_payload("eval 'tee /tmp/leak </dev/null'"))
    assert_denied(proc)


def test_builtin_eval_direct_redirect_is_scanned():
    proc = run_hook(bash_payload("builtin eval 'echo hi > /tmp/leak'"))
    assert_denied(proc)


def test_eval_inherits_active_alias_state():
    proc = run_hook(
        bash_payload(
            "shopt -s expand_aliases\n"
            "alias leak='tee /tmp/leak </dev/null'\n"
            "eval leak"
        )
    )
    assert_denied(proc)


def test_variable_invoked_eval_direct_redirect_is_scanned():
    proc = run_hook(
        bash_payload("e=eval; $e 'echo hi > /tmp/leak'")
    )
    assert_denied(proc)


def test_recursively_wrapped_builtin_eval_is_scanned():
    proc = run_hook(
        bash_payload("builtin builtin eval 'echo hi > /tmp/leak'")
    )
    assert_denied(proc)


def test_function_positional_arguments_forwarded_to_eval_are_scanned():
    proc = run_hook(
        bash_payload("e() { eval \"$@\"; }; e 'echo hi > /tmp/leak'")
    )
    assert_denied(proc)


def test_variable_invoked_builtin_eval_is_scanned():
    proc = run_hook(
        bash_payload("b=builtin; $b eval 'echo hi > /tmp/leak'")
    )
    assert_denied(proc)


def test_indirect_eval_in_function_forwards_positional_arguments():
    proc = run_hook(
        bash_payload(
            "e() { x=eval; $x \"$@\"; }; "
            "e 'echo hi > /tmp/leak'"
        )
    )
    assert_denied(proc)


def test_eval_forwards_multi_digit_positional_argument():
    proc = run_hook(
        bash_payload(
            "e() { eval \"${10}\"; }; "
            "e a b c d e f g h i 'echo hi > /tmp/leak'"
        )
    )
    assert_denied(proc)


def test_command_wrapped_builtin_eval_is_scanned():
    proc = run_hook(
        bash_payload("command builtin eval 'echo hi > /tmp/leak'")
    )
    assert_denied(proc)


def test_nested_function_argument_mapping_reaches_eval():
    proc = run_hook(
        bash_payload(
            "g() { eval \"$2\"; }; "
            "f() { g x \"$1\"; }; "
            "f 'echo hi > /tmp/leak'"
        )
    )
    assert_denied(proc)


def test_local_assignment_indirect_eval_forwards_arguments():
    proc = run_hook(
        bash_payload(
            "e() { local x=eval; $x \"$@\"; }; "
            "e 'echo hi > /tmp/leak'"
        )
    )
    assert_denied(proc)


def test_eval_forwards_positional_slice():
    proc = run_hook(
        bash_payload(
            "e() { eval \"${@:2}\"; }; "
            "e x 'echo hi > /tmp/leak'"
        )
    )
    assert_denied(proc)


def test_command_option_wrapped_builtin_eval_is_scanned():
    proc = run_hook(
        bash_payload("command -p builtin eval 'echo hi > /tmp/leak'")
    )
    assert_denied(proc)


def test_eval_forwards_bounded_positional_slice():
    proc = run_hook(
        bash_payload(
            "e() { eval \"${@:2:1}\"; }; "
            "e x 'echo hi > /tmp/leak' ignored"
        )
    )
    assert_denied(proc)


def test_transitive_command_wrapper_suppresses_function_lookup():
    proc = run_hook(
        bash_payload(
            "g() { eval \"$2\"; }; "
            "f() { command g x \"$1\"; }; "
            "f 'echo hi > /tmp/leak'"
        )
    )
    assert_allowed(proc)


def test_eval_forwards_arithmetic_positional_slice():
    proc = run_hook(
        bash_payload(
            "e() { eval \"${@: +2:1}\"; }; "
            "e x 'echo hi > /tmp/leak' ignored"
        )
    )
    assert_denied(proc)


def test_negative_positional_slice_length_prevents_eval():
    proc = run_hook(
        bash_payload(
            "e() { eval \"${@:2:-1}\"; }; "
            "e x 'echo hi > /tmp/leak' ignored"
        )
    )
    assert_allowed(proc)


def test_command_lookup_option_does_not_execute_eval():
    proc = run_hook(
        bash_payload("command -v eval 'echo hi > /tmp/leak'")
    )
    assert_allowed(proc)


def test_eval_resolves_inherited_environment_payload():
    proc = run_hook(
        bash_payload('eval "$PAYLOAD"'),
        env_extra={"PAYLOAD": "echo hi > /tmp/leak"},
    )
    assert_denied(proc)


def test_negative_arithmetic_slice_length_prevents_eval():
    proc = run_hook(
        bash_payload(
            "e() { eval \"${@:2:1-2}\"; }; "
            "e x 'echo hi > /tmp/leak' ignored"
        )
    )
    assert_allowed(proc)


def test_eval_resolves_inherited_parameter_default_operator():
    proc = run_hook(
        bash_payload('eval "${PAYLOAD:-true}"'),
        env_extra={"PAYLOAD": "echo hi > /tmp/leak"},
    )
    assert_denied(proc)


def test_eval_resolves_positional_parameter_default_operator():
    proc = run_hook(
        bash_payload(
            "e() { eval \"${1:-true}\"; }; "
            "e 'echo hi > /tmp/leak'"
        )
    )
    assert_denied(proc)


def test_unset_variable_does_not_reuse_inherited_eval_payload():
    proc = run_hook(
        bash_payload('unset PAYLOAD; eval "$PAYLOAD"'),
        env_extra={"PAYLOAD": "echo hi > /tmp/leak"},
    )
    assert_allowed(proc)


def test_export_assignment_is_visible_to_eval():
    proc = run_hook(
        bash_payload(
            "export PAYLOAD='echo hi > /tmp/leak'; eval \"$PAYLOAD\""
        )
    )
    assert_denied(proc)


def test_eval_resolves_named_indirect_expansion():
    proc = run_hook(
        bash_payload(
            "PAYLOAD='echo hi > /tmp/leak'; ref=PAYLOAD; eval \"${!ref}\""
        )
    )
    assert_denied(proc)


def test_builtin_unset_does_not_reuse_inherited_eval_payload():
    proc = run_hook(
        bash_payload('builtin unset PAYLOAD; eval "$PAYLOAD"'),
        env_extra={"PAYLOAD": "echo hi > /tmp/leak"},
    )
    assert_allowed(proc)


def test_unset_function_mode_keeps_inherited_eval_variable():
    proc = run_hook(
        bash_payload('builtin unset -f PAYLOAD; eval "$PAYLOAD"'),
        env_extra={"PAYLOAD": "echo hi > /tmp/leak"},
    )
    assert_denied(proc)


def test_export_assignment_expands_known_variable_for_eval():
    proc = run_hook(
        bash_payload(
            "X='echo hi > /tmp/leak'; export PAYLOAD=\"$X\"; "
            "eval \"$PAYLOAD\""
        )
    )
    assert_denied(proc)


def test_declaration_assignments_expand_from_precommand_snapshot():
    proc = run_hook(
        bash_payload(
            "X='echo hi > /tmp/leak'; export X=true PAYLOAD=\"$X\"; "
            "eval \"$PAYLOAD\""
        )
    )
    assert_denied(proc)


def test_conflicting_unset_modes_preserve_inherited_eval_variable():
    proc = run_hook(
        bash_payload('unset -f -v PAYLOAD; eval "$PAYLOAD"'),
        env_extra={"PAYLOAD": "echo hi > /tmp/leak"},
    )
    assert_denied(proc)


def test_variable_invoked_builtin_declaration_is_visible_to_eval():
    proc = run_hook(
        bash_payload(
            "b=builtin; $b export PAYLOAD='echo hi > /tmp/leak'; "
            "eval \"$PAYLOAD\""
        )
    )
    assert_denied(proc)


def test_inherited_variable_invokes_eval():
    proc = run_hook(
        bash_payload("$E 'echo hi > /tmp/leak'"),
        env_extra={"E": "eval"},
    )
    assert_denied(proc)


def test_export_function_mode_preserves_inherited_eval_variable():
    proc = run_hook(
        bash_payload('export -f PAYLOAD=true; eval "$PAYLOAD"'),
        env_extra={"PAYLOAD": "echo hi > /tmp/leak"},
    )
    assert_denied(proc)


def test_eval_resolves_inherited_substring_expansion():
    proc = run_hook(
        bash_payload('eval "${PAYLOAD:0}"'),
        env_extra={"PAYLOAD": "echo hi > /tmp/leak"},
    )
    assert_denied(proc)


def test_standalone_assignment_expands_known_eval_variable():
    proc = run_hook(
        bash_payload(
            "PAYLOAD='echo hi > /tmp/leak'; X=$PAYLOAD; eval \"$X\""
        )
    )
    assert_denied(proc)


def test_eval_resolves_parameter_assignment_operator():
    proc = run_hook(
        bash_payload('eval "${PAYLOAD:=echo hi > /tmp/leak}"')
    )
    assert_denied(proc)


def test_standalone_assignment_resolves_parameter_operator():
    proc = run_hook(
        bash_payload(
            "PAYLOAD='echo hi > /tmp/leak'; "
            "X=${PAYLOAD:-true}; eval \"$X\""
        )
    )
    assert_denied(proc)


def test_eval_resolves_nested_assignment_operator_word():
    proc = run_hook(
        bash_payload(
            'eval "${PAYLOAD:=${X:-echo hi > /tmp/leak}}"'
        )
    )
    assert_denied(proc)


def test_eval_resolves_nested_default_operator_word():
    proc = run_hook(
        bash_payload(
            'eval "${V0:-${V1:-echo hi > /tmp/leak}}"'
        )
    )
    assert_denied(proc)


def test_eval_conservatively_scans_pattern_modified_positional():
    proc = run_hook(
        bash_payload(
            "e() { eval \"${1#zzz}\"; }; "
            "e 'echo hit > /tmp/leak'"
        )
    )
    assert_denied(proc)


def test_eval_conservatively_scans_command_substitution_value():
    proc = run_hook(
        bash_payload(
            "PAYLOAD=$(printf 'echo hit > /tmp/leak'); eval \"$PAYLOAD\""
        )
    )
    assert_denied(proc)


def test_eval_blocks_encoded_command_substitution_output():
    proc = run_hook(
        bash_payload(
            "PAYLOAD=$(printf 'echo hit \\x3e /tmp/leak'); eval \"$PAYLOAD\""
        )
    )
    assert_denied(proc)


def test_eval_conservatively_scans_positional_replacement_text():
    proc = run_hook(
        bash_payload(
            "e() { eval \"${1/x/echo hit > /tmp/leak}\"; }; e x"
        )
    )
    assert_denied(proc)


def test_eval_blocks_declaration_command_substitution_value():
    proc = run_hook(
        bash_payload(
            "export PAYLOAD=$(printf 'echo hit > /tmp/leak'); "
            "eval \"$PAYLOAD\""
        )
    )
    assert_denied(proc)


def test_eval_blocks_direct_command_substitution_value():
    proc = run_hook(
        bash_payload(
            "eval \"$(printf 'echo hit \\x3e /tmp/leak')\""
        )
    )
    assert_denied(proc)


def test_eval_conservatively_scans_named_parameter_modifier():
    proc = run_hook(
        bash_payload(
            "PAYLOAD='echo hit > /tmp/leak'; eval \"${PAYLOAD#zzz}\""
        )
    )
    assert_denied(proc)


def test_eval_blocks_printf_v_assignment_value():
    proc = run_hook(
        bash_payload(
            "printf -v PAYLOAD '%b' 'echo hit \\x3e /tmp/leak'; "
            "eval \"$PAYLOAD\""
        )
    )
    assert_denied(proc)


def test_eval_blocks_nameref_declaration_value():
    proc = run_hook(
        bash_payload(
            "declare -n PAYLOAD=REF; REF='echo hit > /tmp/leak'; "
            "eval \"$PAYLOAD\""
        )
    )
    assert_denied(proc)


def test_eval_blocks_read_assignment_value():
    proc = run_hook(
        bash_payload(
            "read -r PAYLOAD <<< 'echo hit > /tmp/leak'; "
            "eval \"$PAYLOAD\""
        )
    )
    assert_denied(proc)


def test_eval_blocks_grouped_nameref_declaration_value():
    proc = run_hook(
        bash_payload(
            "declare -gn PAYLOAD=REF; REF='echo hit > /tmp/leak'; "
            "eval \"$PAYLOAD\""
        )
    )
    assert_denied(proc)


def test_eval_blocks_default_read_reply_value():
    proc = run_hook(
        bash_payload(
            "read -r <<< 'echo hit > /tmp/leak'; eval \"$REPLY\""
        )
    )
    assert_denied(proc)


def test_eval_blocks_read_reply_after_option_operand():
    proc = run_hook(
        bash_payload(
            "read -p PROMPT <<< 'echo hit > /tmp/leak'; "
            "eval \"$REPLY\""
        )
    )
    assert_denied(proc)


def test_eval_blocks_read_array_destination():
    proc = run_hook(
        bash_payload(
            "read -a PAYLOAD <<< 'echo hit > /tmp/leak'; "
            "eval \"$PAYLOAD\""
        )
    )
    assert_denied(proc)


def test_eval_blocks_positional_parameter_assigned_by_set():
    proc = run_hook(
        bash_payload(
            "set -- 'echo hit > /tmp/leak'; "
            "eval \"$1\""
        )
    )
    assert_denied(proc)


def test_eval_blocks_mapfile_array_destination():
    proc = run_hook(
        bash_payload(
            "mapfile PAYLOAD <<< 'echo hit > /tmp/leak'; "
            "eval \"$PAYLOAD\""
        )
    )
    assert_denied(proc)


def test_eval_blocks_default_readarray_destination():
    proc = run_hook(
        bash_payload(
            "readarray <<< 'echo hit > /tmp/leak'; "
            "eval \"$MAPFILE\""
        )
    )
    assert_denied(proc)


def test_direct_tee_in_false_branch_is_skipped():
    proc = run_hook(
        bash_payload("if false; then tee /tmp/leak </dev/null; fi")
    )
    assert_allowed(proc)


def test_exec_operand_does_not_use_shell_function_lookup():
    proc = run_hook(
        bash_payload("f() { tee /tmp/leak </dev/null; }; exec f")
    )
    assert_allowed(proc)


def test_compound_status_controls_following_short_circuit():
    proc = run_hook(
        bash_payload(
            "if true; then true; fi && "
            "leakfn() { tee /tmp/leak </dev/null; }; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_false_if_without_else_returns_success():
    proc = run_hook(
        bash_payload(
            "if false; then :; fi && "
            "leakfn() { tee /tmp/leak </dev/null; }; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_unknown_if_branch_remains_fail_closed():
    proc = run_hook(
        bash_payload(
            "if test x = x; then "
            "leakfn() { tee /tmp/leak </dev/null; }; "
            "fi; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_unknown_else_branch_remains_fail_closed():
    proc = run_hook(
        bash_payload(
            "if test x = y; then :; else "
            "leakfn() { tee /tmp/leak </dev/null; }; "
            "fi; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_unknown_loop_condition_remains_fail_closed():
    proc = run_hook(
        bash_payload(
            "while test x = x; do "
            "leakfn() { tee /tmp/leak </dev/null; }; break; "
            "done; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_dynamic_only_for_list_remains_fail_closed():
    proc = run_hook(
        bash_payload(
            "v=one; for x in $v; do "
            "leakfn() { tee /tmp/leak </dev/null; }; "
            "done; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_skipped_function_invocation_is_not_expanded():
    proc = run_hook(
        bash_payload(
            "leakfn() { tee /tmp/leak </dev/null; }; "
            "if false; then leakfn; fi"
        )
    )
    assert_allowed(proc)


def test_builtin_wrapped_alias_state_mutations():
    enabled = run_hook(
        bash_payload(
            "builtin shopt -s expand_aliases\n"
            "builtin alias leak='tee /tmp/leak </dev/null'\n"
            "leak"
        )
    )
    assert_denied(enabled)

    disabled = run_hook(
        bash_payload(
            "shopt -s expand_aliases\n"
            "alias leak='tee /tmp/leak </dev/null'\n"
            "builtin unalias leak\n"
            "leak"
        )
    )
    assert_allowed(disabled)


def test_aliased_builtin_does_not_mutate_alias_state():
    proc = run_hook(
        bash_payload(
            "shopt -s expand_aliases\n"
            "alias leak='tee /tmp/leak </dev/null'\n"
            "alias builtin=true\n"
            "builtin unalias leak\n"
            "leak"
        )
    )
    assert_denied(proc)


def test_escaped_builtin_mutates_alias_state_despite_alias():
    proc = run_hook(
        bash_payload(
            "shopt -s expand_aliases\n"
            "alias leak='tee /tmp/leak </dev/null'\n"
            "alias builtin=true\n"
            "\\builtin unalias leak\n"
            "leak"
        )
    )
    assert_allowed(proc)


def test_escaped_builtin_after_group_start_mutates_alias_state():
    proc = run_hook(
        bash_payload(
            "shopt -s expand_aliases\n"
            "alias leak='tee /tmp/leak </dev/null'\n"
            "alias builtin=true\n"
            "{ \\builtin unalias leak; }\n"
            "leak"
        )
    )
    assert_allowed(proc)


def test_later_escaped_builtin_does_not_mark_command_token_escaped():
    proc = run_hook(
        bash_payload(
            "shopt -s expand_aliases\n"
            "alias leak='tee /tmp/leak </dev/null'\n"
            "alias builtin=true\n"
            "builtin unalias leak then \\builtin\n"
            "leak"
        )
    )
    assert_denied(proc)


def test_quoted_builtin_does_not_shift_escape_metadata():
    proc = run_hook(
        bash_payload(
            "shopt -s expand_aliases\n"
            "alias leak='tee /tmp/leak </dev/null'\n"
            "alias builtin=true\n"
            '"builtin" true; builtin unalias leak; \\builtin true\n'
            "leak"
        )
    )
    assert_denied(proc)


def test_ansi_quoted_builtin_does_not_shift_escape_metadata():
    proc = run_hook(
        bash_payload(
            "shopt -s expand_aliases\n"
            "alias leak='tee /tmp/leak </dev/null'\n"
            "alias builtin=true\n"
            "$'builtin' true; builtin unalias leak; \\builtin true\n"
            "leak"
        )
    )
    assert_denied(proc)

    comment_backslash = run_hook(
        bash_payload(
            "shopt -s expand_aliases\n"
            "alias leak='tee /tmp/leak </dev/null' # \\\n"
            "leak"
        )
    )
    assert_denied(comment_backslash)


def test_backtick_builtin_does_not_shift_escape_metadata():
    proc = run_hook(
        bash_payload(
            "shopt -s expand_aliases\n"
            "alias leak='tee /tmp/leak </dev/null'\n"
            "alias builtin=true\n"
            "`builtin true`; builtin unalias leak; \\builtin true\n"
            "leak"
        )
    )
    assert_denied(proc)


def test_inline_hatch_on_later_segment_honored(tmp_path):
    """Codex P2 round 4: Bash DOES run `true && WEAVE_ALLOW_TMP=1 echo x >
    /tmp/x.md` with the hatch set on the writing command — per-segment hatch
    is honored (allowed AND logged)."""
    ledger = tmp_path / "ledger.jsonl"
    proc = run_hook(
        bash_payload("true && WEAVE_ALLOW_TMP=1 echo x > /tmp/x.md"),
        env_extra={"TMP_BLOCK_LEDGER": str(ledger)},
    )
    assert_allowed(proc)
    assert ledger.exists(), "later-segment hatch use must be logged too"


def test_tmp_symlink_to_durable_still_denied(tmp_path):
    """Bugbot HIGH 6b9b2c5c round 5: a /tmp-shaped path whose symlink resolves
    to durable storage is still temp-class — the lexical form is checked, not
    only realpath."""
    link = "/tmp/tmpblock-test-durable-link"
    try:
        os.symlink(str(tmp_path), link)
    except FileExistsError:
        pass
    try:
        proc = run_hook(write_payload(link + "/notes.md"))
        assert_denied(proc)
    finally:
        os.unlink(link)


def test_qualified_tee_path_denied():
    """Bugbot Medium round 5: /usr/bin/tee must not skip the tee guard."""
    proc = run_hook(bash_payload("echo hi | /usr/bin/tee /tmp/findings.md"))
    assert_denied(proc)


def test_redirection_words_do_not_consume_following_subshell_closer():
    for redirect in (">&2", ">'file'", '>"file"'):
        proc = run_hook(
            bash_payload(
                f"(echo hi {redirect})\n"
                "shopt -s expand_aliases\n"
                "alias leak='tee /tmp/leak </dev/null'\n"
                "leak"
            )
        )
        assert_denied(proc)


def test_redirection_operand_consumes_reserved_word_position():
    proc = run_hook(
        bash_payload(
            "shopt -s expand_aliases\n"
            ">/dev/null if\n"
            "alias leak='tee /tmp/leak </dev/null'\n"
            "leak"
        )
    )
    assert_denied(proc)


def test_path_command_consumes_compound_command_position():
    proc = run_hook(
        bash_payload(
            "shopt -s expand_aliases\n"
            "/bin/echo if\n"
            "alias leak='tee /tmp/leak </dev/null'\n"
            "leak"
        )
    )
    assert_denied(proc)


def test_assignment_prefix_consumes_reserved_word_position():
    proc = run_hook(
        bash_payload(
            "shopt -s expand_aliases\n"
            "FOO=x if\n"
            "alias leak='tee /tmp/leak </dev/null'\n"
            "leak"
        )
    )
    assert_denied(proc)


def test_pipeline_prefix_preserves_compound_command_position():
    for prefix in ("!", "time", "time -p", "time --", "time -p --"):
        proc = run_hook(
            bash_payload(
                "shopt -s expand_aliases\n"
                "alias leak='tee /tmp/leak </dev/null'\n"
                f"{prefix} if true; then\n"
                "  unalias leak\n"
                "  leak\n"
                "fi"
            )
        )
        assert_denied(proc)


def test_time_consumes_only_one_portable_option():
    proc = run_hook(
        bash_payload(
            "shopt -s expand_aliases\n"
            "time -p -p if\n"
            "alias leak='tee /tmp/leak </dev/null'\n"
            "leak"
        )
    )
    assert_denied(proc)


def test_newline_terminates_hatch_segment(tmp_path):
    """Codex P1 round 5: a newline ends the simple command like `;` — a hatch
    on line 1 must not unlock a write on line 2."""
    proc = run_hook(
        bash_payload("WEAVE_ALLOW_TMP=1 true\necho durable > /tmp/x.md"),
        env_extra={"TMP_BLOCK_LEDGER": str(tmp_path / "ledger.jsonl")},
    )
    assert_denied(proc)


def test_backslash_heredoc_delimiter_stripped():
    """Macroscope round 5: Bash strips the backslash in `<<\\EOF` — the body
    still terminates on `EOF` and must not false-fire."""
    proc = run_hook(
        bash_payload(
            "cat <<\\EOF > /Users/example/Gits/golems/docs.local/notes.md\n"
            "doc example: echo x > /tmp/y.md\n"
            "EOF"
        )
    )
    assert_allowed(proc)


def test_subshell_hatch_does_not_leak(tmp_path):
    """Macroscope round 5: `( WEAVE_ALLOW_TMP=1 ) > /tmp/x.md` — the subshell
    assignment does not scope to the outer redirect; must deny."""
    proc = run_hook(
        bash_payload("( WEAVE_ALLOW_TMP=1 ) > /tmp/x.md"),
        env_extra={"TMP_BLOCK_LEDGER": str(tmp_path / "ledger.jsonl")},
    )
    assert_denied(proc)


def test_ledger_tilde_path_expanded(tmp_path):
    """Bugbot 8f31631b: a tilde-form TMP_BLOCK_LEDGER must expand to HOME,
    not create a literal ./~ relative path."""
    home = tmp_path / "fakehome"
    home.mkdir()
    proc = run_hook(
        write_payload("/tmp/ephemeral-probe.txt"),
        env_extra={
            "WEAVE_ALLOW_TMP": "1",
            "HOME": str(home),
            "TMP_BLOCK_LEDGER": "~/ledgers/tmp-block-ledger.jsonl",
        },
    )
    assert_allowed(proc)
    expanded = home / "ledgers" / "tmp-block-ledger.jsonl"
    assert expanded.exists(), "ledger must land under expanded HOME"


def test_bash_full_path_git_worktree_add_tmp_denied():
    """Bugbot f8d22aeb: /usr/bin/git must not skip the worktree guard."""
    proc = run_hook(bash_payload("/usr/bin/git worktree add /tmp/wt -b fix/x"))
    assert_denied(proc)


def test_tmpdir_tilde_form_denied():
    """Bugbot 943d32dc: a tilde-form TMPDIR must still define the class."""
    proc = run_hook(
        write_payload(os.path.expanduser("~/.tmp-block-test-faketmpdir/notes.md")),
        env_extra={"TMPDIR": "~/.tmp-block-test-faketmpdir"},
    )
    assert_denied(proc)


# --- Escape hatch: allowed AND logged (the log IS the bypass-detector seed) --


def test_escape_hatch_env_allows_and_logs(tmp_path):
    ledger = tmp_path / "tmp-block-ledger.jsonl"
    proc = run_hook(
        write_payload("/tmp/genuinely-ephemeral-probe.txt", "pid lockfile"),
        env_extra={"WEAVE_ALLOW_TMP": "1", "TMP_BLOCK_LEDGER": str(ledger)},
    )
    assert_allowed(proc)
    assert ledger.exists(), "escape-hatch use must be logged to the durable ledger"
    lines = ledger.read_text().strip().splitlines()
    assert len(lines) == 1
    entry = json.loads(lines[0])
    assert entry["tool"] == "Write"
    assert "/tmp/genuinely-ephemeral-probe.txt" in json.dumps(entry)


def test_escape_hatch_inline_bash_allows_and_logs(tmp_path):
    ledger = tmp_path / "tmp-block-ledger.jsonl"
    proc = run_hook(
        bash_payload(
            "WEAVE_ALLOW_TMP=1 cat <<'EOF' > /tmp/ephemeral-probe.txt\nx\nEOF"
        ),
        env_extra={"TMP_BLOCK_LEDGER": str(ledger)},
    )
    assert_allowed(proc)
    assert ledger.exists(), "inline escape-hatch use must be logged too"
    entry = json.loads(ledger.read_text().strip().splitlines()[0])
    assert entry["tool"] == "Bash"


# --- FAIL CLOSED: the S04 half-fire class -------------------------------------


def test_escape_hatch_with_unwritable_ledger_denies(tmp_path):
    """An unlogged bypass must not proceed — if the ledger can't be written,
    the bypass-detector seed is gone, so DENY (fail closed)."""
    proc = run_hook(
        write_payload("/tmp/ephemeral-probe.txt"),
        env_extra={
            "WEAVE_ALLOW_TMP": "1",
            # /dev/null is a file; mkdir/open under it must fail.
            "TMP_BLOCK_LEDGER": "/dev/null/nope/tmp-block-ledger.jsonl",
        },
    )
    assert_denied(proc)


def test_malformed_stdin_fails_closed():
    """S04: 'hook JSON output validation failed, write proceeded'. Inverted:
    any validation error means DENY (A5 cross-cutting #2 [207])."""
    proc = run_hook(raw_stdin="this is not json {{{")
    assert_denied(proc)


def test_invalid_payload_shape_fails_closed():
    proc = run_hook(
        {"tool_name": "Write", "tool_input": "not-a-dict", "session_id": "x"}
    )
    assert_denied(proc)


def test_missing_tool_name_fails_closed():
    """Codex P2 round 6: a payload without tool_name is a validation error —
    defaulting to 'unguarded tool' recreates the S04 allow path."""
    proc = run_hook(
        {"tool_input": {"file_path": "/tmp/x.md", "content": "x"}, "session_id": "x"}
    )
    assert_denied(proc)


def test_tee_in_argument_position_not_denied():
    """Codex P2 round 6: `echo tee /tmp/x` passes words, runs nothing —
    write-shaped verbs must be in command position."""
    proc = run_hook(bash_payload("echo tee /tmp/not-written.md"))
    assert_allowed(proc)
    proc = run_hook(bash_payload("echo git worktree add /tmp/not-created"))
    assert_allowed(proc)
    # ...while command-position wrappers still count.
    proc = run_hook(bash_payload("echo hi | sudo tee /tmp/findings.md"))
    assert_denied(proc)


def test_wrapper_options_keep_tee_in_command_position():
    """Codex P1 round 7: `env -i tee /tmp/out.md` runs tee — wrapper options
    must not demote the real command word."""
    proc = run_hook(bash_payload("echo hi | env -i tee /tmp/out.md"))
    assert_denied(proc)


def test_missing_file_path_fails_closed():
    """Codex P2 round 7: Write/Edit payload with no file_path/notebook_path is
    a schema glitch — deny, never fall through as ''."""
    proc = run_hook(
        {"tool_name": "Write", "tool_input": {"content": "x"}, "session_id": "x"}
    )
    assert_denied(proc)


def test_bare_process_substitution_tee_denied():
    """Macroscope Medium round 9: `echo >(tee /tmp/x)` — process substitution
    without a leading space-separated redirect still runs tee."""
    proc = run_hook(bash_payload("echo >(tee /tmp/out.md)"))
    assert_denied(proc)


def test_ansi_c_quoted_target_denied():
    """Codex P1 round 9: `$'/tmp/out.md'` produces the literal path."""
    proc = run_hook(bash_payload("echo hi > $'/tmp/out.md'"))
    assert_denied(proc)


def test_tmpdir_parameter_expansions():
    """Codex P1 + Bugbot Low round 9: `${TMPDIR:-/tmp}` expands temp-class;
    `$TMPDIR_EXTRA`/`${TMPDIR2}` are different variables and remain unresolved
    without a repo-contained literal prefix."""
    proc = run_hook(bash_payload("echo hi > ${TMPDIR:-/tmp}/x.md"))
    assert_denied(proc)
    proc = run_hook(bash_payload('echo hi > "${TMPDIR%/}/x.md"'))
    assert_denied(proc)
    proc = run_hook(bash_payload("echo hi > $TMPDIR_EXTRA/notes.md"))
    assert_refused(proc)
    proc = run_hook(bash_payload("echo hi > ${TMPDIR2}/file"))
    assert_refused(proc)


def test_static_for_loop_redirect_values_are_resolved(durable_path):
    """2026-08-13 verbatim specimen: the loop value set is finite and every
    redirect target stays in the repo, even through a subshell/background."""
    proc = run_hook(
        bash_payload(
            'for f in r3.fifo obs3.fifo; do '
            '(print -r -- "__quit__" > $f 2>/dev/null &); done'
        ),
        cwd=str(durable_path),
    )
    assert_allowed(proc)


def test_static_for_loop_redirect_denies_if_any_value_is_temp(durable_path):
    proc = run_hook(
        bash_payload(
            f"for f in {durable_path}/safe.fifo /tmp/unsafe.fifo; "
            'do print -r -- "__quit__" > "$f"; done'
        ),
        cwd=str(durable_path),
    )
    assert_denied(proc, must_mention=("/tmp/unsafe.fifo",))


def test_static_for_loop_composes_prior_assignments(durable_path):
    proc = run_hook(
        bash_payload(
            'D=docs.local; for f in "$D"/a "$D"/b; '
            'do printf x > "$f"; done'
        ),
        cwd=str(durable_path),
    )
    assert_allowed(proc)


def test_static_for_loop_composes_literal_array_values(durable_path):
    safe = run_hook(
        bash_payload(
            'files=(docs.local/a docs.local/b); '
            'for f in "${files[@]}"; do printf x > "$f"; done'
        ),
        cwd=str(durable_path),
    )
    assert_allowed(safe)

    unsafe = run_hook(
        bash_payload(
            f'files=({durable_path}/safe /tmp/unsafe); '
            'for f in "${files[@]}"; do printf x > "$f"; done'
        ),
        cwd=str(durable_path),
    )
    assert_denied(unsafe, must_mention=("/tmp/unsafe",))


def test_mutated_literal_array_is_not_treated_as_its_stale_value(durable_path):
    proc = run_hook(
        bash_payload(
            'files=(docs.local/a); files[0]=$RANDOM; '
            'for f in "${files[@]}"; do printf x > "$f"; done'
        ),
        cwd=str(durable_path),
    )
    assert_refused(proc)


def test_loop_or_case_binding_is_overridden_by_body_assignment(durable_path):
    loop = run_hook(
        bash_payload(
            'for f in docs.local/a docs.local/b; '
            'do f=/tmp/overridden; printf x > "$f"; done'
        ),
        cwd=str(durable_path),
    )
    assert_denied(loop, must_mention=("/tmp/overridden",))

    case = run_hook(
        bash_payload(
            'case "$target" in docs.local/a|docs.local/b) '
            'target=/tmp/overridden; printf x > "$target";; esac'
        ),
        cwd=str(durable_path),
    )
    assert_denied(case, must_mention=("/tmp/overridden",))


def test_later_unconditional_assignment_after_unrelated_commands_is_certain(
    durable_path,
):
    commands = (
        'for f in /tmp/a /tmp/b; do echo hi; f=docs.local/x; '
        'printf y > "$f/z.log"; done',
        'for f in /tmp/a /tmp/b; do echo hi; export f=docs.local/x; '
        'printf y > "$f/z.log"; done',
        'for f in /tmp/a /tmp/b; do if [ -n "$X" ]; then echo hi; fi; '
        'f=docs.local/x; printf y > "$f/z.log"; done',
        'for f in /tmp/a /tmp/b; do { echo hi; f=docs.local/x; }; '
        'printf y > "$f/z.log"; done',
        'for f in /tmp/a /tmp/b; do case "$X" in y) echo a;; '
        'z) echo b;; esac; f=docs.local/x; printf y > "$f/z.log"; done',
        'case "$f" in /tmp/a|/tmp/b) echo hi; f=docs.local/x; '
        'printf y > "$f/z.log";; esac',
    )
    for command in commands:
        assert_allowed(
            run_hook(bash_payload(command), cwd=str(durable_path))
        )


def test_guarded_assignments_never_replace_bounded_temp_values(durable_path):
    commands = (
        'for f in /tmp/a /tmp/b; do [ -n "$X" ] && f=safe.txt; '
        'printf x > "$f"; done',
        'for f in /tmp/a; do false && f=safe.txt; printf x > "$f"; done',
        'for f in /tmp/a /tmp/b; do echo hi | f=safe.txt; '
        'printf x > "$f"; done',
    )
    for command in commands:
        assert_denied(
            run_hook(bash_payload(command), cwd=str(durable_path)),
            must_mention=("/tmp/",),
        )


def test_nested_guarded_assignments_never_replace_bounded_temp_values(
    durable_path,
):
    commands = (
        'for f in /tmp/a /tmp/b; do if [ -n "$X" ]; then echo hi; '
        'f=safe.txt; fi; printf x > "$f"; done',
        'for f in /tmp/a /tmp/b; do [ -n "$X" ] && { echo hi; '
        'f=safe.txt; }; printf x > "$f"; done',
        'for f in /tmp/a /tmp/b; do [ -n "$X" ] || { echo hi; '
        'f=safe.txt; }; printf x > "$f"; done',
        'for f in /tmp/a /tmp/b; do if [ -z "$X" ]; then echo hi; '
        'else echo ho; f=safe.txt; fi; printf x > "$f"; done',
        'for f in /tmp/a /tmp/b; do case "$X" in y) echo hi; '
        'f=safe.txt;; esac; printf x > "$f"; done',
        'for f in /tmp/a /tmp/b; do echo hi | { cat >/dev/null; '
        'f=safe.txt; }; printf x > "$f"; done',
        'for f in /tmp/a /tmp/b; do { echo hi >/dev/null; '
        'f=safe.txt; } & printf x > "$f"; done',
        'for f in /tmp/a /tmp/b; do { if [ -n "$X" ]; then '
        'echo hi; f=safe.txt; fi; }; printf x > "$f"; done',
        'for f in /tmp/a /tmp/b; do [ -f "$f" ] && { rm -f "$f"; '
        'f=out.log; }; printf x > "$f"; done',
        'for f in /tmp/a /tmp/b; do if [ -n "$X" ]; then echo fi; '
        'f=safe.txt; fi; printf x > "$f"; done',
        'for f in /tmp/a /tmp/b; do case "$X" in y) echo esac; '
        'f=safe.txt;; esac; printf x > "$f"; done',
    )
    for command in commands:
        assert_denied(
            run_hook(bash_payload(command), cwd=str(durable_path)),
            must_mention=("/tmp/",),
        )


def test_guarded_or_subshell_scoped_assignment_cannot_erase_temp_values(
    durable_path,
):
    commands = (
        'for f in /tmp/a; do false && f=safe.txt; printf x > "$f"; done',
        'for f in /tmp/a; do echo x | f=safe.txt; printf x > "$f"; done',
        'for f in /tmp/a; do f=safe.txt & printf x > "$f"; done',
        'for f in /tmp/a; do false && f=safe.txt; printf x | tee "$f"; done',
        'case "$f" in /tmp/a) false && f=safe.txt; printf x > "$f";; esac',
        'for w in /tmp/wt; do false && w=.worktrees/ok; '
        'git worktree add "$w"; done',
    )
    for command in commands:
        assert_denied(
            run_hook(bash_payload(command), cwd=str(durable_path)),
            must_mention=("/tmp/",),
        )


def test_guarded_assignment_keeps_every_prior_bounded_candidate(durable_path):
    commands = (
        'for f in safe.txt; do f=/tmp/overridden; '
        'false && f=safe-again.txt; printf x > "$f"; done',
        'for f in safe.txt; do f=/tmp/overridden; '
        '[ -n "$X" ] && f=safe-again.txt; printf x > "$f"; done',
        'for f in safe.txt; do f=/tmp/overridden; '
        'echo x | f=safe-again.txt; printf x > "$f"; done',
        'for f in safe.txt; do f=/tmp/overridden; '
        'f=safe-again.txt & printf x > "$f"; done',
        'for f in safe.txt; do f=/tmp/overridden; g=1; '
        '[ -n "$X" ] && f=safe-again.txt; printf x > "$f"; done',
        'for f in safe.txt; do export f=/tmp/overridden; '
        '[ -n "$X" ] && f=safe-again.txt; printf x > "$f"; done',
        'for f in safe.txt; do f=/tmp/overridden; '
        '[ -n "$X" ] && f=safe-again.txt; printf x | tee "$f"; done',
        'select f in safe.txt; do f=/tmp/overridden; '
        '[ -n "$X" ] && f=safe-again.txt; printf x > "$f"; done',
        'case "$f" in safe.txt) f=/tmp/overridden; '
        'false && f=safe-again.txt; printf x > "$f";; esac',
    )
    for command in commands:
        assert_denied(
            run_hook(bash_payload(command), cwd=str(durable_path)),
            must_mention=("/tmp/overridden",),
        )


def test_loop_carried_cwd_change_keeps_relative_target_unresolved(durable_path):
    proc = run_hook(
        bash_payload(
            'for f in a b; do printf x > "$f"; cd /tmp; done'
        ),
        cwd=str(durable_path),
    )
    assert_refused(proc)


def test_indirect_cwd_changes_before_subshell_keep_anchor_unresolved(
    durable_path,
):
    commands = (
        'builtin cd /tmp; (printf x > out.txt)',
        'eval "cd /tmp"; (printf x > out.txt)',
        'C=cd; $C /tmp; (printf x > out.txt)',
        'go() { cd /tmp; }; go; (printf x > out.txt)',
    )
    for command in commands:
        assert_refused(run_hook(bash_payload(command), cwd=str(durable_path)))


def test_unbounded_loop_and_unset_redirect_are_refused(durable_path):
    for command in (
        'for f in $LIST; do printf x > "$f"; done',
        'printf x > "$UNSET"',
    ):
        assert_refused(run_hook(bash_payload(command), cwd=str(durable_path)))


def test_statically_empty_loop_value_set_allows_silently(durable_path):
    for command in (
        'for f in; do printf x > "$f"; done',
        'for f in $(false); do printf x > "$f"; done',
        'files=(); for f in "${files[@]}"; do printf x > "$f"; done',
    ):
        assert_allowed(run_hook(bash_payload(command), cwd=str(durable_path)))


def test_bounded_brace_redirect_values_are_all_judged(durable_path):
    assert_allowed(
        run_hook(
            bash_payload("printf x > {docs.local/a,docs.local/b}"),
            cwd=str(durable_path),
        )
    )
    assert_denied(
        run_hook(
            bash_payload(
                f"printf x > {{{durable_path}/safe,/tmp/unsafe}}"
            ),
            cwd=str(durable_path),
        ),
        must_mention=("/tmp/unsafe",),
    )


def test_literal_case_patterns_bound_the_subject_value(durable_path):
    safe = run_hook(
        bash_payload(
            'case "$target" in docs.local/a|docs.local/b) '
            'printf x > "$target";; esac'
        ),
        cwd=str(durable_path),
    )
    assert_allowed(safe)

    unsafe = run_hook(
        bash_payload(
            f'case "$target" in {durable_path}/safe|/tmp/unsafe) '
            'printf x > "$target";; esac'
        ),
        cwd=str(durable_path),
    )
    assert_denied(unsafe, must_mention=("/tmp/unsafe",))

    unbounded = run_hook(
        bash_payload(
            'case "$target" in docs.local/*) printf x > "$target";; esac'
        ),
        cwd=str(durable_path),
    )
    assert_refused(unbounded)


def test_static_loop_values_feed_tee_and_worktree_judgment(durable_path):
    tee = run_hook(
        bash_payload(
            f"for f in {durable_path}/safe /tmp/unsafe; "
            'do printf x | tee "$f"; done'
        ),
        cwd=str(durable_path),
    )
    assert_denied(tee, must_mention=("/tmp/unsafe",))

    worktree = run_hook(
        bash_payload(
            'for wt in .worktrees/a .worktrees/b; '
            'do git worktree add "$wt"; done'
        ),
        cwd=str(durable_path),
    )
    assert_allowed(worktree)


def test_env_prefixed_hatch_recognized(tmp_path):
    """Bugbot Medium round 9: `env WEAVE_ALLOW_TMP=1 cmd` sets the var for
    cmd — the hatch must be honored (allowed AND logged)."""
    ledger = tmp_path / "ledger.jsonl"
    proc = run_hook(
        bash_payload("env WEAVE_ALLOW_TMP=1 echo hi > /tmp/x.md"),
        env_extra={"TMP_BLOCK_LEDGER": str(ledger)},
    )
    assert_allowed(proc)
    assert ledger.exists()


def test_wrapper_option_values_do_not_demote_tee():
    """Codex P1 round 9: `-u FOO` consumes a value — the real tee after it
    is still the command."""
    proc = run_hook(bash_payload("echo hi | env -u FOO tee /tmp/out.md"))
    assert_denied(proc)
    proc = run_hook(bash_payload("echo hi | sudo -u root tee /tmp/out.md"))
    assert_denied(proc)


def test_fd_dup_does_not_split_hatch_segment(tmp_path):
    """`2>&1` is an fd-dup, not a command separator — a hatched write with
    stderr merged must stay hatched (allowed AND logged)."""
    ledger = tmp_path / "ledger.jsonl"
    proc = run_hook(
        bash_payload("WEAVE_ALLOW_TMP=1 make check 2>&1 > /tmp/check-log.txt"),
        env_extra={"TMP_BLOCK_LEDGER": str(ledger)},
    )
    assert_allowed(proc)
    assert ledger.exists()


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


def test_worktree_sibling_dot_wt_denied():
    """The observed drift shape: a sibling `<repo>.wt/` directory."""
    proc = run_hook(
        bash_payload(f"git worktree add {GITS}/golems.wt/fix-foo -b fix/foo")
    )
    assert_denied(proc, must_mention=(".worktrees",))


def test_worktree_sibling_denied_names_the_fixed_command():
    """A corrective deny names the ratified convention AND the exact fix,
    derived from the drift shape itself (`<repo>.wt/` -> `<repo>`) so it is
    copy-pasteable.

    The fixture is built under HOME, not pytest's tmp_path: tmp_path lives in
    the TEMP path-class, where Rule 1 would deny first and Rule 2 would never
    be reached."""
    root = Path.home() / ".tmp-block-test-wt-fixture"
    repo = root / "golems"
    try:
        (repo / ".git").mkdir(parents=True, exist_ok=True)
        (root / "golems.wt").mkdir(parents=True, exist_ok=True)
        proc = run_hook(
            bash_payload(
                f"git -C {repo} worktree add {root}/golems.wt/fix-foo -b fix/foo"
            )
        )
        assert_denied(
            proc,
            must_mention=(
                "git worktree add",
                str(repo / ".worktrees" / "fix-foo"),
            ),
        )
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_worktree_arbitrary_offconvention_paths_denied():
    """Not just `.wt` siblings — anything outside a `.worktrees/` parent."""
    for cmd in (
        f"git worktree add {GITS}/scratch-wt -b x",
        f"git worktree add /opt/private/coordination-worktrees/lane-a",
        f"git -C {GITS}/golems worktree add {GITS}/golems-copy origin/master",
        f'git worktree add "$HOME/Gits/golems.wt/quoted" -b x',
    ):
        proc = run_hook(bash_payload(cmd))
        assert_denied(proc, must_mention=(".worktrees",))


def test_worktree_on_convention_allowed():
    """The ratified shape — absolute, tilde, `git -C`, and relative forms."""
    for cmd in (
        f"git worktree add {GITS}/golems/.worktrees/p2-foo -b p2/foo origin/master",
        "git worktree add /opt/private/coordination/.worktrees/lane-a -b lane/a",
        f"git -C {GITS}/golems worktree add {GITS}/golems/.worktrees/x",
        f'git worktree add "$HOME/Gits/golems/.worktrees/quoted" -b x',
    ):
        proc = run_hook(bash_payload(cmd))
        assert_allowed(proc)


def test_worktree_relative_on_convention_allowed(durable_path):
    """A relative target resolves against the session cwd (no `cd` in play)."""
    proc = run_hook(
        bash_payload("git worktree add .worktrees/lane-b -b lane/b"),
        cwd=str(durable_path),
    )
    assert_allowed(proc)


def test_worktree_relative_offconvention_denied(durable_path):
    """Codex-shaped `../<repo>.wt/x` is drift once resolved against cwd."""
    proc = run_hook(
        bash_payload("git worktree add ../golems.wt/lane-c -b lane/c"),
        cwd=str(durable_path),
    )
    assert_denied(proc, must_mention=(".worktrees",))


def test_worktree_relative_uses_git_c_anchor(durable_path):
    """golems#685 live shape: `git -C` supplies the missing static anchor."""
    proc = run_hook(
        bash_payload(f"git -C {durable_path} worktree add .worktrees/c1"),
        cwd=str(durable_path.parent),
    )
    assert_allowed(proc)


def test_worktree_relative_offconvention_uses_git_c_anchor_and_fixed_command(durable_path):
    """A resolvable relative drift is a DENY, not an unattended ASK."""
    repo = durable_path / "repo"
    (repo / ".git").mkdir(parents=True)
    proc = run_hook(
        bash_payload(f"git -C {repo} worktree add ../elsewhere/c1"),
        cwd=str(durable_path.parent),
    )
    assert_denied(
        proc,
        must_mention=(
            f"git -C {repo} worktree add {repo / '.worktrees' / 'c1'}",
        ),
    )


def test_worktree_relative_uses_static_cd_anchor(durable_path):
    repo = durable_path / "repo"
    proc = run_hook(
        bash_payload(f"cd {repo} && git worktree add .worktrees/c1"),
        cwd=str(durable_path.parent),
    )
    assert_allowed(proc)


def test_worktree_git_c_anchor_overrides_static_cd(durable_path):
    repo_a = durable_path / "a"
    repo_b = durable_path / "b"
    (repo_b / ".worktrees").mkdir(parents=True)
    proc = run_hook(
        bash_payload(f"cd {repo_a} && git -C {repo_b / '.worktrees'} worktree add c1"),
        cwd=str(durable_path.parent),
    )
    assert_allowed(proc)


def test_worktree_git_c_anchor_isolated_from_unresolvable_prior_segment(durable_path):
    proc = run_hook(
        bash_payload(f"cd $UNSET; git -C {durable_path} worktree add .worktrees/c1"),
        cwd=str(durable_path.parent),
    )
    assert_allowed(proc)


def test_worktree_repeated_git_c_composes_left_to_right(durable_path):
    (durable_path / ".worktrees").mkdir()
    proc = run_hook(
        bash_payload(f"git -C {durable_path} -C .worktrees worktree add c1"),
        cwd=str(durable_path.parent),
    )
    assert_allowed(proc)


def test_worktree_anchored_relative_temp_class_still_denied_by_tmp_rule(tmp_path):
    """Rule 1 judges the resolved target and the WT hatch cannot unlock it."""
    commands = (
        "git -C /tmp/repo worktree add .worktrees/x",
        "cd /private/tmp/repo && git worktree add .worktrees/x",
        'git -C "$TMPDIR/repo" worktree add .worktrees/x',
    )
    for command in commands:
        proc = run_hook(
            bash_payload(command),
            cwd=str(tmp_path),
            env_extra={"TMPDIR": "/private/tmp"},
        )
        assert_denied(proc, must_mention=("TMP-BLOCK",))

        proc = run_hook(
            bash_payload(command),
            cwd=str(tmp_path),
            env_extra={
                "WEAVE_ALLOW_WT_MIGRATION": "1",
                "TMP_BLOCK_LEDGER": str(tmp_path / "ledger.jsonl"),
                "TMPDIR": "/private/tmp",
            },
        )
        assert_denied(proc, must_mention=("TMP-BLOCK",))


def test_worktree_non_parent_cd_does_not_supply_anchor(tmp_path):
    """Subshell and conditionally skipped cd effects are not the parent cwd."""
    nested = tmp_path / ".worktrees"
    nested.mkdir()
    for command in (
        f"(cd {nested}); git worktree add x",
        f"false && cd {nested}; git worktree add x",
    ):
        proc = run_hook(bash_payload(command), cwd=str(tmp_path))
        assert_refused(proc)


def test_worktree_non_creation_verbs_allowed():
    """Reads and teardown are never the guard's business."""
    for cmd in (
        "git worktree list",
        f"git worktree remove {GITS}/golems.wt/fix-foo",
        "git worktree prune",
        f"ls {GITS}/golems.wt",
        f"rm -rf {GITS}/golems.wt/fix-foo",
    ):
        proc = run_hook(bash_payload(cmd))
        assert_allowed(proc)


def test_worktree_prose_does_not_false_fire():
    """golems#676 second manifestation, verbatim class: the guard blocked the
    `gh issue create` FILING the bug because the title carried the offending
    string as prose. Quoted text and heredoc bodies run nothing."""
    for cmd in (
        f'gh issue create --title "stop running git worktree add {GITS}/foo.wt/bar"',
        f"echo git worktree add {GITS}/golems.wt/never-created",
        f"cat <<'EOF' > {GITS}/golems/docs.local/notes.md\n"
        f"bad example: git worktree add {GITS}/golems.wt/x\n"
        "EOF",
        f"# git worktree add {GITS}/golems.wt/x",
        f"grep -rn 'git worktree add' {GITS}/golems",
    ):
        proc = run_hook(bash_payload(cmd))
        assert_allowed(proc)


def test_worktree_unresolvable_variable_is_refused_with_its_reason():
    """golems#676 first manifestation: judging the UNEXPANDED literal is the
    bug. An unset variable is unknowable statically, so the refusal must NAME
    what it could not read -- #676's requirement, which outlived the prompt
    that originally carried it (two-valued contract, 2026-08-17)."""
    proc = run_hook(bash_payload('git worktree add "$WT_ROOT/lane-a" -b lane/a'))
    assert_refused(proc, must_mention=("WT_ROOT", ".worktrees"))


def test_worktree_command_substitution_is_refused():
    proc = run_hook(bash_payload("git worktree add $(mktemp -d)/wt -b lane/a"))
    assert_refused(proc)


def test_worktree_unresolvable_git_c_variable_is_refused():
    proc = run_hook(
        bash_payload("git -C $UNSET_VAR worktree add .worktrees/x")
    )
    assert_refused(proc, must_mention=("UNSET_VAR",))


def test_worktree_git_c_command_substitution_is_refused():
    proc = run_hook(
        bash_payload('git -C "$(some cmd)" worktree add .worktrees/x')
    )
    assert_refused(proc, must_mention=("command substitution",))


def test_worktree_glob_or_brace_anchor_and_target_are_refused():
    for cmd in (
        "git -C '/Users/example/repos/*' worktree add .worktrees/x",
        "git -C '/Users/example/{a,b}' worktree add .worktrees/x",
        "git -C /Users/example/repo worktree add '.worktrees/*'",
        "git -C /Users/example/repo worktree add '.worktrees/{a,b}'",
    ):
        proc = run_hook(bash_payload(cmd))
        assert_refused(proc)


def test_repo_contained_worktree_glob_target_is_allowed():
    proc = run_hook(bash_payload("git worktree add '.worktrees/[ab]'"))
    assert_allowed(proc)


def test_worktree_resolvable_variable_is_judged_on_the_resolved_path():
    """Variables are not a free pass: a var that DOES resolve is judged."""
    env = {"WT_ROOT": f"{GITS}/golems.wt"}
    proc = run_hook(bash_payload('git worktree add "$WT_ROOT/lane-a" -b lane/a'), env_extra=env)
    assert_denied(proc, must_mention=(".worktrees",))

    env_ok = {"REPO": f"{GITS}/golems"}
    proc = run_hook(
        bash_payload('git worktree add "${REPO}/.worktrees/lane-a" -b lane/a'),
        env_extra=env_ok,
    )
    assert_allowed(proc)


def test_worktree_relative_after_cd_is_refused(tmp_path):
    """An unresolvable directory change is refused, never blocked blind on the
    unexpanded literal (golems#676 rule, two-valued form)."""
    proc = run_hook(
        bash_payload("cd $UNSET && git worktree add .worktrees/x -b x"),
        cwd=str(tmp_path),
    )
    assert_refused(proc)


def test_worktree_temp_class_still_denied_by_the_tmp_rule():
    """Precedence: a temp-class worktree keeps the TMP-BLOCK deny (the
    convention rule must not downgrade it to a prompt)."""
    proc = run_hook(bash_payload("git worktree add /tmp/leak-fix-wt -b fix/leak"))
    assert_denied(proc, must_mention=("TMP-BLOCK", ".worktrees"))


def test_worktree_migration_hatch_allows_and_logs(tmp_path):
    """Migration window: WEAVE_ALLOW_WT_MIGRATION=1 permits an off-convention
    add, but every use is LOGGED (the log is the bypass detector), mirroring
    tmp-block's own hatch pattern."""
    ledger = tmp_path / "ledger.jsonl"
    proc = run_hook(
        bash_payload(
            f"WEAVE_ALLOW_WT_MIGRATION=1 git worktree add {GITS}/golems.wt/fix-foo -b fix/foo"
        ),
        env_extra={"TMP_BLOCK_LEDGER": str(ledger)},
    )
    assert_allowed(proc)
    assert ledger.exists(), "migration-hatch use must be logged to the durable ledger"
    entry = json.loads(ledger.read_text().strip().splitlines()[0])
    assert entry["hatch"] == "WEAVE_ALLOW_WT_MIGRATION=1"
    assert "golems.wt/fix-foo" in json.dumps(entry)


def test_worktree_migration_hatch_env_form_allows_and_logs(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    proc = run_hook(
        bash_payload(f"git worktree add {GITS}/golems.wt/fix-foo -b fix/foo"),
        env_extra={
            "WEAVE_ALLOW_WT_MIGRATION": "1",
            "TMP_BLOCK_LEDGER": str(ledger),
        },
    )
    assert_allowed(proc)
    assert ledger.exists()


def test_worktree_migration_hatch_is_scoped_to_its_own_segment(tmp_path):
    """Bash assignment-prefix scope: a hatch on a harmless first command must
    not unlock a later off-convention add."""
    proc = run_hook(
        bash_payload(
            f"WEAVE_ALLOW_WT_MIGRATION=1 true && git worktree add {GITS}/golems.wt/x -b x"
        ),
        env_extra={"TMP_BLOCK_LEDGER": str(tmp_path / "ledger.jsonl")},
    )
    assert_denied(proc)


def test_worktree_hatch_does_not_unlock_the_temp_class(tmp_path):
    """The migration hatch is location-convention only — it must NOT become a
    route-around for the temp path-class (that needs WEAVE_ALLOW_TMP)."""
    proc = run_hook(
        bash_payload("git worktree add /tmp/wt -b x"),
        env_extra={
            "WEAVE_ALLOW_WT_MIGRATION": "1",
            "TMP_BLOCK_LEDGER": str(tmp_path / "ledger.jsonl"),
        },
    )
    assert_denied(proc, must_mention=("TMP-BLOCK",))


def test_worktree_migration_hatch_with_unwritable_ledger_denies():
    """An unlogged bypass must not proceed — fail closed, as with the tmp hatch."""
    proc = run_hook(
        bash_payload(f"git worktree add {GITS}/golems.wt/fix-foo -b fix/foo"),
        env_extra={
            "WEAVE_ALLOW_WT_MIGRATION": "1",
            "TMP_BLOCK_LEDGER": "/dev/null/nope/ledger.jsonl",
        },
    )
    assert_denied(proc)


# --- 2026-08-17: the two-valued contract ------------------------------------
# Etan, by voice: "none of y'all would be able to write to temp, but also not
# ask me so we don't get agent stuck". Allow or deny; never a prompt.


def test_no_shape_ever_emits_a_prompt(durable_path):
    """The whole point: a pane must never be stranded on a yes/no question."""
    shapes = (
        'printf x > /tmp/a.txt',
        'printf x > "$UNSET_TARGET"',
        'P=$(mktemp); printf x > "$P"',
        'f=$(printf %s ~/Documents/c.txt); printf x > "$f"',
        'printf x > ~/Documents/probe_$$.txt',
        'printf x | tee "$(printf %s /tmp/t.txt)"',
        'for f in $LIST; do printf x > "$f"; done',
    )
    for command in shapes:
        proc = run_hook(bash_payload(command), cwd=str(durable_path))
        assert proc.returncode in (0, 2), f"{command!r} -> exit {proc.returncode}"
        if proc.stdout.strip() and proc.stdout.strip() != "{}":
            payload = json.loads(proc.stdout)
            assert _prompt_decision(payload) != "ask", (
                f"{command!r} emitted a PreToolUse prompt: {proc.stdout[:200]!r}"
            )


def test_temp_writes_cannot_escape_through_a_variable(durable_path):
    """Live 2026-08-14 safety miss: these reached only a prompt, so they ran.

    Routing a temp path through a variable, or through mktemp, used to weaken
    the guard from hard deny to a question -- which a human then approved.
    """
    for command in (
        'P=/private/tmp/x_$$.txt; printf x > "$P"',
        'P=$(mktemp); printf x > "$P"',
        'printf x > "$(mktemp)"',
        'P=${TMPDIR}x_$$.txt; printf x > "$P"',
    ):
        assert_denied(run_hook(bash_payload(command), cwd=str(durable_path)))


def test_durable_home_targets_with_a_dynamic_suffix_are_allowed(durable_path):
    """The live 2026-08-14 false alarm: BrainLayer's Spotlight probes.

    `~/Documents` and `~/.local/share` are neither temp nor inside a repo. The
    guard could prove only those two classes, so it asked about the entire home
    directory -- overnight, on every probe.
    """
    for command in (
        'printf x > ~/Documents/blprobe_$$.txt',
        'P=~/Documents/blprobe_2.txt; printf x > "$P"',
        'printf x > $HOME/.local/share/brainlayer/probe_$$.txt',
        'printf x | tee ~/Documents/t.txt',
    ):
        assert_allowed(run_hook(bash_payload(command), cwd=str(durable_path)))


def test_no_deny_reason_reads_as_a_question(durable_path):
    """A block that opens `❓` reads as a question the agent can answer.

    It cannot -- there is no prompt any more. An agent that thinks it was
    ASKED retries the same command instead of rewriting it, which is exactly
    the confusion the two-valued contract exists to remove. Every deny opens
    `⛔`.
    """
    for command in (
        'printf x > /tmp/a.txt',
        'printf x > "$UNSET_TARGET"',
        'P=$(mktemp); printf x > "$P"',
        'printf x | tee "$(basename /tmp/x)"',
        'git worktree add "$UNSET_TARGET/wt" HEAD',
        'git worktree add ../off-convention HEAD',
        'for f in $LIST; do printf x > "$f"; done',
    ):
        proc = run_hook(bash_payload(command), cwd=str(durable_path))
        if proc.returncode == 0:
            continue
        reason = json.loads(proc.stdout).get("reason", "")
        assert reason.startswith("⛔"), f"{command!r} -> {reason[:120]!r}"
        assert "❓" not in reason, f"{command!r} -> {reason[:120]!r}"
        for ask_era in ("Approve only", "approve only", "otherwise cancel"):
            assert ask_era not in reason, f"{command!r} kept ask-era wording"


def test_hook_source_cannot_emit_a_permission_prompt():
    """Structural guard on the contract, not on one specimen's output.

    `ask()` was renamed to `refuse_unresolvable()` for the same reason: the
    prompt path must be hard to reintroduce by accident.
    """
    source = HOOK.read_text()
    code = "\n".join(
        line for line in source.splitlines() if not line.lstrip().startswith("#")
    ).split('"""')
    # Even-indexed chunks are code; odd-indexed are docstrings, which may
    # still name the removed API to explain why it is gone.
    executable = "".join(code[::2])
    # The ban is on the PROMPT, not on the word. Since 2026-08-19 the refusal
    # carries `permissionDecision: "deny"` so Codex honours it
    # (developers.openai.com/codex/hooks), which means `permissionDecision`
    # and `hookSpecificOutput` are now legitimately present in executable code.
    # What must never reappear is the ask value or an ask() entry point.
    assert '"ask"' not in executable
    assert "'ask'" not in executable
    assert "\ndef ask(" not in source
    # ...and the deny dialect must still actually be emitted, so this test
    # cannot be satisfied by deleting the feature it guards.
    assert "permissionDecision" in executable
    assert '"deny"' in executable


def test_variable_assigned_durable_target_is_allowed(durable_path):
    """A literal head proves the class through a variable, exactly as inline.

    `P=~/Documents/x_$$.txt` cannot escape its own prefix -- `$$` is appended,
    not substituted for the path. Refusing this while allowing the identical
    `> ~/Documents/x_$$.txt` made the verdict depend on whether the author
    used a variable, which is friction with no safety return.
    """
    for command in (
        'P=~/Documents/blprobe_$$.txt; printf x > "$P"',
        'P=$HOME/Documents/blprobe_$$.txt; printf x > "$P"',
        'P=~/Documents/blprobe_$$.txt; printf x | tee "$P"',
        'printf x | tee ~/Documents/blprobe_$$.txt',
    ):
        assert_allowed(run_hook(bash_payload(command), cwd=str(durable_path)))


def test_variable_literal_head_still_proves_the_temp_class(durable_path):
    """The same proof that allows durable heads must deny temp ones.

    A partial head is enough evidence in BOTH directions: these now reach
    Rule 1's hard temp-class deny rather than the weaker unresolvable refusal.
    Every head here is a literal temp path, so the verdict does not depend on
    the host's environment.
    """
    for command in (
        'P=/private/tmp/x_$$.txt; printf x > "$P"',
        'P=/tmp/x_$$.txt; printf x | tee "$P"',
        'P=$HOME/../../private/tmp/x_$$.txt; printf x > "$P"',
    ):
        proc = run_hook(bash_payload(command), cwd=str(durable_path))
        assert_denied(proc)
        assert "temp path-class" in json.loads(proc.stdout)["reason"], command


def test_tmpdir_variable_head_is_read_when_tmpdir_is_set(durable_path):
    """`${TMPDIR}` only yields a head when the hook can see a TMPDIR value.

    With one set, the head resolves into the temp class and reaches the hard
    deny. With none set, there is no head to read and the target is refused as
    unresolvable instead -- a weaker reason but the same fail-closed verdict,
    which is why the environment-independent assertion below is just `denied`.
    """
    command = 'P=${TMPDIR}/x_$$.txt; printf x > "$P"'

    proc = run_hook(
        bash_payload(command),
        env_extra={"TMPDIR": "/private/tmp"},
        cwd=str(durable_path),
    )
    assert_denied(proc)
    assert "temp path-class" in json.loads(proc.stdout)["reason"]


def test_tmpdir_variable_head_is_denied_with_or_without_tmpdir(durable_path):
    """Whether or not TMPDIR is set, the write never gets through."""
    command = 'P=${TMPDIR}x_$$.txt; printf x > "$P"'

    for env_extra in ({"TMPDIR": "/private/tmp/"}, {"TMPDIR": ""}):
        assert_denied(
            run_hook(
                bash_payload(command),
                env_extra=env_extra,
                cwd=str(durable_path),
            )
        )


def test_variable_without_a_literal_head_proves_nothing(durable_path):
    """No head, no proof -- an unknown value is refused, never guessed."""
    for command in (
        'P=$UNSET_TARGET/logs; printf x > "$P/f.log"',
        'P=$(mktemp); printf x > "$P"',
        'P=$(printf %s /some/where); printf x > "$P/f.log"',
    ):
        assert_refused(run_hook(bash_payload(command), cwd=str(durable_path)))


def test_conditional_assignment_cannot_lend_its_literal_head(durable_path):
    """An assignment that may not have run leaves the variable's head unknown.

    `false && P=...` never executes, so `$P` may still hold anything --
    including a temp path -- and the head from the skipped assignment must
    not be borrowed to prove `outside`.
    """
    command = 'false && P=~/Documents/x_$$.txt; printf x > "$P"'

    assert_refused(run_hook(bash_payload(command), cwd=str(durable_path)))




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
    f"/private/tmp/claude-501/-Users-etanheyman-Gits-brainlayer/"
    f"{SCRATCHPAD_UUID}/scratchpad"
)


def test_observed_scratchpad_redirect_is_allowed(durable_path):
    """The verbatim 2026-08-17 brainlayerClaude denial must now allow."""
    proc = run_hook(
        bash_payload(f'echo noise > {SCRATCHPAD_DIR}/monitor-selftest.txt'),
        cwd=str(durable_path),
    )
    assert_allowed(proc)


def test_scratchpad_write_and_edit_are_allowed():
    """Rule 1's file-tool surface honours the exception too, not just redirects."""
    path = f"{SCRATCHPAD_DIR}/notes.md"
    assert_allowed(run_hook(write_payload(path)))
    assert_allowed(
        run_hook(
            {
                "tool_name": "Edit",
                "tool_input": {
                    "file_path": path,
                    "old_string": "a",
                    "new_string": "b",
                },
                "session_id": "tmp-block-test",
            }
        )
    )


def test_scratchpad_every_write_surface_is_allowed(durable_path):
    """The exception is not redirect-only: appends, tee and heredocs too."""
    target = f"{SCRATCHPAD_DIR}/surface.txt"
    for command in (
        f"printf x > {target}",
        f"printf x >> {target}",
        f"printf x | tee {target}",
        f"printf x | tee -a {target}",
        f"cat > {target} <<'EOF'\nbody\nEOF",
        f"cat <<'EOF' > {target}\nbody\nEOF",
    ):
        assert_allowed(run_hook(bash_payload(command), cwd=str(durable_path)))


def test_scratchpad_with_a_dynamic_filename_is_allowed(durable_path):
    """A dynamic leaf under a proven scratchpad prefix is still the scratchpad."""
    proc = run_hook(
        bash_payload(f'printf x > {SCRATCHPAD_DIR}/probe_$$.txt'),
        cwd=str(durable_path),
    )
    assert_allowed(proc)


def test_bare_scratchpad_directory_without_the_session_chain_is_denied(durable_path):
    """`/private/tmp/scratchpad` is not the harness's — it has no session chain."""
    assert_denied(run_hook(write_payload("/private/tmp/scratchpad/x.txt")))
    assert_denied(
        run_hook(
            bash_payload("printf x > /private/tmp/scratchpad/x.txt"),
            cwd=str(durable_path),
        )
    )


def test_claude_uid_dir_without_a_scratchpad_component_is_denied(durable_path):
    """The uid directory alone is temp; only the full chain is allowlisted."""
    assert_denied(run_hook(write_payload("/private/tmp/claude-501/x.txt")))
    assert_denied(
        run_hook(
            write_payload(
                f"/private/tmp/claude-501/-Users-etanheyman-Gits-golems/"
                f"{SCRATCHPAD_UUID}/x.txt"
            )
        )
    )
    assert_denied(
        run_hook(
            bash_payload("printf x > /private/tmp/claude-501/x.txt"),
            cwd=str(durable_path),
        )
    )


def test_scratchpad_shape_requires_a_session_uuid(durable_path):
    """Match the structure — a non-UUID component is not a session directory."""
    assert_denied(
        run_hook(
            write_payload(
                "/private/tmp/claude-501/-Users-etanheyman-Gits-golems/"
                "not-a-uuid/scratchpad/x.txt"
            )
        )
    )


def test_scratchpad_dotdot_escape_is_denied(durable_path):
    """`..` out of the scratchpad lands in the bare temp class and is judged there."""
    assert_denied(run_hook(write_payload(f"{SCRATCHPAD_DIR}/../../../../leak.txt")))
    assert_denied(
        run_hook(
            bash_payload(f"printf x > {SCRATCHPAD_DIR}/../../../../leak.txt"),
            cwd=str(durable_path),
        )
    )


def test_mktemp_still_denied_alongside_the_scratchpad_exception(durable_path):
    """`$(mktemp)` has no scratchpad chain — both forms stay refused."""
    for command in (
        'printf x > "$(mktemp)"',
        'T=$(mktemp); echo noise > "$T"',
        'T=$(mktemp -d); printf x > "$T/f.txt"',
    ):
        assert_refused(run_hook(bash_payload(command), cwd=str(durable_path)))


def test_plain_tmp_still_denied_alongside_the_scratchpad_exception(durable_path):
    """The rest of the temp class is untouched by the exception."""
    assert_denied(run_hook(write_payload("/tmp/foo.txt")))
    assert_denied(
        run_hook(bash_payload("printf x > /tmp/foo.txt"), cwd=str(durable_path))
    )


def test_scratchpad_component_must_be_exact_not_a_prefix_or_suffix(durable_path):
    """`scratchpad-evil` and `myscratchpad` are not the harness's scratchpad.

    Mutation guard (#727 review): relaxing the exact-component check to
    `"scratchpad" in pad` opened both of these as ALLOW while the whole suite
    stayed green. A deny-side test that no mutation can redden is decoration.
    """
    for evil in ("scratchpad-evil", "myscratchpad", "scratchpad.bak"):
        path = (
            f"/private/tmp/claude-501/-Users-etanheyman-Gits-golems/"
            f"{SCRATCHPAD_UUID}/{evil}/x.txt"
        )
        assert_denied(run_hook(write_payload(path)))
        assert_denied(
            run_hook(bash_payload(f"printf x > {path}"), cwd=str(durable_path))
        )


def test_uid_dir_must_be_claude_plus_digits(durable_path):
    """The uid component is `claude-<digits>` — not any directory at all.

    Mutation guard (#727 review): dropping the `_CLAUDE_UID_DIR_RE` check made
    every `/private/tmp/<anything>/<slug>/<uuid>/scratchpad/` an ALLOW with the
    suite still green. These cases redden that mutation.
    """
    for uid_dir in ("claude-abc", "claude-", "claude", "notclaude-501", "attacker"):
        path = (
            f"/private/tmp/{uid_dir}/-Users-etanheyman-Gits-golems/"
            f"{SCRATCHPAD_UUID}/scratchpad/x.txt"
        )
        assert_denied(run_hook(write_payload(path)))
        assert_denied(
            run_hook(bash_payload(f"printf x > {path}"), cwd=str(durable_path))
        )


def test_scratchpad_chain_must_sit_directly_under_a_temp_root(durable_path):
    """One extra component before `claude-<uid>` breaks the chain.

    Pins the "directly under a temp root" half of the shape: without it, an
    attacker-controlled subdirectory could carry a well-formed chain.
    """
    path = (
        f"/private/tmp/nested/claude-501/-Users-etanheyman-Gits-golems/"
        f"{SCRATCHPAD_UUID}/scratchpad/x.txt"
    )
    assert_denied(run_hook(write_payload(path)))
    assert_denied(
        run_hook(bash_payload(f"printf x > {path}"), cwd=str(durable_path))
    )
