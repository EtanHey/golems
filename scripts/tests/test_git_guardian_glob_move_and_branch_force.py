"""Glob `mv` sources and checked-out-branch moves: policy inputs only.

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
spec = importlib.util.spec_from_file_location('guardian_glob_branch', SKILL / 'git_safety.py')
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


# ── 1. glob sources of `mv` ────────────────────────────────────────────────

# A generic copy of a refused call: a python heredoc that edits a file, then a
# `mkdir -p`, then a `mv` of literal files and globs into the new folder.
REFUSED_SHAPE = """cd ~/Gits/project/captures; python3 - <<'EOF'
p='capture.py';t=open(p).read()
t=t.replace("sleep(.05)","sleep(.1)")
t=t.replace("def run():","def probe(pid):return [x for x in tree(pid) if 'Button' in x]\\ndef run():")
open(p,'w').write(t)
EOF
mkdir -p .work/superseded; mv .work/overview-copy-still-*.png .work/case-before.png .work/zz-* .work/superseded/ ; python3 capture.py run 2>&1 | grep -v "^/Users" | tail; grep "case" MANIFEST.md | tail -1"""


@pytest.fixture
def captures(tmp_path, monkeypatch):
    home = tmp_path / 'owner'
    monkeypatch.setenv('HOME', str(home))  # the protected-root rules read the process HOME
    project = home / 'Gits' / 'project'
    (project / '.git').mkdir(parents=True)
    work = project / 'captures' / '.work'
    work.mkdir(parents=True)
    for name in ('overview-copy-still-1.png', 'overview-copy-still-2.png',
                 'case-before.png', 'zz-a.txt', 'zz-b.txt', '.zz-hidden'):
        (work / name).write_text('x')
    for name in ('project', 'site-a', 'site-b'):
        (home / 'Gits' / name / '.git' / 'refs').mkdir(parents=True, exist_ok=True)
        (home / 'Gits' / name / '.git' / 'HEAD').write_text('ref: refs/heads/main\n')
    (home / '.config' / 'tool').mkdir(parents=True)
    return home, project


@pytest.mark.parametrize('command', [
    REFUSED_SHAPE,
    'cd captures && mv .work/overview-copy-still-*.png .work/superseded/',
    'cd captures && mv .work/zz-? .work/zz-?.txt elsewhere/',
    'cd captures && mv -t .work/superseded .work/zz-*',
    'cd captures && mv .work/no-match-* .work/superseded/',
    'cd captures && mv .work/* .work/superseded/',
])
def test_glob_move_of_ordinary_files_is_allowed(captures, command):
    home, project = captures
    assert guardian.dangerous_shell_reason(command, cwd=str(project), env={'HOME': str(home)}) is None
    code, decision = hook(command, project, home)
    assert (code, decision) == (0, {})


@pytest.mark.parametrize('command', [
    'mv ~/Gits/* ~/elsewhere/',
    'mv ~/Gits/site-* ~/elsewhere/',
    'mv ~/Gi*s ~/elsewhere',
    'mv ~/.conf*/tool ~/elsewhere/',
    'mv .gi* ~/elsewhere/',
    'mv .git/* ~/elsewhere/',
    'cd ~/Gits && mv */.git ~/elsewhere/',
    'cd captures && mv .work/zz-[ab].txt elsewhere/',
    'cd captures && mv .work/zz-{a,b}.txt elsewhere/',
    'cd captures && mv .work/$X* elsewhere/',
    'cd captures && ln -s ~/Gits/site-a .work/zz-link && mv .work/zz-* elsewhere/',
    'cd captures && cd "$UNKNOWN" && mv .work/zz-* elsewhere/',
])
def test_glob_move_that_may_reach_a_protected_root_stays_denied(captures, command):
    home, project = captures
    assert guardian.dangerous_shell_reason(command, cwd=str(project), env={'HOME': str(home)})
    code, decision = hook(command, project, home)
    assert code == 2 and decision['decision'] == 'block'


def test_glob_expansion_is_bounded(captures):
    home, project = captures
    crowd = project / 'captures' / 'crowd'
    crowd.mkdir()
    for index in range(1100):
        (crowd / f'f{index}').write_text('')
    reason = guardian.dangerous_shell_reason('mv crowd/* elsewhere/', cwd=str(project / 'captures'),
                                             env={'HOME': str(home)})
    assert reason


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
def test_trailing_slash_glob_preserves_symlink_traversal(captures):
    home, project = captures
    (project / 'captures' / 'link0').symlink_to(home / 'Gits' / 'site-a')
    code, decision = hook('mv link0*/ ~/elsewhere/', project / 'captures', home)
    assert code == 2 and decision['decision'] == 'block'


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
