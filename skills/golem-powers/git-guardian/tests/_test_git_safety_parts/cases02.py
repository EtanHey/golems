from .common import *  # noqa: F403

def test_w16_unexpanded_var_with_literal_tail_is_allowed(tmp_path):
    # RED #1 (backlog #17): `$SP` is unexpanded in the command text. An unknown variable
    # is UNKNOWN, never zero-component — and a literal tail component guarantees the
    # target sits at least one level below whatever the variable holds, so it can be
    # neither "/" nor "$HOME" nor a bare repo root.
    for command in (
        "rm -rf $SP/mergetest",
        "rm -rf ${SP}/mergetest",
        'rm -rf "$SP/mergetest"',
        "rm -rf $SP/nested/deeper",
    ):
        assert git_safety.dangerous_shell_reason(
            command, cwd=str(tmp_path), env={}
        ) is None, command


def test_w16_bare_unresolvable_var_still_blocks(tmp_path):
    # No literal tail → the target could be "/" or "$HOME" itself. Stays blocked.
    for command in ('rm -rf "$SP"', "rm -rf $SP", "rm -rf $SP/"):
        assert git_safety.dangerous_shell_reason(
            command, cwd=str(tmp_path), env={}
        ) is not None, command


def test_w16_unresolvable_var_with_glob_or_substitution_tail_still_blocks(tmp_path):
    # The tail must be literal. A glob or a command substitution keeps the target
    # unknowable in both directions, so the conservative verdict holds.
    for command in (
        "rm -rf $SP/*",
        "rm -rf $SP/build*",
        "rm -rf $(cat target)/mergetest",
        "rm -rf `cat target`/mergetest",
    ):
        assert git_safety.dangerous_shell_reason(
            command, cwd=str(tmp_path), env={}
        ) is not None, command


def test_w16_outer_repo_boundaries_still_hold(tmp_path):
    # The nested-root relaxation must not move the OUTER repo's boundary: its root and
    # its top-level directories stay protected.
    outer, _worktree, _scratch = _nested_scratch_repo(tmp_path)
    (outer / "skills").mkdir()
    for command in (
        f'rm -rf "{outer}"',
        f'rm -rf "{outer}/skills"',
        "rm -rf .",
        "rm -rf ./",
        "rm -rf *",
    ):
        assert git_safety.dangerous_shell_reason(
            command, cwd=str(outer), env={}
        ) is not None, command


def test_w16_real_dangers_still_block(tmp_path):
    outer, _worktree, _scratch = _nested_scratch_repo(tmp_path)
    # The home-directory check compares against the PROCESS home (os.path.expanduser),
    # so the danger specimen has to name that same directory.
    home = os.path.expanduser("~")
    cases = (
        ("rm -rf /", {}),
        ("rm -rf ~", {"HOME": home}),
        ("rm -rf $HOME", {"HOME": home}),
        ("sudo rm -rf /Users", {}),
        ("rm -rf ../../..", {}),
        ("xargs rm -rf /", {}),
    )
    for command, env in cases:
        assert git_safety.dangerous_shell_reason(
            command, cwd=str(outer), env=env
        ) is not None, command


def test_w16_rm_inside_string_literals_is_not_an_argv_rm(tmp_path):
    # RED #4 — already green before W16; kept as a regression guard so a future
    # tokenizer change cannot reintroduce prose matching.
    for command in (
        'echo "run rm -rf later"',
        'git commit -m "remove rm -rf from script"',
        "grep -n 'rm -rf' file",
        "grep -rn 'rm -rf /' scripts",
    ):
        assert git_safety.dangerous_shell_reason(
            command, cwd=str(tmp_path), env={}
        ) is None, command


def test_w16_worktree_root_itself_stays_protected(tmp_path):
    # Caught by the live-hook probe, not by the unit pass: measuring breadth against the
    # outermost root made `rm -rf .` at a WORKTREE root read as 2 components and slip
    # through. A worktree root is a whole checkout — guarded by identity (gitfile .git),
    # not by depth.
    outer, worktree, _scratch = _nested_scratch_repo(tmp_path)
    for command in ("rm -rf .", "rm -rf ./", f'rm -rf "{worktree}"'):
        assert git_safety.dangerous_shell_reason(
            command, cwd=str(worktree), env={}
        ) is not None, command


def test_w16_submodule_root_stays_protected(tmp_path):
    # Same identity rule: a submodule's .git is a gitfile, so its root is a checkout.
    outer, _worktree, _scratch = _nested_scratch_repo(tmp_path)
    submodule = outer / "vendor" / "somelib"
    submodule.mkdir(parents=True)
    (submodule / ".git").write_text("gitdir: ../../.git/modules/somelib\n")
    assert git_safety.dangerous_shell_reason(
        f'rm -rf "{submodule}"', cwd=str(outer), env={}
    ) is not None


def test_w16_nested_independent_clone_root_is_exempt(tmp_path):
    # The throwaway-fixture case: .git is a real directory (own object store), so it is
    # not a checkout of the outer repo and does not plant a boundary.
    outer, _worktree, scratch = _nested_scratch_repo(tmp_path)
    assert git_safety.dangerous_shell_reason(
        "rm -rf .", cwd=str(scratch), env={}
    ) is None


def test_w16_dot_tail_does_not_qualify_as_a_literal_tail(tmp_path):
    # Self-review finding on this PR's own diff: `$X/.` resolves straight back to `$X`,
    # so a "." tail defeats the one-level-below guarantee the allowance rests on.
    for command in ("rm -rf $X/.", "rm -rf $X/./", "rm -rf $X/.//."):
        assert git_safety.dangerous_shell_reason(
            command, cwd=str(tmp_path), env={}
        ) is not None, command
    # …while a real component after a "." still qualifies (it IS one level below).
    assert git_safety.dangerous_shell_reason(
        "rm -rf $X/./mergetest", cwd=str(tmp_path), env={}
    ) is None


def test_w16_dotfiles_repo_at_home_does_not_become_the_boundary(tmp_path, monkeypatch):
    # Self-review finding: `git init` in $HOME (a dotfiles checkout — common) would make
    # $HOME the outermost root for everything under it, so `rm -rf ~/Gits/<repo>` would
    # measure as 2 components and ALLOW a whole-repo delete. The walk must not accept a
    # repo at or above $HOME.
    home = tmp_path / "home"
    (home / ".git").mkdir(parents=True)
    repo = home / "Gits" / "golems"
    (repo / ".git").mkdir(parents=True)
    monkeypatch.setenv("HOME", str(home))
    assert git_safety._outermost_repo_root(str(repo)) == str(repo)
    for command in (f'rm -rf "{repo}"', f'rm -rf "{repo}/skills"'):
        assert git_safety.dangerous_shell_reason(
            command, cwd=str(home), env={"HOME": str(home)}
        ) is not None, command
    # A repo OUTSIDE home is unaffected — the walk still finds its outermost root.
    outside = tmp_path / "opt" / "project"
    (outside / ".git").mkdir(parents=True)
    (outside / "src").mkdir()
    assert git_safety._outermost_repo_root(str(outside / "src")) == str(outside)


# ── W27: pkill/killall argument-order folding (2026-09-05 mass-kill incident) ────

def test_w27_pkill_options_after_the_pattern_are_blocked():
    # BSD getopt stops at the first non-option, so every word after the pattern is
    # folded INTO the pattern as an alternation branch. This is the exact shape that
    # SIGTERM'd 20 launchd jobs and every Claude seat on 2026-09-05.
    blocked = (
        "pkill -f 'inbox.jsonl' -P 1",
        "pkill -f 'inbox.jsonl' -P 1 2>/dev/null; kill 40955 2>/dev/null && echo done",
        "sudo pkill -f 'foo' -u 501",
        "killall -f 'bar' -m",
        "PKILL -f 'foo' -P 1",
        "/usr/bin/pkill -f 'foo' -P 1",
        "bash -c \"pkill -f 'foo' -P 1\"",
    )
    for command in blocked:
        reason = git_safety.dangerous_shell_reason(command)
        assert reason and "pkill" in reason.lower(), command
        assert "pgrep" in reason, command


def test_w27_degenerate_kill_patterns_are_blocked():
    # The folded result itself, and the single-character / all-digit patterns that
    # match ~92 processes on this machine.
    blocked = (
        "pkill -f '1'",
        "pkill -f 'abc'",
        "pkill -f 'inbox.jsonl|-P|1'",
        "pkill -f 'inbox.jsonl|1'",
        "pkill -f 501",
        "killall -m -f '1'",
        "killall -f 'bar|-m'",
        # Two operands is never two patterns — getopt folds them into one alternation.
        "pkill -f inbox.jsonl extra-operand",
    )
    for command in blocked:
        reason = git_safety.dangerous_shell_reason(command)
        assert reason and "pkill" in reason.lower(), command


def test_w27_correct_kill_forms_stay_allowed():
    # A false block here costs more than a miss (W16 repaired over-broad rm blocking
    # in this same file). Legitimate targeted kills must keep working.
    allowed = (
        "pkill -f -P 1 'inbox.jsonl'",
        "pgrep -f 'inbox.jsonl' -P 1",
        "pgrep -f '1'",
        "kill 40955",
        "kill -9 40955",
        "killall Dock",
        "pkill -HUP -f '/opt/svc/daemon.py'",
        "pkill -- -weird-pattern",
        "pkill -u 501 -f 'inbox.jsonl'",
        "pkill -f 'node --inspect'",
        "pkill -f 'foo|bar'",
        "pkill -f 'inbox.jsonl'",
        "pkill -f 'node'",
        "killall -f 'barproc'",
        'echo "never run pkill -f \'x\' -P 1"',
    )
    for command in allowed:
        assert git_safety.dangerous_shell_reason(command) is None, command


def test_pr4_repo_clone_inside_the_harness_scratchpad_is_disposable(tmp_path, monkeypatch):
    pad = _harness_scratchpad(tmp_path, monkeypatch)
    clone = pad / "rehearsal" / "golems"
    (clone / ".git").mkdir(parents=True)
    for command in (f'rm -rf "{clone}"', f'rm -rf "{clone}/.worktrees/hooks-live"'):
        assert git_safety.dangerous_shell_reason(command, cwd=str(tmp_path), env={}) is None, command


def test_pr4_repo_roots_outside_the_exact_scratchpad_shape_stay_protected(tmp_path, monkeypatch):
    pad = _harness_scratchpad(tmp_path, monkeypatch)
    near_misses = (
        pad.parent / "scratchpad-evil" / "golems",   # component must be exactly `scratchpad`
        pad.parent / "notes" / "golems",             # no scratchpad component
        tmp_path / "Gits" / "golems",                # an ordinary checkout
    )
    for repo in near_misses:
        (repo / ".git").mkdir(parents=True)
        assert git_safety.dangerous_shell_reason(
            f'rm -rf "{repo}"', cwd=str(tmp_path), env={}
        ) is not None, repo


def test_pr4_data_command_prose_is_masked_for_the_sql_and_credential_scans():
    for command in (
        "gh pr comment 12 --body \"no DROP TABLE anywhere\"",
        "printf '### post: we never DROP TABLE users here\\n' >> collab.md",
        "git commit -m 'docs: explain why DROP TABLE is blocked'",
        "echo 'DROP TABLE is prose' || true",   # `||` is not a pipe
        # A `|` inside quotes (a markdown table row) is not a pipe (round 3, rule 1).
        "printf '| col | DROP TABLE |\\n' >> table.md",
        # Near-miss words are not executors (round 3, rule 2).
        "gh pr comment 1 --body \"over ssh, in a shell, via ~/.bash_profile: no DROP TABLE\"",
        "true || echo 'DROP TABLE is prose'",
        "echo 'never cat > credentials.json by hand' >> notes.md",
        "python3 - <<'PY'\nprint('DROP TABLE users; rm -rf /tmp/extract/')\nPY",
    ):
        text = git_safety.shell_text_without_heredoc_bodies(command)
        assert "DROP TABLE" not in text and "credentials.json" not in text, (command, text)


def test_pr4_executed_sql_and_substitutions_are_still_visible():
    for command, needle in (
        ("psql -c 'DROP TABLE users'", "DROP TABLE"),
        ("sqlite3 db.sqlite 'drop table x'", "drop table"),
        # r7 round-1 blocker: a data command piped onward feeds an executor.
        ("echo 'DROP TABLE users;' | psql", "DROP TABLE"),
        ("printf 'drop table x;' | sqlite3 db", "drop table"),
        ("echo 'DROP TABLE t;' | tee /x/log | psql", "DROP TABLE"),
        ("echo 'DROP TABLE t;' |& psql", "DROP TABLE"),
        # Round 3, rule 1: any unquoted single `|` disables masking, so a compound
        # piped into an executor (listed or not) keeps its text.
        ("( echo 'DROP TABLE t;' ) | duckdb db", "DROP TABLE"),
        ("{ echo 'DROP TABLE t;'; } | duckdb db", "DROP TABLE"),
        ("for x in 1; do echo 'DROP TABLE t;'; done | duckdb db", "DROP TABLE"),
        # Round 3, rule 2: an executor named in the same command disables masking.
        ("echo 'DROP TABLE t;' > q.sql; psql -f q.sql", "DROP TABLE"),
        ("printf 'DROP TABLE t;' > q.sql && sqlite3 db < q.sql", "DROP TABLE"),
        ("echo 'DROP TABLE t;' > q.sh; bash q.sh", "DROP TABLE"),
        ("echo 'DROP TABLE t;' > q.sh; . q.sh", "DROP TABLE"),
        ("echo 'DROP TABLE t;' > q.sql; /usr/bin/mysql < q.sql", "DROP TABLE"),
        ("bash <<'EOF'\npsql -c 'DROP TABLE users'\nEOF", "DROP TABLE"),
        ("echo \"$(psql -c 'DROP TABLE users')\"", "DROP TABLE"),
        ("echo `rm -rf ~`", "rm -rf ~"),
        ("echo \"done: $(rm -rf ~)\"", "rm -rf ~"),   # $() inside "…" of a data command runs
        ("python3 - <<'PY' | sh\nprint('rm -rf ~')\nPY", "rm -rf ~"),
        ("python3 - <<PY\n$(psql -c 'DROP TABLE users')\nPY", "DROP TABLE"),
        ("git -c alias.x='!psql -c \"DROP TABLE t\"' x", "DROP TABLE"),
        # git config can name a program git then RUNS (core.editor): never data.
        ("git -c core.editor='psql -c \"DROP TABLE t\"' commit", "DROP TABLE"),
        ("git -ccore.editor='psql -c \"DROP TABLE t\"' commit -m x", "DROP TABLE"),
        ("git --config-env=core.editor=E commit -m 'DROP TABLE t'", "DROP TABLE"),
    ):
        assert needle in git_safety.shell_text_without_heredoc_bodies(command), command


def test_pr4_fleet_fixtures_quoting_rm_are_allowed(tmp_path):
    # w5 (01:03Z): a bats MUTATION edit whose replacement text holds `rm -rf …/*`.
    # r5 (01:07Z): a `gh pr review` whose --body prose names a link removal.
    for command in (
        "sed -i '' 's|keep|rm -rf \"$TEST_ROOT\"/*|' scripts/tests/x.bats",
        "gh pr review 12 --comment --body \"the fix removes the link: rm -rf ~/.claude/hooks/tmp-block\"",
    ):
        assert git_safety.dangerous_shell_reason(command, cwd=str(tmp_path), env={}) is None, command


def test_pr4_ansi_c_quotes_disable_masking_rather_than_desync():
    # `$'…\'…'` has quote rules the data-arg scanner does not model; a desynced
    # scanner could swallow executed text, so the whole command stays visible.
    # Without the bail-out, the scanner closes `$'a\'` early and then treats
    # ` ; rm … ; echo ` as one quoted echo argument, hiding an executed rm.
    # (An executor like psql would short-circuit via round 3's rule 2; rm is not one.)
    command = "echo $'a\\'' ; rm -rf ~ ; echo 'x'"
    assert "rm -rf ~" in git_safety.shell_text_without_heredoc_bodies(command)


def test_pr4_fixture4_loop_over_literal_names_resolves_each_value(tmp_path):
    # Hook false positive #4 (w6): a loop-local target built from a literal loop list.
    sbx = tmp_path / "sbx"
    sbx.mkdir()
    command = f"for s in a b; do T={sbx}/wh-$s; rm -rf $T; done"
    assert git_safety.dangerous_shell_reason(command, cwd=str(tmp_path), env={}) is None


def test_pr4_fixture4_every_loop_value_is_checked_and_non_literal_lists_stay_blocked(tmp_path):
    gits = tmp_path / "Gits"
    (gits / "golems" / ".git").mkdir(parents=True)
    for command in (
        f"for d in foo golems; do rm -rf {gits}/$d; done",   # the 2nd value is a repo root
        f"for d in a ..; do rm -rf {gits}/golems/x/$d; done",  # traversal is not a literal name
        "for d in $(ls); do rm -rf $d; done",
        f"for d in a b; do rm -rf {gits}/golems/$d; done; rm -rf ~",
    ):
        assert git_safety.dangerous_shell_reason(
            command, cwd=str(tmp_path), env={"HOME": os.path.expanduser("~")}
        ) is not None, command


def test_pr4_fixture5_worktree_of_a_nested_throwaway_clone_is_disposable(tmp_path):
    # Hook false positive #5 (r7): a sandbox clone inside the repo's gitignored
    # docs.local, removing that clone's own worktree via a same-command variable.
    outer = tmp_path / "outer"
    (outer / ".git").mkdir(parents=True)
    clone = outer / "docs.local" / "r7-sbx" / "golems"
    (clone / ".git" / "worktrees" / "hooks-live").mkdir(parents=True)
    worktree = clone / ".worktrees" / "hooks-live"
    worktree.mkdir(parents=True)
    (worktree / ".git").write_text(f"gitdir: {clone}/.git/worktrees/hooks-live\n")
    command = "S=docs.local/r7-sbx; rm -rf $S/golems/.worktrees/hooks-live"
    assert git_safety.dangerous_shell_reason(command, cwd=str(outer), env={}) is None


def test_pr4_fixture6_quoted_heredoc_data_for_tee_and_gh_is_not_executed(tmp_path):
    # Hook false positive #6 (r7): review prose naming a forced push, fed as data.
    body = "the forced push `git push --force origin main` stays blocked\n"
    for command in (
        f"tee r.md >/dev/null <<'EOF'\n{body}EOF",
        f"gh pr review 1 --approve --body-file - <<'EOF'\n{body}EOF",
        f"cat > r.md <<'EOF'\n{body}EOF",
    ):
        assert git_safety.dangerous_shell_reason(command, cwd=str(tmp_path), env={}) is None, command


def test_pr4_fixture6_executed_forms_stay_blocked(tmp_path):
    body = "`git push --force origin main`\n"
    for command in (
        f"cat > r.md <<EOF\n{body}EOF",            # unquoted: backticks really run
        f"tee r.md <<'EOF' | sh\n{body}EOF",        # piped into a shell
        "bash <<'EOF'\ngit push --force origin main\nEOF",
        "git push --force origin main",
    ):
        assert git_safety.dangerous_shell_reason(command, cwd=str(tmp_path), env={}) is not None, command


def test_pr4_fixture4_a_loop_body_that_changes_directory_is_not_unrolled(tmp_path):
    # Iterations share one cwd: the 2nd `cd ..` lands on the repo root, so the
    # 2nd rm removes a top-level directory. Checking each value from the start
    # cwd would miss that, so such loops keep the unresolved-target block.
    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)
    deeper = repo / "sub" / "deeper"
    deeper.mkdir(parents=True)
    command = "for d in keep sub; do cd ..; rm -rf $d; done"
    assert git_safety.dangerous_shell_reason(command, cwd=str(deeper), env={}) is not None


def test_go5_gap_forms_that_execute_text_are_blocked(tmp_path):
    for command in GAP_MUST_BLOCK:
        assert git_safety.dangerous_shell_reason(command, cwd=str(tmp_path), env=_home_env()), command


def test_go5_gap_false_positive_guards_stay_allowed(tmp_path):
    for command in GAP_MUST_ALLOW:
        assert git_safety.dangerous_shell_reason(command, cwd=str(tmp_path), env=_home_env()) is None, command


def test_go5_gap_recursion_is_bounded_and_fails_closed(tmp_path):
    def nest(inner, depth):
        # Unquoted `eval eval … cmd`: each level peels one eval, no quoting growth.
        return "eval " * depth + inner

    assert git_safety.dangerous_shell_reason(nest("rm -rf ~", 3), cwd=str(tmp_path), env=_home_env())
    assert git_safety.dangerous_shell_reason(nest("ls", 3), cwd=str(tmp_path), env=_home_env()) is None
    reason = git_safety.dangerous_shell_reason(nest("ls", 30), cwd=str(tmp_path), env=_home_env())
    assert reason and "too deep" in reason


def test_wrapper_depth_matrix_fails_closed_without_reaching_python_limit(tmp_path):
    dangerous = ("rm -rf /", "git push --force origin main")
    broad_kinds = ("sudo", "nice", "xargs", "find-exec", "mixed")
    boundary_kinds = (
        "env", "env-unset", "time-posix", "command", "exec", "nohup",
        "builtin", "env-split",
    )
    for kind in (*broad_kinds, *boundary_kinds):
        depths = (63, 64, 65, 500, 1000, 5000) if kind in broad_kinds else (64, 65)
        for depth in depths:
            for tail in (*dangerous, "echo safe"):
                reason = git_safety.dangerous_shell_reason(
                    _nested_wrapper(kind, depth, tail), cwd=str(tmp_path), env={}
                )
                if tail == "echo safe" and depth <= 64:
                    assert reason is None, (kind, depth, tail, reason)
                else:
                    assert reason, (kind, depth, tail)
                if depth > 64:
                    assert reason == "wrapper nesting exceeds 64; refusing to evaluate", (
                        kind, depth, tail, reason
                    )


def test_env_and_time_wrappers_increment_git_policy_depth():
    cap_reason = "wrapper nesting exceeds 64; refusing to evaluate"
    assert git_safety._dangerous_git_reason("env A=1 " * 65 + "echo safe") == cap_reason
    assert git_safety._dangerous_git_reason("time " * 65 + "echo safe") == cap_reason


def test_wrapper_depth_accumulates_across_shell_payload_scanners(tmp_path):
    cap_reason = "wrapper nesting exceeds 64; refusing to evaluate"
    command = "sudo " * 40 + "bash -c " + shlex.quote("sudo " * 30 + "echo safe")
    assert git_safety.is_dangerous_rm(command, cwd=str(tmp_path), env={}) == (
        True, cap_reason,
    )
    assert git_safety._dangerous_git_reason(command) == cap_reason


def test_shell_forwards_accumulated_depth_to_rm_scanner(monkeypatch):
    observed = []

    def inspect_rm(_command, *, cwd=None, env=None, _depth):
        observed.append(_depth)
        return False, None

    monkeypatch.setattr(git_safety, "_is_dangerous_rm_at_depth", inspect_rm)
    monkeypatch.setattr(git_safety, "_dangerous_git_reason_at_depth", lambda *_args, **_kwargs: None)
    assert git_safety.dangerous_shell_reason("echo safe", _depth=8) is None
    assert observed == [8]


def test_find_memo_keeps_depth_in_same_exec_index_key():
    cap_reason = "wrapper nesting exceeds 64; refusing to evaluate"
    words = ["find", ".", "-exec", "echo", "safe", "{}", "+"]
    find_cache = {}
    assert git_safety._commands._dangerous_non_rm_in_words(
        git_safety.__dict__, words, _depth=63, _find_cache=find_cache,
    ) is None
    assert git_safety._commands._dangerous_non_rm_in_words(
        git_safety.__dict__, words, _depth=64, _find_cache=find_cache,
    ) == cap_reason


def test_find_exec_boundaries_do_not_skip_later_sibling_commands(tmp_path):
    for harmless_args in ("safe", "-exec"):
        assert git_safety.dangerous_shell_reason(
            f"find . -exec echo {harmless_args} {{}} + -exec rm -rf / {{}} +",
            cwd=str(tmp_path), env={},
        ) == "rm targeting root filesystem"
        assert git_safety.dangerous_shell_reason(
            f"find . -exec echo {harmless_args} {{}} + -exec git push --force origin main {{}} +",
            cwd=str(tmp_path), env={},
        ) == "Dangerous command: git push --force"
    assert git_safety.dangerous_shell_reason(
        "find . -exec echo one {} + -exec echo two {} +",
        cwd=str(tmp_path), env={},
    ) is None


def test_shell_policy_recursion_error_fails_closed(monkeypatch):
    monkeypatch.setattr(
        git_safety._shell, "dangerous_shell_reason",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RecursionError()),
    )
    assert git_safety.dangerous_shell_reason("echo safe") == (
        "wrapper nesting exceeds 64; refusing to evaluate"
    )


def test_code_spans_in_a_quoted_heredoc_inside_dollar_paren_are_prose(tmp_path):
    for span in ("rm -rf ~", "eval 'rm -rf ~'", "echo 'rm -rf ~' | sh"):
        assert git_safety.dangerous_shell_reason(
            _body_recipe(span), cwd=str(tmp_path), env=_home_env()
        ) is None, span
    commit = "git commit -m \"$(cat <<'EOF'\nfix: guard `rm -rf ~` spans\nEOF\n)\""
    assert git_safety.dangerous_shell_reason(commit, cwd=str(tmp_path), env=_home_env()) is None


def test_backticks_that_really_run_still_block(tmp_path):
    for command in (
        _body_recipe("rm -rf ~", quoted=False),  # unquoted heredoc: backticks run
        "echo `rm -rf ~`",
        'echo "$(rm -rf ~)"',
    ):
        assert git_safety.dangerous_shell_reason(command, cwd=str(tmp_path), env=_home_env()), command


