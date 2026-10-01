from .common import *  # noqa: F403

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
    assert_advised(unbounded)  # GO-5 E2


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


@pytest.mark.parametrize(
    "outer",
    (
        "",
        f"X={GITS}/golems/.worktrees/w; ",
    ),
)
def test_worktree_hatch_does_not_drop_inner_substitution_temp_hit(tmp_path, outer):
    """golems#466: an exposed primary parse may resolve an outer value, but
    it must not discard the child parse's temp-class target before the
    worktree-migration hatch is considered."""
    ledger = tmp_path / "ledger.jsonl"
    proc = run_hook(
        bash_payload(
            outer
            + 'echo $(X=/tmp/q; WEAVE_ALLOW_WT_MIGRATION=1 '
            + 'git worktree add "$X" HEAD)'
        ),
        env_extra={"TMP_BLOCK_LEDGER": str(ledger)},
    )
    assert_denied(proc, must_mention=("TMP-BLOCK", "/tmp/q"))
    assert not ledger.exists(), "a denied temp target must not log a WT bypass"


def test_worktree_hatch_keeps_in_convention_target_allowed(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    proc = run_hook(
        bash_payload(
            "WEAVE_ALLOW_WT_MIGRATION=1 git worktree add "
            f"{GITS}/golems/.worktrees/w HEAD"
        ),
        env_extra={"TMP_BLOCK_LEDGER": str(ledger)},
    )
    assert_allowed(proc)
    assert not ledger.exists(), "an in-convention target does not consume the hatch"


@pytest.mark.parametrize(
    "command",
    (
        '( X=/tmp/q; WEAVE_ALLOW_WT_MIGRATION=1 '
        + 'git worktree add "$X" HEAD )',
        '{ X=/tmp/q; WEAVE_ALLOW_WT_MIGRATION=1 '
        + 'git worktree add "$X" HEAD; }',
        'f() { local X=/tmp/q; WEAVE_ALLOW_WT_MIGRATION=1 '
        + 'git worktree add "$X" HEAD; }; f',
        'read X <<< /tmp/q; WEAVE_ALLOW_WT_MIGRATION=1 '
        + 'git worktree add "$X" HEAD',
        "eval 'X=/tmp/q'; WEAVE_ALLOW_WT_MIGRATION=1 "
        + 'git worktree add "$X" HEAD',
        'cat <( X=/tmp/q; WEAVE_ALLOW_WT_MIGRATION=1 '
        + 'git worktree add "$X" HEAD )',
        'WEAVE_ALLOW_WT_MIGRATION=1 git worktree add "$UNSET_VAR" HEAD',
    ),
)
def test_worktree_hatch_never_unlocks_unresolved_target(tmp_path, command):
    """golems#480: a migration hatch can cover a resolved location drift,
    but cannot turn missing static target evidence into authorization."""
    ledger = tmp_path / "ledger.jsonl"
    proc = run_hook(
        bash_payload(command),
        env_extra={"TMP_BLOCK_LEDGER": str(ledger)},
    )

    assert_denied(proc, must_mention=("WORKTREE-CONVENTION", "cannot resolve"))
    assert not ledger.exists(), "an unresolved target must not consume the hatch"


def test_worktree_hatch_never_unlocks_resolved_temp_target_from_function_global(
    durable_path,
):
    """golems#480 R1: a target resolved by Rule 2 into the temp class stays
    denied even when Rule 1 misses the function-body global assignment."""
    marker = durable_path / "zsh-target.txt"
    script = durable_path / "ground-truth.zsh"
    script.write_text(
        """#!/bin/zsh -f
MARKER=$1
git() { printf '%s\\n' "$3" > "$MARKER"; }
X=/Users/example/Gits/golems/.worktrees/w
f() { declare -g X=/tmp/q; }
f
WEAVE_ALLOW_WT_MIGRATION=1 git worktree add "$X" HEAD
"""
    )
    subprocess.run(
        ["zsh", "-f", str(script), str(marker)],
        check=True,
        capture_output=True,
        text=True,
    )
    assert marker.read_text() == "/tmp/q\n"

    ledger = durable_path / "ledger.jsonl"
    command = (
        f"X={GITS}/golems/.worktrees/w; "
        "f() { declare -g X=/tmp/q; }; f; "
        'WEAVE_ALLOW_WT_MIGRATION=1 git worktree add "$X" HEAD'
    )
    proc = run_hook(
        bash_payload(command),
        env_extra={"TMP_BLOCK_LEDGER": str(ledger)},
    )

    assert_denied(proc, must_mention=("WORKTREE-CONVENTION", "/tmp/q"))
    assert not ledger.exists(), "a denied temp target must not log a WT bypass"


@pytest.mark.parametrize(
    "command",
    (
        f"WEAVE_ALLOW_WT_MIGRATION=1 git worktree add {GITS}/golems/.worktrees/w HEAD",
        f"WT={GITS}/golems/.worktrees/w; WEAVE_ALLOW_WT_MIGRATION=1 "
        + 'git worktree add "$WT" HEAD',
    ),
)
def test_worktree_hatch_keeps_resolved_in_convention_targets_allowed(tmp_path, command):
    ledger = tmp_path / "ledger.jsonl"
    proc = run_hook(
        bash_payload(command),
        env_extra={"TMP_BLOCK_LEDGER": str(ledger)},
    )

    assert_allowed(proc)
    assert not ledger.exists(), "an in-convention target does not consume the hatch"
