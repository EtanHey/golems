"""RED→GREEN replay fixtures for git-guardian's mechanical checks (gen-18 Track 6 D6).

Each RED case is a footgun the rule must catch; each GREEN case is a safe operation the
rule must NOT block (the false-positive gate). Pure functions → fully deterministic.
"""

import importlib.util
import os
import sys
from pathlib import Path

MODULE = Path(__file__).resolve().parent.parent / "git_safety.py"
spec = importlib.util.spec_from_file_location("git_safety", MODULE)
git_safety = importlib.util.module_from_spec(spec)
sys.modules["git_safety"] = git_safety
spec.loader.exec_module(git_safety)


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
