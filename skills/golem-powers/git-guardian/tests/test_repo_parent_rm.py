"""#501 real rm argv coverage; never execute the destructive fixture commands."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest

SKILL = Path(__file__).resolve().parents[1]
ROOT = SKILL.parents[2]
spec = importlib.util.spec_from_file_location('guardian_501', SKILL / 'git_safety.py')
guardian = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guardian)

@pytest.fixture
def workspace(tmp_path, monkeypatch):
    home = tmp_path / 'owner'
    repo = home / 'Gits' / 'project'
    (repo / '.git').mkdir(parents=True)
    deep = repo / 'docs.local' / 'scratch'
    deep.mkdir(parents=True)
    unrelated = home / 'Downloads' / 'scratch'
    unrelated.mkdir(parents=True)
    monkeypatch.setenv('HOME', str(home))
    return home, repo, deep, unrelated

@pytest.mark.parametrize('command', [
    'rm -rf ~/Gits', 'rm -rf "$HOME/Gits"', 'rm --recursive --force ~/Gits/',
    'command rm -fr ~/Gits', 'sudo rm -rf ~/Gits', 'env rm -rf ~/Gits',
    'bash -c "rm -rf ~/Gits"', 'eval "rm -rf ~/Gits"',
    'TARGET="$HOME/Gits"; rm -rf "$TARGET"',
    'cd "$HOME/Downloads/scratch" && rm -rf ~/Gits',
])
def test_standard_repo_container_denies(workspace, command):
    home, repo, _deep, _unrelated = workspace
    reason = guardian.dangerous_shell_reason(command, cwd=str(repo), env={'HOME': str(home)})
    assert reason and 'repo' in reason, (command, reason)

@pytest.mark.parametrize('cwd_name', ['repo', 'outside'])
def test_container_is_protected_without_repo_cwd(workspace, cwd_name):
    home, repo, _deep, unrelated = workspace
    cwd = repo if cwd_name == 'repo' else unrelated
    assert guardian.dangerous_shell_reason('rm -rf ~/Gits', cwd=str(cwd), env={'HOME': str(home)})

@pytest.mark.parametrize('form', ['absolute', 'variable', 'symlink', 'cd-away'])
def test_nonstandard_active_repo_ancestor_denies(tmp_path, monkeypatch, form):
    home = tmp_path / 'owner'; home.mkdir()
    monkeypatch.setenv('HOME', str(home))
    parent = tmp_path / 'projects' / 'organization'
    repo = parent / 'project'
    (repo / '.git').mkdir(parents=True)
    alias = tmp_path / 'repo-parent-link'; alias.symlink_to(parent, target_is_directory=True)
    commands = {'absolute': f'rm -rf "{parent}"', 'variable': f'TARGET="{parent}"; rm -rf "$TARGET"',
                'symlink': f'rm -rf "{alias}/"', 'cd-away': f'cd "{home}" && rm -rf "{parent}"'}
    reason = guardian.dangerous_shell_reason(commands[form], cwd=str(repo), env={'HOME': str(home)})
    assert reason and 'repo' in reason, (form, reason)

@pytest.mark.parametrize('command', [
    'rm -rf docs.local/scratch', 'rm -rf "$HOME/Downloads/scratch"',
    'rm -rf "$UNKNOWN/mergetest"', 'rm ~/Gits', 'rm -f ~/Gits',
    "echo 'rm -rf ~/Gits'", "grep -n 'rm -rf ~/Gits' notes.md",
    'cat >> notes.md <<\'EOF\'\nrm -rf ~/Gits\nEOF',
])
def test_safe_controls_allow(workspace, command):
    home, repo, _deep, _unrelated = workspace
    assert guardian.dangerous_shell_reason(command, cwd=str(repo), env={'HOME': str(home)}) is None, command

def test_similarly_named_container_is_not_a_path_prefix_match(workspace):
    home, repo, _deep, _unrelated = workspace
    assert guardian.dangerous_shell_reason('rm -rf "$HOME/Gits-old/cache"', cwd=str(repo), env={'HOME': str(home)}) is None

@pytest.mark.parametrize('wrapper', ['sudo', 'command', 'builtin', 'nohup', 'exec', 'env', 'time', 'nice', 'bash'])
def test_original_repo_anchor_survives_cd_then_wrappers(tmp_path, monkeypatch, wrapper):
    home = tmp_path / 'owner'; home.mkdir(); monkeypatch.setenv('HOME', str(home))
    parent = tmp_path / 'projects' / 'organization'; repo = parent / 'project'
    (repo / '.git').mkdir(parents=True)
    nested = f'rm -rf "{parent}"'
    wrapped = f"bash -c '{nested}'" if wrapper == 'bash' else f'{wrapper} {nested}'
    command = f'cd "{home}" && {wrapped}'
    blocked, reason = guardian.is_dangerous_rm(command, cwd=str(repo), env={'HOME': str(home)})
    assert blocked and 'repo' in reason, (wrapper, reason)

def test_removing_a_parent_symlink_itself_is_safe(workspace, tmp_path):
    home, repo, _deep, _unrelated = workspace
    alias = tmp_path / 'parent-link'; alias.symlink_to(home / 'Gits', target_is_directory=True)
    assert guardian.dangerous_shell_reason(f'rm -rf "{alias}"', cwd=str(repo), env={'HOME': str(home)}) is None
    assert guardian.dangerous_shell_reason(f'rm -rf "{alias}/"', cwd=str(repo), env={'HOME': str(home)})

def test_case_aliases_match_directory_identity(workspace):
    home, repo, _deep, _unrelated = workspace
    alias = home / 'gits'
    if not alias.exists():
        pytest.skip('fixture filesystem is case-sensitive')
    assert os.path.samefile(alias, home / 'Gits')
    assert guardian.dangerous_shell_reason('rm -rf ~/gits', cwd=str(repo), env={'HOME': str(home)})

def test_sanctioned_harness_fixture_ancestor_remains_disposable(tmp_path, monkeypatch):
    home = tmp_path / 'owner'; home.mkdir(); monkeypatch.setenv('HOME', str(home))
    monkeypatch.setenv('TMPDIR', str(tmp_path))
    pad = tmp_path / 'claude-501' / 'synthetic-repo' / '12345678-1234-1234-1234-123456789abc' / 'scratchpad'
    repo = pad / 'fixture'; (repo / '.git').mkdir(parents=True)
    assert guardian.dangerous_shell_reason(f'rm -rf "{pad}"', cwd=str(repo), env={'HOME': str(home)}) is None

def test_actual_copied_hook_blocks_exact_specimen_and_preserves_cleanup(workspace, tmp_path):
    home, repo, _deep, _unrelated = workspace
    copied = tmp_path / 'installed' / 'git-guardian'
    shutil.copytree(SKILL, copied, ignore=shutil.ignore_patterns('__pycache__'))
    shutil.copytree(SKILL.parent / '_shared', copied.parent / '_shared', ignore=shutil.ignore_patterns('__pycache__'))
    wrapper = tmp_path / 'golems-fail-open.py'
    shutil.copyfile(ROOT / 'scripts/hooks/fail-open.py', wrapper)
    env = {key: value for key, value in os.environ.items() if key not in {'CLAUDE_WORKER', 'GIT_GUARDIAN_LIB', 'AUTONOMOUS'}}
    env['HOME'] = str(home)
    for command, expected in [('rm -rf ~/Gits', 2), ('rm -rf docs.local/scratch', 0), ("echo 'rm -rf ~/Gits'", 0)]:
        result = subprocess.run([sys.executable, str(wrapper), str(copied / 'hooks/pre_tool_use.py')],
            cwd=repo, env=env, text=True, input=json.dumps({'tool_name':'Bash','tool_input':{'command':command},'cwd':str(repo),'session_id':'synthetic-501'}), capture_output=True)
        assert result.returncode == expected, (command, result.stdout, result.stderr)
        assert result.stderr == ''
        output = json.loads(result.stdout)
        if expected == 2: assert output['decision'] == 'block' and 'repo' in output['reason']
    assert (repo / '.git').is_dir() and (repo / 'docs.local/scratch').is_dir()
