"""R2 tool-policy regressions. Command strings are never executed."""
import os
from pathlib import Path
import json
import shutil
import subprocess
import sys

import pytest

from test_repo_parent_rm import guardian, workspace, SKILL, ROOT


@pytest.mark.parametrize('shape', [
    '-x ~/Gits', '-s ~/Gits', '-d ~/Gits', '-E ~/Gits', '-X ~/Gits',
    '-f ~/Gits', '-L -x ~/Gits', '-x ~/.claude', '-delete ~/Gits',
    '-mindepth 1 ~/Gits', '-O3 ~/Gits', '-S dfs ~/Gits', '-D tree ~/Gits',
    'docs.local/scratch -name harmless ~/Gits',
])
def test_find_collects_all_roots(workspace, shape):
    _, _, _, outside = workspace
    assert guardian.dangerous_shell_reason(f'find {shape} -delete', cwd=str(outside))


@pytest.mark.parametrize('command', [
    'rsync -a --del ~/Downloads/scratch/ ~/Gits/',
    'rsync -a ~/Downloads/scratch/ ~/Gits/ --del',
])
def test_rsync_deletion_alias(workspace, command):
    _, repo, _, _ = workspace
    assert guardian.dangerous_shell_reason(command, cwd=str(repo))


@pytest.mark.parametrize('command', [
    'mv ~/.claude/settings.json.tmp ~/.claude/settings.json',
    'mv ~/.claude/settings.json ~/.claude/settings.json.bak',
    'mv ~/.zshrc.new ~/.zshrc', 'mv ~/.codex/config.toml.new ~/.codex/config.toml',
    'mv ~/foo.txt ~/Documents/',
    'L=~/.claude/skill-index.md; mv "$L.tmp-realfile" "$L"',
    'rm -rf ~/.zcompdump', 'rm -rf ~/.DS_Store',
    'rm -rf ~/.claude/settings.json.bak',
    "find . -name '*.pyc' -delete", 'find . -name .DS_Store -delete',
    'find . -type d -name __pycache__ -empty -delete',
    "find . -path ./node_modules -prune -o -name '*.pyc' -delete",
    "find skills -name '*.pyc' -delete",
    'find docs.local -mindepth 1 -maxdepth 1 -mtime +7 -delete',
])
def test_legitimate_cleanup_and_atomic_files(workspace, command):
    home, repo, _, _ = workspace
    (home / 'Documents').mkdir(exist_ok=True)
    for relative in ['.claude/settings.json.tmp', '.claude/settings.json',
                     '.claude/settings.json.bak', '.claude/skill-index.md.tmp-realfile',
                     '.codex/config.toml.new', '.zshrc.new', '.zcompdump', '.DS_Store', 'foo.txt']:
        file = home / relative
        file.parent.mkdir(exist_ok=True)
        file.touch()
    (repo / 'skills').mkdir()
    assert guardian.dangerous_shell_reason(command, cwd=str(repo)) is None


@pytest.mark.parametrize('command', [
    "find ~/Gits -name '*.pyc' -delete", "find ~/.claude -name '*.pyc' -delete",
    'find . -name harmless -o -delete', 'find . ! -name harmless -delete',
    'find . -unknown-primary harmless -delete', 'cd ~/Gits && find -delete',
    "find . -name '*' -delete", "find . -path './*' -delete",
    'find . -mindepth 1 -delete',
    'find docs.local -mindepth 1 -delete',
    'find docs.local -mindepth 1 -mtime +7 -o -delete',
    'find . -mindepth 1 -mtime +7 -delete',
    "find . -regex '.*/.*' -delete",
    "find . -name '*[!.]' -delete",
    "find . -name '*.*' -delete",
])
def test_filters_do_not_erase_protected_roots(workspace, command):
    _, repo, _, _ = workspace
    assert guardian.dangerous_shell_reason(command, cwd=str(repo))


def test_tilde_plus_is_cwd_not_home(workspace):
    home, repo, _, _ = workspace
    assert guardian.dangerous_shell_reason(
        f'cd "{home.parent}" && rm -rf ~+/owner/Gits', cwd=str(repo))


@pytest.mark.parametrize('command', [
    'rm -r ~/gits/organization', 'cd ~/GITS && rm -rf organization',
    'find ~/gits/organization -delete',
    'rsync -a --delete ~/Downloads/scratch/ ~/gITS/organization/',
])
def test_case_alias_descendant_probe(workspace, command):
    home, _, _, outside = workspace
    (home / 'Gits/organization/child/.git').mkdir(parents=True)
    if not (home / 'gits').exists():
        pytest.skip('requires case-insensitive filesystem')
    assert guardian.dangerous_shell_reason(command, cwd=str(outside))


@pytest.mark.parametrize('alias_is_directory', [True, False])
def test_home_case_fallback_when_identity_unavailable(workspace, monkeypatch, alias_is_directory):
    home, repo, _, _ = workspace
    (home / 'Documents').mkdir(exist_ok=True)
    alias = str(home).upper() + '/Documents'
    original_isdir = os.path.isdir
    # Model the alias precondition explicitly on both APFS and Linux. A missing
    # distinct path must remain allowed; only a directory needs the fallback.
    monkeypatch.setattr(os.path, 'isdir',
                        lambda target: alias_is_directory if target == alias else original_isdir(target))
    monkeypatch.setattr(os.path, 'samefile', lambda *_: (_ for _ in ()).throw(OSError('synthetic')))
    reason = guardian.dangerous_shell_reason(f'rm -rf "{alias}"', cwd=str(repo))
    if alias_is_directory:
        assert reason
    else:
        assert reason is None


def test_existing_distinct_identity_wins_over_case_spelling(workspace, monkeypatch):
    home, repo, _, _ = workspace
    alias = str(home).upper() + '/Documents'
    if not os.path.isdir(alias):
        pytest.skip('requires existing case spelling fixture')
    monkeypatch.setattr(os.path, 'samefile', lambda *_: False)
    assert guardian.dangerous_shell_reason(f'rm -r "{alias}"', cwd=str(repo)) is None


@pytest.mark.parametrize('relative', ['Documents', '.claude/hooks', 'Gits/organization'])
def test_firmlink_identity_without_text_prefix(workspace, tmp_path, monkeypatch, relative):
    home, _, _, outside = workspace
    alias = tmp_path / 'data-volume/owner'
    for base in [home, alias]:
        (base / relative).mkdir(parents=True, exist_ok=True)
        if relative.startswith('Gits'):
            (base / relative / 'child/.git').mkdir(parents=True)
    original = os.path.samefile
    def samefile(a, b):
        def canonical(path):
            return str(path).replace(str(alias), str(home))
        return original(canonical(a), canonical(b))
    monkeypatch.setattr(os.path, 'samefile', samefile)
    assert guardian.dangerous_shell_reason(f'rm -r "{alias / relative}"', cwd=str(outside))


def test_copied_hook_tool_and_file_policy(workspace, tmp_path):
    home, repo, _, outside = workspace
    (home / '.claude').mkdir()
    (home / '.claude/settings.json.tmp').touch()
    copied = tmp_path / 'installed/git-guardian'
    shutil.copytree(SKILL, copied, ignore=shutil.ignore_patterns('__pycache__'))
    shutil.copytree(SKILL.parent / '_shared', copied.parent / '_shared', ignore=shutil.ignore_patterns('__pycache__'))
    wrapper = ROOT / 'scripts/hooks/fail-open.py'
    env = {key: value for key, value in os.environ.items()
           if key not in {'CLAUDE_WORKER', 'GIT_GUARDIAN_LIB', 'AUTONOMOUS'}}
    for command, cwd, expected in [
        ('find -x ~/Gits -delete', outside, 2),
        ('find -delete ~/Gits', outside, 2),
        ('rsync -a --del ~/Downloads/scratch/ ~/Gits/', outside, 2),
        ('mkdir -p ~/.claude/new-state; rm -r ~/.claude/new-state', outside, 2),
        ('rm -r ~/gits', outside, 2),
        ("find . -name '*.pyc' -delete", repo, 0),
        ('mv ~/.claude/settings.json.tmp ~/.claude/settings.json', repo, 0),
    ]:
        if 'gits' in command and not (home / 'gits').exists():
            continue
        result = subprocess.run([sys.executable, str(wrapper), str(copied / 'hooks/pre_tool_use.py')],
            cwd=cwd, env=env, input=json.dumps({'tool_name': 'Bash', 'tool_input': {'command': command},
                'cwd': str(cwd), 'session_id': 'synthetic-501-b'}), text=True, capture_output=True)
        assert result.returncode == expected, (result.returncode, result.stdout, result.stderr)
        assert result.stderr == ''
        if expected == 2:
            assert json.loads(result.stdout)['decision'] == 'block'
    assert (repo / '.git').is_dir() and (home / '.claude/settings.json.tmp').exists()


@pytest.mark.parametrize('command', [
    'mkdir -p ~/.claude/new-state; rm -r ~/.claude/new-state',
    'mkdir -p ~/.claude/new-state/child; rm -r ~/.claude/new-state',
    'mkdir -p ~/new-state; mv ~/new-state docs.local/moved',
    'mkdir -pm 700 ~/.claude/new-state; rm -r ~/.claude/new-state',
    'cd ~; mkdir -- -new-state; rm -r ./-new-state',
])
def test_created_protected_directory_keeps_directory_role(workspace, command):
    _, repo, _, _ = workspace
    assert guardian.dangerous_shell_reason(command, cwd=str(repo))


@pytest.mark.parametrize('command', [
    'mkdir -p docs.local/new-scratch; rm -r docs.local/new-scratch',
    'mkdir -p ~/new-state/cache; rm -r ~/new-state/cache',
])
def test_known_directory_creation_preserves_deep_cleanup(workspace, command):
    _, repo, _, _ = workspace
    assert guardian.dangerous_shell_reason(command, cwd=str(repo)) is None
