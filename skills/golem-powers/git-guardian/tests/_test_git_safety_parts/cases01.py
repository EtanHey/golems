from .common import *  # noqa: F403

def test_shared_parser_identity_reuses_same_tree_bare_module(tmp_path, monkeypatch):
    copied = _copied_guardian(tmp_path, "same-tree")
    parser = _load_at("shell_parse", copied.parent / "_shared" / "shell_parse.py")
    monkeypatch.setitem(sys.modules, "shell_parse", parser)
    facade = _load_at("git_safety_same_tree", copied / "git_safety.py")
    assert facade._pkg.shell_parse is parser
    for name in (
        "_backtick_bodies", "dollar_paren_bodies",
        "shell_text_without_heredoc_bodies", "without_dollar_paren_bodies",
    ):
        assert getattr(facade, name) is getattr(parser, name)


def test_shared_parser_rejects_foreign_copy_and_registers_when_absent(tmp_path, monkeypatch):
    foreign = _copied_guardian(tmp_path, "foreign")
    copied = _copied_guardian(tmp_path, "candidate")
    parser = _load_at("shell_parse", foreign.parent / "_shared" / "shell_parse.py")
    monkeypatch.setitem(sys.modules, "shell_parse", parser)
    facade = _load_at("git_safety_foreign_copy", copied / "git_safety.py")
    assert facade._pkg.shell_parse is not parser
    assert Path(facade._pkg.shell_parse.__file__).resolve() == (
        copied.parent / "_shared" / "shell_parse.py"
    ).resolve()
    assert sys.modules["shell_parse"] is parser

    monkeypatch.delitem(sys.modules, "shell_parse")
    another = _copied_guardian(tmp_path, "bare-absent")
    absent = _load_at("git_safety_bare_absent", another / "git_safety.py")
    assert sys.modules["shell_parse"] is absent._pkg.shell_parse


def test_two_facades_load_their_own_git_implementation(tmp_path):
    copied = tmp_path / "other" / "git-guardian"
    shutil.copytree(MODULE.parent, copied, ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copytree(MODULE.parent.parent / "_shared", copied.parent / "_shared")
    implementation = copied / "git_safety_impl" / "git.py"
    source = implementation.read_text()
    assert "return len(meaningful) == 0" in source
    implementation.write_text(source.replace("return len(meaningful) == 0", "return 'other copy'"))
    with (copied / "git_safety_impl" / "shell.py").open("a") as handle:
        handle.write("\ndef dangerous_shell_reason(command, *, cwd=None, env=None, _depth=0, api=None):\n"
                     "    return 'other shell'\n")
    other_spec = importlib.util.spec_from_file_location("git_safety_other", copied / "git_safety.py")
    other = importlib.util.module_from_spec(other_spec)
    other_spec.loader.exec_module(other)
    assert other.pr_body_is_empty("hello") == "other copy"
    assert git_safety.pr_body_is_empty("hello") is False
    assert other.dangerous_shell_reason("echo hi") == "other shell"
    assert git_safety.dangerous_shell_reason("echo hi") is None
    assert other._git.__file__ == str(implementation)
    assert git_safety._git.__file__ == str(MODULE.parent / "git_safety_impl" / "git.py")
    assert other._pkg.shell_parse.__file__ == str(copied.parent / "_shared" / "shell_parse.py")


def test_copied_git_loader_restores_bytecode_setting_without_impl_cache(tmp_path):
    copied = tmp_path / "installed" / "git-guardian"
    shutil.copytree(MODULE.parent, copied, ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copytree(MODULE.parent.parent / "_shared", copied.parent / "_shared")
    env = os.environ.copy()
    env.pop("PYTHONDONTWRITEBYTECODE", None)
    env.pop("PYTHONPYCACHEPREFIX", None)
    script = (
        "import importlib.util, sys; "
        "spec=importlib.util.spec_from_file_location('copied_guardian', sys.argv[1]); "
        "module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); "
        "assert sys.dont_write_bytecode is False"
    )
    result = subprocess.run(
        [sys.executable, "-c", script, str(copied / "git_safety.py")],
        cwd=tmp_path, env=env, capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert not (copied / "git_safety_impl" / "__pycache__").exists()


def test_git_facade_forwards_replaceable_helpers(monkeypatch):
    monkeypatch.setattr(git_safety, "split_git", lambda _command: ("push", ["--no-verify"]))
    assert git_safety.is_unauthorized_no_verify("anything") is True
    monkeypatch.setattr(git_safety, "restore_targets", lambda _command: ["unowned"])
    assert git_safety.is_destructive_restore("anything", owned_paths=[])["destructive"] is True


def test_git_facade_forwards_replaceable_module_globals(monkeypatch):
    with monkeypatch.context() as patch:
        patch.setattr(git_safety, "_HTML_COMMENT", git_safety.re.compile("hello"))
        assert git_safety.pr_body_is_empty("hello") is True
    with monkeypatch.context() as patch:
        patch.setattr(git_safety, "_SKELETON_LINES", {"hello"})
        assert git_safety.pr_body_is_empty("hello") is True
    with monkeypatch.context() as patch:
        patch.setattr(git_safety, "_GLOBAL_OPTS_WITH_SEPARATE_VALUE", set())
        assert git_safety.split_git("git -C /repo push") == ("/repo", ["push"])
    with monkeypatch.context() as patch:
        patch.setattr(git_safety, "_MESSAGE_FLAGS_WITH_VALUE", set())
        assert git_safety.is_unauthorized_no_verify("git commit -m --no-verify") is True
    with monkeypatch.context() as patch:
        patch.setattr(git_safety, "_norm", lambda _path: "same")
        assert git_safety.is_destructive_restore("git restore a", owned_paths=["b"])["destructive"] is False


def test_path_facade_forwards_replaceable_expansion(monkeypatch):
    monkeypatch.setattr(git_safety, "_expand_known_vars", lambda _target, _vars: ("/", True))
    assert git_safety._rm_target_reason("safe", "/", {}) == "rm targeting root filesystem"


def test_rm_facade_forwards_replaceable_path_policy(monkeypatch):
    monkeypatch.setattr(git_safety, "_rm_target_reason", lambda *_: "patched path policy")
    assert git_safety.is_dangerous_rm("rm -rf /a/b/c", cwd="/", env={}) == (
        True, "patched path policy"
    )


def test_rm_wrapper_depth_cap_and_recursion_fallback(monkeypatch):
    for depth in (63, 64):
        blocked, reason = git_safety.is_dangerous_rm(
            "sudo " * depth + "rm -rf /", cwd="/", env={}
        )
        assert blocked and reason == "rm targeting root filesystem"
    for depth in (65, 500, 1000, 5000):
        blocked, reason = git_safety.is_dangerous_rm(
            "sudo " * depth + "echo safe", cwd="/", env={}
        )
        assert blocked and reason == "wrapper nesting exceeds 64; refusing to evaluate"

    monkeypatch.setattr(
        git_safety._rm, "is_dangerous_rm", lambda *_args, **_kwargs: (_ for _ in ()).throw(RecursionError())
    )
    assert git_safety.is_dangerous_rm("echo safe", cwd="/", env={}) == (
        True, "wrapper nesting exceeds 64; refusing to evaluate"
    )


def test_recursive_rm_facade_signatures_hide_internal_api():
    assert list(inspect.signature(git_safety._rm_reason_in_words).parameters) == [
        "words", "position", "cwd", "variables", "dynamic_input", "argument_variables"
    ]
    assert list(inspect.signature(git_safety.is_dangerous_rm).parameters) == [
        "command", "cwd", "env"
    ]


def test_command_facade_forwards_replaceable_git_parser(monkeypatch):
    monkeypatch.setattr(git_safety, "split_git", lambda _command: ("push", ["--force"]))
    assert git_safety._dangerous_git_reason("git status") == "Dangerous command: git push --force"


def test_git_wrapper_depth_cap_and_recursion_fallback(monkeypatch):
    for depth in (63, 64):
        assert git_safety._dangerous_git_reason(
            "nice " * depth + "git push --force origin main"
        ) == "Dangerous command: git push --force"
    for depth in (65, 500, 1000, 5000):
        assert git_safety._dangerous_git_reason(
            "nice " * depth + "echo safe"
        ) == "wrapper nesting exceeds 64; refusing to evaluate"

    monkeypatch.setattr(
        git_safety._commands, "_dangerous_git_reason",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RecursionError()),
    )
    assert git_safety._dangerous_git_reason("echo safe") == (
        "wrapper nesting exceeds 64; refusing to evaluate"
    )


def test_recursive_command_facade_signature_hides_internal_api():
    assert list(inspect.signature(git_safety._dangerous_non_rm_in_words).parameters) == [
        "words", "position"
    ]


# ── F8: resolved rm breadth + heredoc prose masking ─────────────────────────────

def test_f8_all_three_repo_cleanup_specimens_are_allowed(tmp_path):
    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)
    docs = repo / "docs.local" / "tasks" / "gems-adoption"
    docs.mkdir(parents=True)
    commands = (
        f'cd "{docs}" && rm -rf redcheck_r2 && mkdir -p redcheck_r2/hooks/tests',
        f'cd "{repo}" && D=docs.local/outer-review-pr703 && rm -rf "$D/redcheck"',
        f'R="{docs}/probes-pr702-outer-r2"; W="$R/lastprobe"; rm -rf "$W"',
    )

    for command in commands:
        assert git_safety.dangerous_shell_reason(
            command, cwd=str(repo), env=os.environ
        ) is None, command


def test_f8_all_three_report_heredoc_specimens_are_allowed(tmp_path):
    report = tmp_path / "REPORTS.md"
    commands = (
        f"cat >> '{report}' <<'EOF'\nrm -rf redcheck_r2 was blocked as too broad\nEOF",
        f"cat >> '{report}' <<'EOF'\nrm -rf $D/redcheck was blocked; git reset --hard is quoted prose\nEOF",
        f"cat >> '{report}' <<'EOF'\nrm -rf $W was blocked; git clean -f is quoted prose\nEOF",
    )

    for command in commands:
        assert git_safety.dangerous_shell_reason(command) is None, command


def test_rm_breadth_still_blocks_genuinely_broad_or_unresolved_targets(tmp_path):
    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)
    blocked = (
        "rm -rf /",
        "RM -rf /",
        "rm -rf /tmp",
        'rm -rf "$UNSET"',
        'cd /outside && rm -rf child',
        "rm -rf .",
        "rm -rf packages",
        "rm -rf ..",
        "rm -rf ../sibling",
        "rm -rf docs.local/../..",
        "sudo rm -rf /",
        "rm / -rf",
        "env rm -rf /",
        "time rm -rf /",
        'bash -c "rm -rf /"',
        'bash -lc "rm -rf /"',
        'sh -c "rm -rf /"',
        r"find . -exec rm -rf {} \;",
        "printf '/\\n' | xargs rm -rf",
        "printf '/\\n' | xargs sudo rm -rf",
        "printf '/\\n' | xargs env time rm -rf",
        "printf '/\\n' | xargs -i rm -rf /",
        "printf '/\\n' | xargs --replace rm -rf /",
        "printf '/\\n' | xargs -e rm -rf /",
        "printf '/\\n' | xargs --eof rm -rf /",
        "printf '/\\n' | xargs -l rm -rf /",
        "cat list | xargs rm -rf docs.local/a/b",
        "printf '/\\n' | xargs rm -rf docs.local/safe/sub",
        "printf '/\\n' | xargs -I{} rm -rf docs.local/a/b",
        'env -S "rm -rf /"',
        "env --split-string='rm -rf /'",
        'rm -rf "docs.local/safe/$UNSET/../../.."',
    )

    for command in blocked:
        reason = git_safety.dangerous_shell_reason(
            command, cwd=str(repo), env={}
        )
        assert reason and "rm" in reason.lower(), command


def test_repo_prefix_still_allows_a_dynamic_non_parent_suffix(tmp_path):
    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)

    assert git_safety.dangerous_shell_reason(
        'rm -rf "docs.local/safe/run-$(date +%s)"', cwd=str(repo), env={}
    ) is None


def test_command_local_assignment_is_not_visible_to_rm_arguments(tmp_path):
    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)

    reason = git_safety.dangerous_shell_reason(
        'D=docs.local/safe rm -rf "$D/x"',
        cwd=str(repo),
        env={"D": "/"},
    )
    assert reason and "rm" in reason.lower()

    assert git_safety.dangerous_shell_reason(
        'D=/ rm -rf "$D/x/y"',
        cwd=str(repo),
        env={"D": "docs.local/safe"},
    ) is None


def test_malformed_rm_with_long_recursive_force_flags_fails_closed(tmp_path):
    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)
    commands = (
        'rm --recursive --force "/',
        'rm / --recursive --force "',
    )

    for command in commands:
        reason = git_safety.dangerous_shell_reason(command, cwd=str(repo), env={})
        assert reason and "rm" in reason.lower(), command


def test_unquoted_heredoc_executable_substitution_is_still_scanned(tmp_path):
    command = f"cat > '{tmp_path}/report.md' <<EOF\n$(rm -rf /)\nEOF"

    reason = git_safety.dangerous_shell_reason(command)

    assert reason and "rm" in reason.lower()


def test_rm_prose_without_recursive_force_flags_is_not_a_command():
    commands = (
        'echo "rm breadth comparison"',
        "python3 docs.local/rm-breadth-compare.py; echo rm breadth",
        'echo "rm -r only, no -f broad"',
        'echo "rm -f only, no -r broad"',
        'echo "the rm -rf flag is dangerous"',
        "echo 'rm -rf / is quoted evidence'",
    )

    for command in commands:
        assert git_safety.dangerous_shell_reason(command) is None, command


def test_wrapper_arguments_that_only_quote_rm_prose_are_allowed():
    commands = (
        'env echo "rm -rf /"',
        'time echo "rm -rf /"',
        "bash -c 'echo \"rm -rf /\"'",
        r"find . -exec echo 'rm -rf /' \;",
        "printf 'rm -rf /\\n' | xargs echo",
    )

    for command in commands:
        assert git_safety.dangerous_shell_reason(command) is None, command


def test_shell_executed_heredoc_body_is_never_masked():
    commands = (
        "bash <<'EOF'\nrm -rf /\nEOF",
        "bash <<'EOF' > report.log\nrm -rf /\nEOF",
        "cat input > report.log; bash <<'EOF'\nrm -rf /\nEOF",
    )

    for command in commands:
        reason = git_safety.dangerous_shell_reason(command)
        assert reason and "rm" in reason.lower(), command


def test_plain_force_push_is_not_exempted_by_a_different_lease_push():
    commands = (
        "git push --force origin main && git push --force-with-lease origin dev",
        'echo "--force-with-lease"; git push --force origin main',
        "git push --force origin main # --force-with-lease is safer",
    )

    for command in commands:
        reason = git_safety.dangerous_shell_reason(command)
        assert reason and "git push" in reason.lower(), command

    assert git_safety.dangerous_shell_reason(
        "git push --force-with-lease origin main"
    ) is None


def test_destructive_git_flags_are_parsed_structurally():
    blocked = (
        "git   reset   --hard",
        "git -C /repo reset --hard",
        "git clean --force -d",
        "git clean -dfx",
        "git -C /repo clean -d -f",
        "GIT push --force origin main",
        'env -S "git reset --hard"',
        "railway down",
        "RAILWAY down",
        "git push --force && echo $'don\\'t'",
    )
    for command in blocked:
        reason = git_safety.dangerous_shell_reason(command)
        assert reason and (
            "git" in reason.lower() or "railway" in reason.lower()
        ), command

    allowed = (
        'echo "git reset --hard is quoted evidence"',
        'echo "git clean -f is quoted evidence"',
        'echo "before | git push --force is blocked"',
        'echo "a; git clean -f was quoted"',
        'git commit -m "fix: never run\ngit reset --hard here"',
        'echo "the guard blocks railway down"',
        'echo "unterminated git reset --hard',
        "git reset --soft HEAD~1",
        "git clean -n",
    )
    for command in allowed:
        assert git_safety.dangerous_shell_reason(command) is None, command


def test_unknown_directory_transitions_cannot_reuse_stale_cwd(tmp_path):
    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)
    commands = (
        "cd; rm -rf docs.local/scratch",
        "cd -; rm -rf docs.local/scratch",
        "pushd; rm -rf docs.local/scratch",
        "popd; rm -rf docs.local/scratch",
    )

    for command in commands:
        reason = git_safety.dangerous_shell_reason(command, cwd=str(repo), env={})
        assert reason and "rm" in reason.lower(), command


def test_rm_after_shell_control_keyword_is_scanned():
    commands = (
        "if true; then rm -rf /; fi",
        "while true; do rm -rf /; done",
        "! rm -rf /",
    )

    for command in commands:
        reason = git_safety.dangerous_shell_reason(command, cwd="/", env={})
        assert reason and "rm" in reason.lower(), command


def test_conditionally_skipped_cd_cannot_anchor_later_rm(tmp_path):
    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)
    command = f"false && cd {repo}; rm -rf x/y"

    reason = git_safety.dangerous_shell_reason(command, cwd="/", env={})

    assert reason and "rm" in reason.lower()


def test_nice_wrapped_destructive_commands_are_scanned():
    commands = (
        "nice rm -rf /",
        "nice -n 5 rm -rf /",
        "nice --adjustment=5 git push --force origin main",
    )

    for command in commands:
        reason = git_safety.dangerous_shell_reason(command, cwd="/", env={})
        assert reason, command


def test_backtick_command_substitutions_are_scanned():
    commands = (
        "echo `rm -rf /`",
        "cat <<EOF\n`rm -rf /`\nEOF",
    )

    for command in commands:
        reason = git_safety.dangerous_shell_reason(command, cwd="/", env={})
        assert reason and "rm" in reason.lower(), command


def test_process_substitution_heredoc_body_remains_executable():
    command = "cat > >(bash) <<'EOF'\nrm -rf /\nEOF"

    reason = git_safety.dangerous_shell_reason(command, cwd="/", env={})

    assert reason and "rm" in reason.lower()


def test_quoted_cat_heredoc_data_is_not_executed(tmp_path):
    commands = (
        "cat <<'EOF'\nrm -rf /\nEOF",
        f"cat > >(tee '{tmp_path}/report.md') <<'EOF'\nrm -rf /\nEOF",
    )

    for command in commands:
        assert git_safety.dangerous_shell_reason(
            command, cwd="/", env={}
        ) is None, command


def test_report_redirect_after_heredoc_delimiter_masks_prose(tmp_path):
    command = f"cat <<'EOF' > '{tmp_path}/report.md'\nrm -rf /\nEOF"

    assert git_safety.dangerous_shell_reason(command, cwd="/", env={}) is None


# ── PR body non-empty ─────────────────────────────────────────────────────────────

def test_empty_pr_bodies_are_flagged():
    # RED: bodies that must be treated as empty.
    for body in [
        None,
        "",
        "   \n\t  ",
        "<!-- delete this template and write your PR description -->",
        "#\n-\n*",
        "<!-- a -->\n<!-- b -->\n   ",
    ]:
        assert git_safety.pr_body_is_empty(body) is True, f"should be empty: {body!r}"


def test_real_pr_bodies_pass():
    # GREEN: bodies with real content must NOT be flagged.
    for body in [
        "## What\nFixes the auth token refresh race.",
        "Closes #123. Adds a regression test.",
        "<!-- template -->\nReal description here.",
    ]:
        assert git_safety.pr_body_is_empty(body) is False, f"should be non-empty: {body!r}"


# ── --no-verify gate ──────────────────────────────────────────────────────────────

def test_unauthorized_no_verify_is_flagged():
    assert git_safety.is_unauthorized_no_verify("git commit --no-verify -m x") is True
    assert git_safety.is_unauthorized_no_verify("git push --no-verify origin main") is True


def test_authorized_no_verify_passes():
    assert git_safety.is_unauthorized_no_verify("git commit --no-verify -m x", authorized=True) is False


def test_no_verify_false_positives_avoided():
    # `git push -n` is --dry-run (safe), not a bypass.
    assert git_safety.is_unauthorized_no_verify("git push -n origin main") is False
    # A commit with no bypass flag.
    assert git_safety.is_unauthorized_no_verify("git commit -m 'normal commit'") is False
    # --no-verify appearing in unrelated text / non-git command.
    assert git_safety.is_unauthorized_no_verify("echo 'use --no-verify carefully'") is False


def test_no_verify_inside_commit_message_not_flagged():
    # PR #526 Bugbot: --no-verify inside the -m/--message value is text, not a bypass.
    assert git_safety.is_unauthorized_no_verify('git commit -m "fix the --no-verify bug"') is False
    assert git_safety.is_unauthorized_no_verify('git commit --message="document --no-verify"') is False
    # …but a real bypass alongside a message still fires.
    assert git_safety.is_unauthorized_no_verify('git commit -m "msg" --no-verify') is True


def test_no_verify_with_global_options():
    # PR #526 Bugbot: global options between `git` and the subcommand must not hide it.
    assert git_safety.is_unauthorized_no_verify("git -C /repo commit --no-verify -m x") is True
    assert git_safety.is_unauthorized_no_verify("git -c user.name=x push --no-verify origin main") is True


def test_commit_short_n_is_no_verify():
    # PR #526 Bugbot #2: commit's `-n` (and bundled clusters) is the --no-verify bypass…
    assert git_safety.is_unauthorized_no_verify("git commit -n -m x") is True
    assert git_safety.is_unauthorized_no_verify('git commit -nm "msg"') is True
    assert git_safety.is_unauthorized_no_verify("git commit -an -m x") is True
    # …but push -n is --dry-run (safe), and commit clusters without n are fine.
    assert git_safety.is_unauthorized_no_verify("git push -n origin main") is False
    assert git_safety.is_unauthorized_no_verify("git commit -am x") is False


# ── Destructive restore of UNOWNED changes ────────────────────────────────────────

def test_restore_of_unowned_path_is_destructive():
    # RED: discarding a file this session did not touch.
    v = git_safety.is_destructive_restore("git restore src/app.py", owned_paths=["test/app.test.py"])
    assert v["destructive"] is True
    assert v["unowned"] == ["src/app.py"]
    assert "git stash" in v["suggestion"]


def test_blanket_restore_dot_always_destructive():
    # RED: `git checkout .` / `git restore .` discards everything, incl. unowned work.
    for cmd in ["git checkout .", "git restore .", "git checkout -- ."]:
        v = git_safety.is_destructive_restore(cmd, owned_paths=["anything"])
        assert v["destructive"] is True, cmd
        assert v["unowned"] == ["."]


def test_restore_of_only_owned_paths_is_allowed():
    # GREEN: discarding only files this session created is fine (no other agent's work).
    v = git_safety.is_destructive_restore(
        "git checkout -- src/app.py src/util.py",
        owned_paths=["src/app.py", "src/util.py"],
    )
    assert v["destructive"] is False
    assert v["unowned"] == []
    assert v["suggestion"] is None


def test_staged_only_restore_is_not_destructive():
    # PR #526 Bugbot: `git restore --staged` only unstages — working tree untouched, safe.
    v = git_safety.is_destructive_restore("git restore --staged src/app.py", owned_paths=[])
    assert v["destructive"] is False
    assert v["targets"] is None
    # …but `git restore --staged --worktree` DOES discard working-tree changes.
    v2 = git_safety.is_destructive_restore("git restore --staged --worktree src/app.py", owned_paths=[])
    assert v2["destructive"] is True
    assert v2["unowned"] == ["src/app.py"]


def test_restore_with_global_options_is_parsed():
    # PR #526 Bugbot: `git -C /repo restore foo` must still be recognized as a restore.
    v = git_safety.is_destructive_restore("git -C /some/repo restore src/app.py", owned_paths=[])
    assert v["destructive"] is True
    assert v["unowned"] == ["src/app.py"]


def test_branch_switch_is_not_a_restore():
    # GREEN: `git checkout <branch>` must not be mistaken for a working-tree discard.
    for cmd in ["git checkout main", "git checkout -b feature/x", "git checkout feat/new-dashboard"]:
        v = git_safety.is_destructive_restore(cmd, owned_paths=[])
        assert v["destructive"] is False, cmd
        assert v["targets"] is None, cmd


def test_branch_creation_with_start_point_is_not_a_restore():
    # PR #526 Bugbot round 3: `git checkout -b feature origin/main` is branch creation,
    # NOT a destructive restore of origin/main.
    for cmd in [
        "git checkout -b feature origin/main",
        "git checkout -B feature main",
        "git checkout --orphan gh-pages main",
    ]:
        v = git_safety.is_destructive_restore(cmd, owned_paths=[])
        assert v["destructive"] is False, cmd
        assert v["targets"] is None, cmd


def test_restore_source_ref_not_counted_as_path():
    # PR #526 Bugbot round 3: the -s/--source tree-ish is a ref, not a restore target.
    for cmd in [
        "git restore -s HEAD src/app.py",
        "git restore --source HEAD~2 src/app.py",
        "git restore --source=origin/main src/app.py",
    ]:
        v = git_safety.is_destructive_restore(cmd, owned_paths=[])
        assert v["destructive"] is True, cmd
        assert v["unowned"] == ["src/app.py"], cmd


def test_checkout_ref_path_is_a_restore():
    # PR #526 Bugbot #2: `git checkout <ref> <path>` (no `--`) discards working-tree
    # changes for <path> and must be recognized as a restore.
    for cmd in ["git checkout HEAD src/app.py", "git checkout main src/app.py"]:
        v = git_safety.is_destructive_restore(cmd, owned_paths=[])
        assert v["destructive"] is True, cmd
        assert v["unowned"] == ["src/app.py"], cmd
    # …but a single-arg checkout stays a branch switch (not flagged).
    assert git_safety.is_destructive_restore("git checkout main", owned_paths=[])["destructive"] is False


def test_absolute_path_git_binary_recognized():
    # PR #526 Bugbot round 4: `/usr/bin/git restore foo` must parse like `git restore`.
    v = git_safety.is_destructive_restore("/usr/bin/git restore src/app.py", owned_paths=[])
    assert v["destructive"] is True
    assert v["unowned"] == ["src/app.py"]
    assert git_safety.is_unauthorized_no_verify("/opt/homebrew/bin/git commit --no-verify -m x") is True


def test_owned_path_comparison_is_normalized():
    # PR #526 Bugbot round 5: `./src/app.py` and `src/app.py` are the same file — a
    # different spelling in owned_paths must still count as owned (not destructive).
    v = git_safety.is_destructive_restore("git checkout -- ./src/app.py", owned_paths=["src/app.py"])
    assert v["destructive"] is False, v
    v2 = git_safety.is_destructive_restore("git restore src/app.py", owned_paths=["./src/app.py"])
    assert v2["destructive"] is False, v2


def test_non_restore_commands_are_ignored():
    for cmd in ["git status", "git add .", "git commit -m x", "ls -la"]:
        assert git_safety.restore_targets(cmd) is None, cmd


def test_w16_nested_scratch_repo_delete_is_allowed(tmp_path):
    # RED #2: a literal path 6 components deep inside a worktree the agent created was
    # blocked "too broad within repo (0 path components)" — because the target itself
    # holds a .git, so the nearest-repo-root walk stopped ON the target.
    outer, _worktree, scratch = _nested_scratch_repo(tmp_path)
    assert git_safety.dangerous_shell_reason(
        f'rm -rf "{scratch}"', cwd=str(outer), env={}
    ) is None


def test_w16_nested_scratch_repo_subdir_delete_is_allowed(tmp_path):
    # Same root cause one level down: "1 path components" relative to the nested repo.
    outer, _worktree, scratch = _nested_scratch_repo(tmp_path)
    assert git_safety.dangerous_shell_reason(
        f'rm -rf "{scratch}/docs.local"', cwd=str(outer), env={}
    ) is None


def test_w16_worktree_subdir_delete_is_allowed(tmp_path):
    # A worktree's own .git gitfile made every 1-component path inside it "too broad".
    outer, worktree, _scratch = _nested_scratch_repo(tmp_path)
    (worktree / "skills").mkdir()
    assert git_safety.dangerous_shell_reason(
        f'rm -rf "{worktree}/skills"', cwd=str(outer), env={}
    ) is None


def test_w16_same_command_assignment_to_nested_scratch_is_allowed(tmp_path):
    # RED #3: the variable already resolved correctly; the nested-root bug then blocked
    # it anyway. Guards that the assignment path and the breadth path agree.
    outer, _worktree, scratch = _nested_scratch_repo(tmp_path)
    assert git_safety.dangerous_shell_reason(
        f'SCRATCH={scratch}; rm -rf "$SCRATCH"', cwd=str(outer), env={}
    ) is None


