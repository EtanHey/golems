"""Real Git and both hook transports; rm strings are evaluated, never executed."""
import json
import importlib.util
import os
from pathlib import Path
import shlex
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[5]
HOOK = ROOT / 'skills/golem-powers/git-guardian/hooks/pre_tool_use.py'
ADAPTER = ROOT / 'scripts/hooks/codex-policy-hook.py'
MODES = ['claude-relative', 'claude-absolute', 'codex-relative', 'codex-absolute']


def git(repo, *args):
    return subprocess.run(['/usr/bin/git', '-C', str(repo), *args], check=True,
                          capture_output=True, text=True)


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    for name in list(os.environ):
        if name.startswith('GIT_') or name == 'CLAUDE_WORKER':
            monkeypatch.delenv(name)
    home = tmp_path / 'home'
    repo = home / 'Gits/project'
    repo.mkdir(parents=True)
    monkeypatch.setenv('HOME', str(home))
    git(repo, 'init', '-q')
    (repo / '.gitignore').write_text(
        '.build.noindex/\nmixed/\n.build-link/\nnested/\n'
        'docs.local/\n.worktrees/\n.env.d/\nscratch/\nnode_modules/\n')
    for name in ['.build.noindex', 'mixed', 'src', 'untracked']:
        (repo / name).mkdir()
        (repo / name / 'file').write_text('fixture')
    git(repo, 'add', '.gitignore', 'src/file')
    git(repo, 'add', '-f', 'mixed/file')
    git(repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com',
        'commit', '-qm', 'fixture')
    outside = home / 'other'
    outside.mkdir()
    (repo / '.build-link').symlink_to(outside, target_is_directory=True)
    return repo, outside


def verdict(workspace, mode, command):
    repo, outside = workspace
    if mode.endswith('absolute'):
        command = command.replace('@', shlex.quote(str(repo)))
    else:
        command = command.replace('@/', '').replace('@', '.')
    codex = mode.startswith('codex')
    # Claude uses process cwd; Codex must honor payload cwd even from elsewhere.
    cwd = repo if mode == 'claude-relative' else outside
    payload_cwd = repo if mode == 'codex-relative' else cwd
    data = {'tool_name': 'Bash', 'tool_input': {'command': command},
            'cwd': str(payload_cwd), 'session_id': 'ignored-rm-fixture',
            'hook_event_name': 'PreToolUse'}
    proc = subprocess.run([sys.executable, str(ADAPTER if codex else HOOK),
                           *(['git-guardian'] if codex else [])],
                          input=json.dumps(data), text=True, capture_output=True,
                          cwd=cwd, timeout=8)
    assert proc.stderr == '', proc.stderr
    result = json.loads(proc.stdout)
    if codex:
        assert proc.returncode == 0, result
        return result.get('hookSpecificOutput', {}).get('permissionDecision') == 'deny'
    assert proc.returncode in (0, 2), result
    return proc.returncode == 2


@pytest.mark.parametrize('mode', MODES)
def test_ignored_directory_allows(workspace, mode):
    assert not verdict(workspace, mode, 'rm -rf @/.build.noindex')
    assert (workspace[0] / '.build.noindex/file').is_file()


@pytest.mark.parametrize('mode', MODES)
def test_ignored_directory_in_linked_worktree_allows(workspace, mode):
    repo, outside = workspace
    linked = outside / 'worktree'
    git(repo, 'worktree', 'add', '--detach', str(linked), 'HEAD')
    (linked / '.build.noindex').mkdir()
    (linked / '.build.noindex/file').write_text('fixture')
    assert not verdict((linked, outside), mode, 'rm -rf @/.build.noindex')


@pytest.mark.parametrize('mode', MODES)
@pytest.mark.parametrize('command', [
    'rm -rf @/src', 'rm -rf @/mixed', 'rm -rf @/untracked',
    'rm -rf @/.git', 'rm -rf @/.build-link', 'rm -rf @',
    'rm -rf @/.build.noindex @/src', 'rm -rf @/.build.noindex/*',
    'rm -rf @/.build.noindex/missing/..',
    'for d in .build.noindex; do rm -rf @/$d; done',
    'for d in .build.noindex; do rm -rf @/.build.noindex; done',
    'while true; do rm -rf @/.build.noindex; done',
    'until false; do rm -rf @/.build.noindex; done',
    'find @/.build.noindex -delete', 'rsync -a --delete @/src/ @/.build.noindex/',
])
def test_existing_denials_remain(workspace, mode, command):
    assert verdict(workspace, mode, command), command


@pytest.mark.parametrize('mode', MODES)
def test_ignored_nested_repo_still_denies(workspace, mode):
    nested = workspace[0] / 'nested'
    nested.mkdir()
    git(nested, 'init', '-q')
    assert verdict(workspace, mode, 'rm -rf @/nested')


@pytest.mark.parametrize('phase', [1, 2, 3, 4])
@pytest.mark.parametrize('failure', ['error', 'timeout', 'unavailable'])
def test_git_inspection_uncertainty_keeps_original_reason(workspace, monkeypatch, phase, failure):
    spec = importlib.util.spec_from_file_location('ignored_rm_policy', HOOK.parents[1] / 'git_safety.py')
    policy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(policy)
    real_run = subprocess.run
    calls = []

    def inspect(argv, **kwargs):
        calls.append(argv)
        if len(calls) == phase:
            if failure == 'timeout':
                raise subprocess.TimeoutExpired(argv, kwargs['timeout'])
            if failure == 'unavailable':
                raise FileNotFoundError('fixture: unavailable git')
            return subprocess.CompletedProcess(argv, 128, b'', b'fixture: git error')
        return real_run(argv, **kwargs)

    monkeypatch.setattr(policy._paths.subprocess, 'run', inspect)
    reason = policy.dangerous_shell_reason('rm -rf .build.noindex', cwd=str(workspace[0]))
    assert reason == 'rm target too broad within repo (1 path components): .build.noindex'
    assert len(calls) == phase


@pytest.mark.parametrize('mode', MODES)
def test_alternate_empty_index_cannot_hide_tracked_files(workspace, monkeypatch, mode):
    monkeypatch.setenv('GIT_INDEX_FILE', str(workspace[1] / 'empty-index'))
    assert verdict(workspace, mode, 'rm -rf @/mixed')


@pytest.mark.parametrize('mode', MODES)
def test_ignored_submodule_still_denies(workspace, mode):
    repo, _ = workspace
    module = repo / 'nested'
    metadata = repo / '.git/modules/nested'
    metadata.parent.mkdir()
    git(repo, 'init', '-q', '--separate-git-dir', str(metadata), str(module))
    git(repo, 'update-index', '--add', '--cacheinfo',
        '160000,' + git(repo, 'rev-parse', 'HEAD').stdout.strip() + ',nested')
    assert verdict(workspace, mode, 'rm -rf @/nested')


@pytest.mark.parametrize('mode', MODES)
@pytest.mark.parametrize('name', ['docs.local', '.env.d', 'scratch'])
def test_r1_nonregenerable_ignored_denies(workspace, mode, name):
    target = workspace[0] / name
    target.mkdir()
    (target / 'irreplaceable').write_text('fixture')
    denied = verdict(workspace, mode, 'rm -rf @/' + name)
    # .env.d already hits the hook's independent secrets rule. Also assert
    # the shared rm policy, so that layer cannot mask this regression.
    spec = importlib.util.spec_from_file_location('r1_rm_policy', HOOK.parents[1] / 'git_safety.py')
    policy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(policy)
    reason = policy.dangerous_shell_reason('rm -rf ' + name, cwd=str(workspace[0]))
    assert denied and reason
    assert (target / 'irreplaceable').is_file()


@pytest.mark.parametrize('mode', MODES)
@pytest.mark.parametrize('name', ['.worktrees', 'node_modules'])
def test_r1_nested_worktree_denies(workspace, mode, name):
    repo, _ = workspace
    target = repo / name
    target.mkdir()
    # -z porcelain must preserve spaces, quotes and newlines in registry paths.
    linked = target / 'wip space\n"quote'
    git(repo, 'worktree', 'add', '--detach', str(linked), 'HEAD')
    (linked / 'uncommitted').write_text('fixture: must survive')
    assert verdict(workspace, mode, 'rm -rf @/' + name)
    assert (linked / 'uncommitted').is_file()


@pytest.mark.parametrize('mode', MODES)
def test_r1_build_output_stays_allowed(workspace, mode):
    assert not verdict(workspace, mode, 'rm -rf @/.build.noindex')


@pytest.mark.parametrize('mode', MODES)
@pytest.mark.parametrize('name', [
    '.build', '.build.noindex', 'build', 'dist', 'node_modules', '.next',
    '.turbo', '.parcel-cache', 'DerivedData', 'target', '__pycache__',
    '.pytest_cache', '.mypy_cache', '.ruff_cache', '.gradle', 'coverage',
])
def test_each_named_build_output_allows_when_ignored(workspace, mode, name):
    repo, _ = workspace
    (repo / name).mkdir(exist_ok=True)
    (repo / name / 'file').write_text('fixture')
    with (repo / '.gitignore').open('a') as stream:
        stream.write(name + '/\n')
    assert not verdict(workspace, mode, 'rm -rf @/' + name)


@pytest.mark.parametrize('mode', MODES)
@pytest.mark.parametrize('name', ['BUILD', '.BUILD.NOINDEX', 'Node_Modules', 'dist-old'])
def test_build_allowlist_is_exact_and_case_sensitive(workspace, mode, name):
    repo, _ = workspace
    (repo / name).mkdir(exist_ok=True)
    with (repo / '.gitignore').open('a') as stream:
        stream.write(name + '/\n')
    assert verdict(workspace, mode, 'rm -rf @/' + name)


@pytest.mark.parametrize('mode', MODES)
@pytest.mark.parametrize('alternate_index', [False, True])
def test_allowlisted_tracked_files_deny_with_real_or_redirected_index(workspace, monkeypatch, mode, alternate_index):
    repo, outside = workspace
    git(repo, 'add', '-f', '.build.noindex/file')
    if alternate_index:
        monkeypatch.setenv('GIT_INDEX_FILE', str(outside / 'empty-index'))
    assert verdict(workspace, mode, 'rm -rf @/.build.noindex')


@pytest.mark.parametrize('mode', MODES)
def test_allowlisted_symlink_denies(workspace, mode):
    repo, outside = workspace
    (repo / 'node_modules').symlink_to(outside, target_is_directory=True)
    assert verdict(workspace, mode, 'rm -rf @/node_modules')


@pytest.mark.parametrize('mode', MODES)
def test_allowlisted_nested_repo_denies(workspace, mode):
    repo, _ = workspace
    (repo / 'node_modules').mkdir()
    git(repo / 'node_modules', 'init', '-q')
    assert verdict(workspace, mode, 'rm -rf @/node_modules')


@pytest.mark.parametrize('mode', MODES)
def test_nested_worktree_case_alias_denies(workspace, mode):
    repo, _ = workspace
    target = repo / 'NODE_MODULES'
    target.mkdir()
    if not (repo / 'node_modules').is_dir():
        pytest.skip('fixture filesystem is case-sensitive')
    linked = target / 'wip'
    git(repo, 'worktree', 'add', '--detach', str(linked), 'HEAD')
    (linked / 'uncommitted').write_text('fixture: must survive')
    assert verdict(workspace, mode, 'rm -rf @/node_modules')
