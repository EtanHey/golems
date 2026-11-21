"""Checked-out-branch moves: policy inputs only.

No specimen command is executed; the scratch repos exist so the guard can
read which branch is checked out.
"""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

SKILL = Path(__file__).resolve().parents[2] / 'skills/golem-powers/git-guardian'
spec = importlib.util.spec_from_file_location('guardian_branch_moves', SKILL / 'git_safety.py')
guardian = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guardian)

RESET_HARD_MESSAGE = ('Blocked: this git command can destroy work (reset --hard). '
                      'Use a safe alternative, or ask the lead.')


def hook(command, cwd, home):
    env = {k: v for k, v in os.environ.items()
           if k not in {'GIT_GUARDIAN_LIB', 'AUTONOMOUS', 'CLAUDE_WORKER'} and not k.startswith('GIT_')}
    env['HOME'] = str(home)
    result = subprocess.run([sys.executable, str(SKILL / 'hooks/pre_tool_use.py')], cwd=cwd,
                            env=env, text=True, capture_output=True,
                            input=json.dumps({'tool_name': 'Bash', 'cwd': str(cwd),
                                              'tool_input': {'command': command}}))
    assert result.stderr == ''
    return result.returncode, json.loads(result.stdout)


def git(cwd, *args):
    env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    env.update(GIT_AUTHOR_NAME='t', GIT_AUTHOR_EMAIL='t@example.invalid',
               GIT_COMMITTER_NAME='t', GIT_COMMITTER_EMAIL='t@example.invalid',
               GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM='1')
    return subprocess.run(['git', '-C', str(cwd), *args], env=env, check=True,
                          capture_output=True, text=True).stdout.strip()


# ── 2. moving the checked-out branch ────────────────────────────────────────

@pytest.fixture
def repo(tmp_path):
    home = tmp_path / 'owner'
    root = home / 'Gits' / 'scratch'
    root.mkdir(parents=True)
    git(root, 'init', '-q', '-b', 'main')
    for message in ('one', 'two'):
        (root / 'f').write_text(message)
        git(root, 'add', 'f')
        git(root, 'commit', '-q', '-m', message)
    git(root, 'branch', 'other', 'HEAD~1')
    git(root, 'worktree', 'add', '-q', str(home / 'Gits' / 'scratch-wt'), '-b', 'feat')
    return home, root


CHECKED_OUT_MOVES = [
    'git branch -f main HEAD~1',
    'git branch --force main HEAD~1',
    'git branch -fq main HEAD~1',
    'git checkout -B main HEAD~1',
    'git checkout -Bmain HEAD~1',
    'git switch -C main HEAD~1',
    'git switch --force-create main HEAD~1',
    'git switch --force-create=main HEAD~1',
    'git update-ref refs/heads/main HEAD~1',
    'git update-ref -m msg refs/heads/main HEAD~1',
    'git update-ref HEAD HEAD~1',
    'git update-ref -d refs/heads/main',
    'git switch --detach && git branch -f main HEAD~1 && git switch main',
    'git update-ref refs/heads/feat HEAD~1',  # checked out in a linked worktree
    'git-branch -f main HEAD~1',
]


@pytest.mark.parametrize('command', CHECKED_OUT_MOVES)
def test_moving_the_checked_out_branch_is_refused_like_reset_hard(repo, command):
    home, root = repo
    assert guardian.dangerous_shell_reason(command, cwd=str(root), env={'HOME': str(home)})
    assert hook(command, root, home) == (2, {'decision': 'block', 'reason': RESET_HARD_MESSAGE})


@pytest.mark.parametrize('command', [
    'git -C scratch branch -f main scratch~1',
    'cd scratch && git switch -C main HEAD~1',
    'cd scratch; git update-ref refs/heads/main HEAD~1',
    'bash -c "cd scratch && git checkout -B main HEAD~1"',
])
def test_repo_is_found_through_cd_and_dash_c(repo, command):
    home, root = repo
    assert hook(command, root.parent, home) == (2, {'decision': 'block', 'reason': RESET_HARD_MESSAGE})


@pytest.mark.parametrize('command', [
    'git branch -f other HEAD',
    'git branch -f brand-new HEAD',
    'git checkout -B other HEAD',
    'git switch -C other HEAD',
    'git update-ref refs/heads/other HEAD',
    'git update-ref --no-deref HEAD HEAD~1',
    'git update-ref refs/remotes/origin/main HEAD',
    'git branch -f',
    'git branch other-two',
    'git switch -c fresh',
    'OPT=-B; git checkout "$OPT" other HEAD',
    'OPT=-C; git switch "$OPT" other HEAD',
    'OPT=-f; git branch "$OPT" other HEAD',
    'BRANCH=other; git checkout -B "$BRANCH" HEAD',
    'REF=refs/heads/other; git update-ref "$REF" HEAD',
])
def test_moving_a_branch_that_is_not_checked_out_keeps_todays_behaviour(repo, command):
    home, root = repo
    assert guardian.dangerous_shell_reason(command, cwd=str(root), env={'HOME': str(home)}) is None
    assert hook(command, root, home) == (0, {})


def test_reset_hard_is_unchanged(repo):
    home, root = repo
    assert hook('git reset --hard HEAD~1', root, home) == (2, {'decision': 'block', 'reason': RESET_HARD_MESSAGE})


def test_unknown_directory_fails_closed(repo):
    home, root = repo
    code, decision = hook('cd "$UNKNOWN" && git branch -f main HEAD~1', root, home)
    assert code == 2 and decision['reason'] == RESET_HARD_MESSAGE


# ── 3. `git update-ref --stdin` ─────────────────────────────────────────────

STDIN_UNSEEN_SUFFIX = ('git update-ref --stdin reads its input from somewhere this command does not show, '
                       'so the guard cannot tell which branches it moves; put the lines in a heredoc or printf.')

STDIN_VISIBLE_MOVES = [
    "printf 'update refs/heads/main HEAD~1\\n' | git update-ref --stdin",
    "echo 'update refs/heads/main HEAD~1' | git update-ref --stdin",
    "git update-ref --stdin <<'EOF'\nupdate refs/heads/main HEAD~1\nEOF",
    "git update-ref --stdin <<EOF\nverify refs/heads/other HEAD\nupdate refs/heads/main HEAD~1\nEOF",
    "git update-ref --stdin <<-EOF\n\tupdate refs/heads/main HEAD~1\n\tEOF",
    "git update-ref --stdin <<< 'update refs/heads/main HEAD~1'",
    "cat <<'EOF' | git update-ref --stdin\nupdate refs/heads/main HEAD~1\nEOF",
    "printf 'create refs/heads/new HEAD\\ndelete refs/heads/feat\\n' | git update-ref --stdin",
    "printf 'update HEAD HEAD~1\\n' | git update-ref --stdin",
    "printf 'update refs/heads/main\\0HEAD~1\\0\\0' | git update-ref -z --stdin",
    "printf 'option no-deref\\nupdate HEAD HEAD~1\\nupdate refs/heads/main HEAD~1\\n' | git update-ref --stdin",
    "printf 'start\\nupdate \"refs/heads/main\" HEAD~1\\ncommit\\n' | git update-ref --stdin",
    "printf 'update %s HEAD~1\\n' refs/heads/main | git update-ref -m msg --stdin",
    "printf 'update %s HEAD~1\\n' \"$REF\" | git update-ref --stdin",
    "git update-ref --stdin <<EOF\nupdate $REF HEAD~1\nEOF",
    "bash -c \"printf 'update refs/heads/main HEAD~1\\n' | git update-ref --stdin\"",
    "git update-ref --stdin <<< $'update refs/heads/main HEAD~1'",
    "printf '%b' 'verify refs/heads/other HEAD\\nupdate refs/heads/main HEAD~1' | git update-ref --stdin",
    "cat <<A\nupdate refs/heads/other HEAD\nA\ngit update-ref --stdin <<B\nupdate refs/heads/main HEAD~1\nB",
]

STDIN_UNSEEN = [
    'git update-ref --stdin < moves.txt',
    'git update-ref --stdin',
    'git update-ref -z --stdin 0<moves.txt',
    'make-moves | git update-ref --stdin',
    "git update-ref --stdin 3<<'EOF'\nupdate refs/heads/other HEAD\nEOF",
    "git update-ref --stdin < <(printf 'update refs/heads/other HEAD\\n')",
    "printf 'update refs/heads/other HEAD\\n' | tee /dev/null | git update-ref --stdin",
]


@pytest.mark.parametrize('command', STDIN_VISIBLE_MOVES)
def test_update_ref_stdin_that_moves_the_checked_out_branch_is_refused(repo, command):
    home, root = repo
    assert guardian.dangerous_shell_reason(command, cwd=str(root), env={'HOME': str(home)})
    assert hook(command, root, home) == (2, {'decision': 'block', 'reason': RESET_HARD_MESSAGE})


def test_update_ref_stdin_finds_the_repo_through_cd(repo):
    home, root = repo
    command = "cd scratch && git update-ref --stdin <<'EOF'\nupdate refs/heads/main HEAD~1\nEOF"
    assert hook(command, root.parent, home) == (2, {'decision': 'block', 'reason': RESET_HARD_MESSAGE})


@pytest.mark.parametrize('command', STDIN_UNSEEN)
def test_update_ref_stdin_with_unseen_input_fails_closed_and_says_why(repo, command):
    home, root = repo
    assert guardian.dangerous_shell_reason(command, cwd=str(root), env={'HOME': str(home)})
    assert hook(command, root, home) == (
        2, {'decision': 'block', 'reason': RESET_HARD_MESSAGE + ' ' + STDIN_UNSEEN_SUFFIX})


@pytest.mark.parametrize('command', [
    "printf 'update refs/heads/other HEAD\\n' | git update-ref --stdin",
    "echo 'create refs/heads/brand-new HEAD' | git update-ref --stdin",
    "git update-ref --stdin <<'EOF'\nupdate refs/heads/other HEAD\ncreate refs/heads/brand-new HEAD\nEOF",
    "git update-ref --stdin <<< 'delete refs/heads/other'",
    "cat <<'EOF' | git update-ref --stdin\nupdate refs/remotes/origin/main HEAD\nEOF",
    "printf 'verify refs/heads/main HEAD\\n' | git update-ref --stdin",
    "printf 'option no-deref\\nupdate HEAD HEAD~1\\n' | git update-ref --stdin",
    "git update-ref --no-deref --stdin <<< 'update HEAD HEAD~1'",
    "printf 'update refs/heads/other\\0HEAD\\0\\0' | git update-ref -z --stdin",
    "cat <<A\nupdate refs/heads/main HEAD~1\nA\ngit update-ref --stdin <<B\nupdate refs/heads/other HEAD\nB",
])
def test_update_ref_stdin_on_a_branch_that_is_not_checked_out_stays_allowed(repo, command):
    home, root = repo
    assert guardian.dangerous_shell_reason(command, cwd=str(root), env={'HOME': str(home)}) is None
    assert hook(command, root, home) == (0, {})


# Sol round 2: specimens are policy input, never executed.
@pytest.mark.parametrize('body', [
    'upda\\\nte refs/heads/main HEAD~1',
    'update refs/hea\\\nds/main HEAD~1',
    'option no-deref\\\nX\nupdate HEAD HEAD~1',
])
def test_heredoc_continuations_fail_closed(repo, body):
    home, root = repo
    code, decision = hook('git update-ref --stdin <<EOF\n' + body + '\nEOF', root, home)
    assert code == 2 and decision['decision'] == 'block'


@pytest.mark.parametrize('command', [
    'git update-ref refs/remotes/local/alias HEAD~1',
    "printf 'update refs/remotes/local/alias HEAD~1\\n' | git update-ref --stdin",
])
@pytest.mark.parametrize('existing', [False, True])
def test_symbolic_refs_cannot_hide_checked_out_branch(repo, command, existing):
    home, root = repo
    if existing:
        git(root, 'symbolic-ref', 'refs/remotes/local/alias', 'refs/heads/main')
    else:
        command = 'git symbolic-ref refs/remotes/local/alias refs/heads/main; ' + command
    assert hook(command, root, home) == (2, {'decision': 'block', 'reason': RESET_HARD_MESSAGE})


@pytest.mark.parametrize('command', [
    'REF=refs/heads/main; git update-ref "$REF" HEAD~1',
    'BRANCH=main; git checkout -B "$BRANCH" HEAD~1',
    'BRANCH=main; git switch -C "$BRANCH" HEAD~1',
    'BRANCH=feat; git branch -f "$BRANCH" HEAD~1',
    'git update-ref "$UNKNOWN" HEAD~1',
    'git checkout -B "$UNKNOWN" HEAD~1',
    'git switch --force-create="$UNKNOWN" HEAD~1',
    'git branch -M other "$UNKNOWN"',
])
def test_variable_targets_fail_closed(repo, command):
    home, root = repo
    assert hook(command, root, home) == (2, {'decision': 'block', 'reason': RESET_HARD_MESSAGE})


@pytest.mark.parametrize('command', [
    'OPT=-B; git checkout "$OPT" main HEAD~1',
    'OPT=-C; git switch "$OPT" main HEAD~1',
    'args=(-B main HEAD~1); git checkout $args',
    'args=(-C main HEAD~1); git switch $args',
    'OPT=-f; git branch "$OPT" main HEAD~1',
    'git checkout "$UNKNOWN" main HEAD~1',
    'git switch "$UNKNOWN" main HEAD~1',
])
def test_expanded_options_cannot_hide_branch_moves(repo, command):
    home, root = repo
    assert hook(command, root, home) == (2, {'decision': 'block', 'reason': RESET_HARD_MESSAGE})


def test_literal_dollar_ref_is_checked_before_assignment_expansion(repo):
    home, root = repo
    git(root, 'symbolic-ref', 'refs/remotes/local/$ALIAS', 'refs/heads/main')
    command = "ALIAS=other; git update-ref 'refs/remotes/local/$ALIAS' HEAD~1"
    assert hook(command, root, home) == (2, {'decision': 'block', 'reason': RESET_HARD_MESSAGE})


def test_no_deref_known_non_checked_out_ref_stays_allowed(repo):
    home, root = repo
    command = 'REF=refs/heads/other; git update-ref --no-deref "$REF" HEAD'
    assert hook(command, root, home) == (0, {})


# PR #1325, Sol round 1: clustered options, executable aliases, read-only lists.
@pytest.mark.parametrize('command', [
    'git checkout -qB main HEAD~1',
    'git switch -qC main HEAD~1',
    'git checkout -qBmain HEAD~1',
    'git switch -qCmain HEAD~1',
    'OPT=-qB; git checkout "$OPT" main HEAD~1',
    'OPT=-qCmain; git switch "$OPT" HEAD~1',
])
def test_r1_clustered_force_create_is_refused(repo, command):
    home, root = repo
    assert hook(command, root, home) == (2, {'decision': 'block', 'reason': RESET_HARD_MESSAGE})


@pytest.mark.parametrize('command', [
    "git -c 'alias.back=update-ref refs/heads/main HEAD~1' back",
    "git -c 'alias.back=checkout -B' back main HEAD~1",
    "git -calias.back='switch -qC' back main HEAD~1",
    "git -c 'alias.back=next' -c 'alias.next=update-ref refs/heads/feat HEAD~1' back",
    "shopt -s expand_aliases\nalias back='git update-ref refs/heads/main HEAD~1'\nback",
    "shopt -s expand_aliases\nalias back='git checkout -B'\nback main HEAD~1",
])
def test_r1_alias_branch_moves_are_refused(repo, command):
    home, root = repo
    assert hook(command, root, home) == (2, {'decision': 'block', 'reason': RESET_HARD_MESSAGE})


def test_r1_stored_git_alias_is_refused(repo):
    home, root = repo
    git(root, 'config', 'alias.back', 'update-ref refs/heads/main HEAD~1')
    assert hook('git back', root, home) == (2, {'decision': 'block', 'reason': RESET_HARD_MESSAGE})


def test_r1_shell_alias_uses_invocation_directory(repo):
    home, root = repo
    command = "cd scratch\nshopt -s expand_aliases\nalias back='git update-ref refs/heads/main HEAD~1'\nback"
    assert hook(command, root.parent, home) == (2, {'decision': 'block', 'reason': RESET_HARD_MESSAGE})


@pytest.mark.parametrize('command', [
    "git branch --list 'feat*'",
    "git branch --list 'feat*' --format='%(refname:short)'",
    'git checkout -qB other HEAD',
    'git switch -qCother HEAD',
    "git -c 'alias.peek=status --short' peek",
    "git -c 'alias.peek=branch --list' peek 'feat*'",
    "git -c 'alias.back=checkout -qB' back other HEAD",
    "shopt -s expand_aliases\nalias peek='git branch --list'\npeek 'feat*'",
    "shopt -s expand_aliases\nalias back='git update-ref refs/heads/other HEAD'\nback",
    "alias back='git update-ref refs/heads/main HEAD~1'",
])
def test_r1_read_only_and_unchecked_controls_stay_allowed(repo, command):
    home, root = repo
    assert hook(command, root, home) == (0, {})


@pytest.mark.parametrize('command', [
    "shopt -s expand_aliases\nalias back='git update-ref --stdin'\nback <<< 'update refs/heads/main HEAD~1'",
    "shopt -s expand_aliases\nalias setbranch='BRANCH=main'\nBRANCH=other\nsetbranch\ngit checkout -B \"$BRANCH\" HEAD~1",
])
def test_r1_alias_input_and_state_uncertainty_fail_closed(repo, command):
    home, root = repo
    code, decision = hook(command, root, home)
    assert code == 2 and decision['decision'] == 'block'


def test_r1_alias_directory_effect_is_not_lost(repo):
    home, root = repo
    command = "shopt -s expand_aliases\nalias enter='cd scratch'\nenter\ngit update-ref refs/heads/main HEAD~1"
    code, decision = hook(command, root.parent, home)
    assert code == 2 and decision['decision'] == 'block'


@pytest.mark.parametrize('command', [
    "git -c 'alias.status=update-ref refs/heads/main HEAD~1' status --short",
    'git checkout -qb topicB HEAD',
    'git switch -qc topicC HEAD',
])
def test_r1_builtin_and_non_forced_create_controls(repo, command):
    home, root = repo
    assert hook(command, root, home) == (0, {})


@pytest.mark.parametrize('command', [
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.back GIT_CONFIG_VALUE_0='update-ref refs/heads/main HEAD~1' git back",
    "shopt -s expand_aliases\nalias back='git next'\nGIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.next GIT_CONFIG_VALUE_0='update-ref refs/heads/main HEAD~1' back",
])
def test_r1_environment_defined_aliases_fail_closed(repo, command):
    home, root = repo
    code, decision = hook(command, root, home)
    assert code == 2 and decision['decision'] == 'block'



def test_r1_listing_token_after_separator_cannot_waive_dynamic_options(repo):
    home, root = repo
    code, decision = hook('git branch * -- --list', root, home)
    assert code == 2 and decision['decision'] == 'block'


@pytest.mark.parametrize('command', [
    "git branch -l 'feat*'",
    "git branch -vl --format='%(refname:short)' 'feat*'",
])
def test_r1_short_listing_patterns_stay_allowed(repo, command):
    home, root = repo
    assert hook(command, root, home) == (0, {})


@pytest.mark.parametrize('command', [
    'git branch --list * HEAD~1',
    'git branch --list --no-list * HEAD~1',
])
def test_r1_unquoted_globs_cannot_cancel_listing_mode(repo, command):
    home, root = repo
    code, decision = hook(command, root, home)
    assert code == 2 and decision['decision'] == 'block'



def test_r1_alias_quote_proof_does_not_cross_shell_execution(repo):
    home, root = repo
    command = "shopt -s expand_aliases\nalias peek='bash -c \"git branch --list * HEAD~1\"'\npeek"
    code, decision = hook(command, root, home)
    assert code == 2 and decision['decision'] == 'block'



def test_r1_comment_quotes_cannot_hide_unquoted_listing_globs(repo):
    home, root = repo
    code, decision = hook("# '\ngit branch --list * HEAD~1", root, home)
    assert code == 2 and decision['decision'] == 'block'



def test_r1_unknown_listing_options_do_not_get_the_pattern_waiver(repo):
    home, root = repo
    command = "git branch --list --no-lis --forc main HEAD~1 --format '*'"
    code, decision = hook(command, root, home)
    assert code == 2 and decision['decision'] == 'block'
