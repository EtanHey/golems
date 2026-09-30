from .common import *  # noqa: F403

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
    # GO-5 E2: a hook error with no temp hint in the payload is an advisory.
    assert proc.returncode == 0 and "TMP-BLOCK advisory: hook error" in proc.stdout, proc.stdout
    # ... but a broken payload that names a temp location still denies (S04).
    assert_denied(run_hook(raw_stdin='{"tool_input": {"file_path": "/tmp/x"'), must_mention=("FAIL-CLOSED",))


def test_invalid_payload_shape_fails_closed():
    proc = run_hook(
        {"tool_name": "Write", "tool_input": "not-a-dict", "session_id": "x"}
    )
    # GO-5 E2: no temp hint in the payload -> advisory.
    assert proc.returncode == 0 and "TMP-BLOCK advisory: hook error" in proc.stdout, proc.stdout


def test_missing_tool_name_fails_closed():
    """Codex P2 round 6: a payload without tool_name is a validation error —
    defaulting to 'unguarded tool' recreates the S04 allow path."""
    proc = run_hook(
        {"tool_input": {"file_path": "/tmp/x.md", "content": "x"}, "session_id": "x"}
    )
    assert_denied(proc, must_mention=("FAIL-CLOSED",))  # a temp path in the payload: S04 stays a deny


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
    # GO-5 E2: no temp hint in the payload -> advisory.
    assert proc.returncode == 0 and "TMP-BLOCK advisory: hook error" in proc.stdout, proc.stdout


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
    assert_advised(proc)  # GO-5 E2: unknown, no temp hint


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


def test_unbounded_loop_and_unset_redirect_are_advised(durable_path):
    # GO-5 E2: unknown values with no temp hint are an advisory, not a block.
    for command in (
        'for f in $LIST; do printf x > "$f"; done',
        'printf x > "$UNSET"',
    ):
        assert_advised(run_hook(bash_payload(command), cwd=str(durable_path)))


def test_statically_empty_loop_value_set_allows_silently(durable_path):
    for command in (
        'for f in; do printf x > "$f"; done',
        'for f in $(false); do printf x > "$f"; done',
        'files=(); for f in "${files[@]}"; do printf x > "$f"; done',
    ):
        assert_allowed(run_hook(bash_payload(command), cwd=str(durable_path)))


