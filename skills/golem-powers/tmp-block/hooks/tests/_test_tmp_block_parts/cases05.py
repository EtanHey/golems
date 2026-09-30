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
    """No head, no proof. GO-5 E2: an unknown value is an advisory, unless the
    command itself points at a temp location (mktemp, TMPDIR*, /tmp, /var/folders)."""
    for command in (
        'P=$UNSET_TARGET/logs; printf x > "$P/f.log"',
        'P=$(printf %s /some/where); printf x > "$P/f.log"',
    ):
        assert_advised(run_hook(bash_payload(command), cwd=str(durable_path)))
    for command in (
        'P=$(mktemp); printf x > "$P"',
        'P=$(mktemp -d); printf x > "$P/f.log"',
        'P=${TMPDIR_ALT:-x}/y; printf x > "$P"',
    ):
        assert_refused(run_hook(bash_payload(command), cwd=str(durable_path)))


def test_conditional_assignment_cannot_lend_its_literal_head(durable_path):
    """An assignment that may not have run leaves the variable's head unknown.

    `false && P=...` never executes, so `$P` may still hold anything --
    including a temp path -- and the head from the skipped assignment must
    not be borrowed to prove `outside`.
    """
    command = 'false && P=~/Documents/x_$$.txt; printf x > "$P"'

    assert_advised(run_hook(bash_payload(command), cwd=str(durable_path)))  # GO-5 E2


def test_go5_live_fixture_conditional_static_scratchpad_target_is_advised(durable_path):
    # Live FP (w6, GO-5): `cd X && P=<static scratchpad path>; cat > $P` was refused,
    # because the && makes the assignment conditional. An unset P is an ambiguous
    # redirect, never a temp write, and nothing in the command points at a temp dir.
    scratch = (
        "/private/tmp/claude-501/-Users-example-Gits-golems/"
        "00000000-0000-0000-0000-000000000000/scratchpad/pr-body.md"
    )
    for target in (f"{durable_path}/docs.local/pr-body.md", scratch):
        command = f"cd {durable_path} && P={target}; cat > $P <<'EOF'\nbody\nEOF"
        assert_advised(run_hook(bash_payload(command), cwd=str(durable_path)))
    # A scratchpad path does not launder a real temp hint elsewhere in the command.
    command = f"cd {durable_path} && P=$(mktemp); cat {scratch} > $P"
    assert_refused(run_hook(bash_payload(command), cwd=str(durable_path)))


def test_observed_scratchpad_redirect_is_allowed(durable_path):
    """The verbatim 2026-08-17 brainlayerClaude denial must now allow."""
    proc = run_hook(
        bash_payload(f'echo noise > {SCRATCHPAD_DIR}/monitor-selftest.txt'),
        cwd=str(durable_path),
    )
    assert_allowed(proc)


