from .common import *  # noqa: F403

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


