from .common import *  # noqa: F403



@pytest.mark.parametrize(
    "command",
    (
        f"X={GITS}/golems/.worktrees/w; "
        + '{ X=/tmp/q; git worktree add "$X" HEAD; }',
        f"X={GITS}/golems/.worktrees/w; "
        + 'read X <<< /tmp/q; git worktree add "$X" HEAD',
        f"X={GITS}/golems/.worktrees/w; "
        + "eval 'X=/tmp/q'; git worktree add \"$X\" HEAD",
        f"X={GITS}/golems/.worktrees/w; "
        + 'cat <( X=/tmp/q; git worktree add "$X" HEAD )',
    ),
)
def test_unmodelled_assignment_invalidates_stale_outer_worktree_value(command):
    """golems#481: a later assignment form the resolver cannot model must
    invalidate an earlier in-convention value instead of authorizing it."""
    proc = run_hook(bash_payload(command))

    assert_denied(proc, must_mention=("WORKTREE-CONVENTION", "cannot resolve"))


@pytest.mark.parametrize(
    "command",
    (
        f"X={GITS}/golems/.worktrees/w; X=$(mktemp -d); "
        + 'git worktree add "$X" HEAD',
        f"X={GITS}/golems/.worktrees/w; X=`mktemp -d`; "
        + 'git worktree add "$X" HEAD',
        f"X={GITS}/golems/.worktrees/w\nX=$(mktemp -d)\n"
        + 'git worktree add "$X" HEAD',
        f"X={GITS}/golems/.worktrees/w; X=$(mktemp -d) && "
        + 'git worktree add "$X" HEAD',
    ),
)
def test_command_substitution_assignment_invalidates_stale_outer_value(command):
    """The command inside ``$()``/backticks is not the assignment's command."""
    proc = run_hook(bash_payload(command))

    assert_denied(proc, must_mention=("WORKTREE-CONVENTION", "cannot resolve"))


@pytest.mark.parametrize(
    "mutation",
    (
        "command read X <<< /tmp/q",
        "builtin read X <<< /tmp/q",
        "command eval X=/tmp/q",
        "builtin eval X=/tmp/q",
    ),
)
def test_wrapped_builtin_assignment_invalidates_stale_outer_value(mutation):
    command = (
        f"X={GITS}/golems/.worktrees/w; {mutation}; "
        + 'git worktree add "$X" HEAD'
    )
    proc = run_hook(bash_payload(command))

    assert_denied(proc, must_mention=("WORKTREE-CONVENTION", "cannot resolve"))


@pytest.mark.parametrize(
    "mutation",
    (
        "C=X=/tmp/q; eval $C",
        'C=X=/tmp/q; eval "$C"',
        "source <(echo X=/tmp/q)",
        ". <(echo X=/tmp/q)",
        "source ./env.sh",
    ),
)
def test_unreadable_eval_or_source_invalidates_all_tracked_values(mutation):
    command = (
        f"X={GITS}/golems/.worktrees/w; {mutation}; "
        + 'git worktree add "$X" HEAD'
    )
    proc = run_hook(bash_payload(command))

    assert_denied(proc, must_mention=("WORKTREE-CONVENTION", "cannot resolve"))


@pytest.mark.parametrize(
    "mutation",
    (
        "eval 'true; X=/tmp/q'",
        "eval 'Y=1; X=/tmp/q'",
        'eval "true;X=/tmp/q"',
        "eval 'read X' <<< /tmp/q",
    ),
)
def test_static_compound_eval_invalidates_all_tracked_values(mutation):
    """golems#481: eval bodies beyond literal assignments are opaque code."""
    command = (
        f"X={GITS}/golems/.worktrees/w; {mutation}; "
        + 'git worktree add "$X" HEAD'
    )
    proc = run_hook(bash_payload(command))

    assert_denied(proc, must_mention=("WORKTREE-CONVENTION", "cannot resolve"))


def test_literal_assignment_only_eval_keeps_unrelated_tracked_value():
    command = (
        f"X={GITS}/golems/.worktrees/w; eval Y=literal Z=other; "
        + 'git worktree add "$X" HEAD'
    )

    assert_allowed(run_hook(bash_payload(command)))


def test_select_assignment_invalidates_stale_outer_value():
    command = (
        f"X={GITS}/golems/.worktrees/w; "
        + "select X in /tmp/q; do break; done <<< 1; "
        + 'git worktree add "$X" HEAD'
    )
    proc = run_hook(bash_payload(command))

    assert_denied(proc, must_mention=("WORKTREE-CONVENTION", "cannot resolve"))


def test_select_of_unrelated_name_keeps_tracked_value():
    command = (
        f"X={GITS}/golems/.worktrees/w; "
        + "select Y in /tmp/q; do break; done <<< 1; "
        + 'git worktree add "$X" HEAD'
    )

    assert_allowed(run_hook(bash_payload(command)))


@pytest.mark.parametrize(
    "mutation",
    (
        "printf -v X %s /tmp/q",
        "printf -vX %s /tmp/q",
        'N=X; printf -v "$N" %s /tmp/q',
        'printf -v "X[0]" %s /tmp/q',
        'N=X; read "$N" <<< /tmp/q',
        'N=X; read -a "$N" <<< /tmp/q',
        "read -aX <<< /tmp/q",
        "mapfile -t X <<< /tmp/q",
        "mapfile -d x X <<< /tmp/qx",
        "mapfile -td x X <<< /tmp/qx",
        'N=X; mapfile "$N" <<< /tmp/q',
        "readarray -t X <<< /tmp/q",
        "readarray -d x X <<< /tmp/qx",
        "readarray -td x X <<< /tmp/qx",
        "for X in /tmp/q; do :; done",
        "declare -n R=X; R=/tmp/q",
        "N=X; declare -n R=$N; R=/tmp/q",
        "N=$(printf X); declare -n R=$N; R=/tmp/q",
        "X[0]=/tmp/q",
        "X=(/tmp/q)",
        "{ X[0]=/tmp/q; }",
        "X+=/../../../../tmp/q",
    ),
)
def test_assignment_by_name_invalidates_stale_outer_value(mutation):
    command = (
        f"X={GITS}/golems/.worktrees/w; {mutation}; "
        + 'git worktree add "$X" HEAD'
    )
    proc = run_hook(bash_payload(command))

    assert_denied(proc, must_mention=("WORKTREE-CONVENTION", "cannot resolve"))


def test_dynamic_builtin_target_does_not_fall_back_to_stale_environment():
    command = (
        f"X={GITS}/golems/.worktrees/w; N=$(printf X); "
        + 'printf -v "$N" %s /tmp/q; git worktree add "$X" HEAD'
    )
    proc = run_hook(bash_payload(command), env_extra={"N": "Y"})

    assert_denied(proc, must_mention=("WORKTREE-CONVENTION", "cannot resolve"))


@pytest.mark.parametrize(
    "name, mutation",
    (
        ("REPLY", "read <<< /tmp/q"),
        ("MAPFILE", "mapfile -t <<< /tmp/q"),
        ("MAPFILE", "readarray -t <<< /tmp/q"),
    ),
)
def test_default_builtin_assignment_target_invalidates_stale_value(name, mutation):
    command = (
        f"{name}={GITS}/golems/.worktrees/w; {mutation}; "
        + f'git worktree add "${name}" HEAD'
    )
    proc = run_hook(bash_payload(command))

    assert_denied(proc, must_mention=("WORKTREE-CONVENTION", "cannot resolve"))


@pytest.mark.parametrize(
    "command, expected",
    (
        (
            f'X={GITS}/golems/.worktrees/w; git worktree add "$X" HEAD',
            "allow",
        ),
        (
            f"X={GITS}/golems/.worktrees/w; "
            + '( X=/tmp/q; git worktree add "$X" HEAD )',
            "deny",
        ),
        (
            f"X={GITS}/golems/.worktrees/w; "
            + 'f() { local X=/tmp/q; git worktree add "$X" HEAD; }; f',
            "deny",
        ),
        (
            f"X={GITS}/golems/.worktrees/w; "
            + 'X=/tmp/q true; git worktree add "$X" HEAD',
            "allow",
        ),
        (
            f"X={GITS}/golems/.worktrees/w; "
            + 'cat <( X=/tmp/q; true ); git worktree add "$X" HEAD',
            "allow",
        ),
    ),
)
def test_stale_outer_assignment_controls(command, expected):
    proc = run_hook(bash_payload(command))

    if expected == "allow":
        assert_allowed(proc)
    else:
        assert_denied(proc)


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
