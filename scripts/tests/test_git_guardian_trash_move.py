"""Trash moves are policy inputs only: no specimen command is executed."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

SKILL = Path(__file__).resolve().parents[2] / 'skills/golem-powers/git-guardian'
spec = importlib.util.spec_from_file_location('guardian_trash', SKILL / 'git_safety.py')
guardian = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guardian)

COMPOUND = ('cd ~/Gits && mkdir -p site-audit-findings/09-drive-archive/kept-local-saved-google-pages '
            '&& cp -R site-audit-assets/research/saved/. site-audit-findings/09-drive-archive/kept-local-saved-google-pages/ '
            '&& mv site-audit-assets ~/.Trash/site-audit-assets-moved-to-drive-2026-11-13 '
            '&& mkdir site-audit-assets '
            '&& cp ~/Gits/fixture-coordinator/notes/site-audit-assets-NOTE.md site-audit-assets/WHERE-THIS-WENT.md')

@pytest.fixture
def workspace(tmp_path, monkeypatch):
    home = tmp_path / 'owner'
    repo = home / 'Gits' / 'golems'
    (repo / '.git' / 'worktrees' / 'worker').mkdir(parents=True)
    (home / 'Gits' / 'site-audit-assets' / '.git').mkdir(parents=True)
    (home / '.Trash').mkdir()
    (home / '.config' / 'tool').mkdir(parents=True)
    monkeypatch.setenv('HOME', str(home))
    return home, repo

@pytest.mark.parametrize('command', [
    'mv site-audit-assets ~/.Trash/new',
    'mv ~/Gits/site-audit-assets ~/.Trash/new',
    'mv "$HOME/Gits/site-audit-assets" "$HOME/.Trash/new"',
    COMPOUND,
])
def test_reversible_move_allows(workspace, command):
    home, repo = workspace
    cwd = repo if command == COMPOUND else repo.parent
    reason = guardian.dangerous_shell_reason(command, cwd=str(cwd), env={'HOME': str(home)})
    env = {k: v for k, v in os.environ.items() if k not in {'GIT_GUARDIAN_LIB', 'AUTONOMOUS', 'CLAUDE_WORKER'}}
    result = subprocess.run([sys.executable, str(SKILL / 'hooks/pre_tool_use.py')], cwd=repo,
        env=env, text=True, input=json.dumps({'tool_name': 'Bash', 'tool_input': {'command': command},
        'cwd': str(cwd)}), capture_output=True)
    assert result.returncode == 0, (result.stdout, result.stderr)
    assert reason is None

@pytest.mark.parametrize('command', [
    'mv ~/Gits/site-audit-assets ~/.Trash/existing',
    'mv .git ~/.Trash/new',
    'mv .git/worktrees/worker ~/.Trash/new',
    'mv . ~/.Trash/new',
    'cd .. && mv golems ~/.Trash/new',
    'rm -rf ~/Gits/site-audit-assets',
    'mv ~/Gits/site-audit-assets ~/.config/tool',
])
def test_denials_stay_denied(workspace, command):
    home, repo = workspace
    (home / '.Trash' / 'existing').mkdir()
    assert guardian.dangerous_shell_reason(command, cwd=str(repo), env={'HOME': str(home)})


def test_symlinked_trash_escape_denies(workspace):
    home, repo = workspace
    (home / '.Trash').rmdir()
    (home / 'elsewhere').mkdir()
    (home / '.Trash').symlink_to(home / 'elsewhere', target_is_directory=True)
    assert guardian.dangerous_shell_reason('mv ~/Gits/site-audit-assets ~/.Trash/new',
        cwd=str(repo), env={'HOME': str(home)})


@pytest.mark.parametrize('prefix', ['mkdir ~/.Trash/new && ',
    'mv ~/Gits/site-audit-assets ~/.Trash/new && '])
def test_prior_destination_creation_denies(workspace, prefix):
    home, repo = workspace
    assert guardian.dangerous_shell_reason(prefix + 'mv ~/Gits/site-audit-assets ~/.Trash/new',
        cwd=str(repo), env={'HOME': str(home)})


def test_linked_checkout_and_external_admin_stay_protected(workspace):
    home, repo = workspace
    checkout = repo / '.worktrees' / 'active'
    checkout.mkdir(parents=True)
    admin = home / 'metadata' / 'admin'
    admin.mkdir(parents=True)
    (checkout / '.git').write_text(f'gitdir: {admin}\n')
    (admin / 'HEAD').write_text('ref: refs/heads/main\n')
    for source in (checkout, admin, admin / 'HEAD'):
        assert guardian.dangerous_shell_reason(f'mv "{source}" ~/.Trash/new',
            cwd=str(checkout), env={'HOME': str(home)})


@pytest.mark.parametrize('entry', ['file', 'directory', 'dangling-link'])
def test_existing_trash_entries_deny_even_ordinary_sources(workspace, entry):
    home, repo = workspace
    source = repo / 'docs.local' / 'scratch'
    source.mkdir(parents=True)
    target = home / '.Trash' / 'new'
    if entry == 'file':
        target.write_text('kept')
    elif entry == 'directory':
        target.mkdir()
    else:
        target.symlink_to(home / 'missing')
    assert guardian.dangerous_shell_reason(f'mv "{source}" ~/.Trash/new',
        cwd=str(repo), env={'HOME': str(home)})


def test_symlink_parent_traversal_cannot_gain_trash_exception(workspace):
    home, repo = workspace
    outside = home / 'elsewhere' / 'child'
    outside.mkdir(parents=True)
    (home / '.Trash' / 'escape').symlink_to(outside, target_is_directory=True)
    assert guardian.dangerous_shell_reason(
        'mv ~/Gits/site-audit-assets ~/.Trash/escape/../new',
        cwd=str(repo), env={'HOME': str(home)})


@pytest.mark.parametrize('destination', ["'~/.Trash/new'", '"~/.Trash/new"',
    "'$HOME/.Trash/new'", r'\~/.Trash/new', r'\$HOME/.Trash/new'])
def test_literal_quoted_expansions_do_not_gain_trash_exception(workspace, destination):
    home, repo = workspace
    assert guardian.dangerous_shell_reason(f'mv ~/Gits/site-audit-assets {destination}',
        cwd=str(repo), env={'HOME': str(home)})


def test_unquoted_variable_splitting_cannot_gain_trash_exception(workspace):
    home, repo = workspace
    assert guardian.dangerous_shell_reason(
        'TARGET="$HOME/.Trash/new target"; mv ~/Gits/site-audit-assets $TARGET',
        cwd=str(repo), env={'HOME': str(home)})
