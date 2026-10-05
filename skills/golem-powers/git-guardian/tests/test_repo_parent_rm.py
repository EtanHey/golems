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
    parent = home / 'Projects' / 'organization'
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
    parent = home / 'Projects' / 'organization'; repo = parent / 'project'
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


# Opus R1 regressions: command strings are policy input, never shell execution.
@pytest.mark.parametrize('command', [
    'rm -r ~/Gits', 'rm -R ~/Gits', 'rm --recursive ~/Gits',
    'rm -rd ~/Gits', 'rm -r --interactive=never ~/Gits',
    'rm -r ~/Gits/project',
])
def test_r2_recursive_without_force(workspace, command):
    home, repo, _, _ = workspace
    assert guardian.dangerous_shell_reason(command, cwd=str(repo), env={'HOME': str(home)})


def test_r2_parse_error_without_force(workspace):
    home, repo, _, _ = workspace
    assert guardian.is_dangerous_rm('rm -r ~/Gits "', cwd=str(repo), env={'HOME': str(home)})[0]


@pytest.mark.parametrize('target', [
    'Documents', 'Desktop', 'conductor', '.claude', '.codex', '.cmux',
    '.config', '.ssh', 'Library', '.claude/hooks', '.claude/skills',
    '.codex/skills', '.cmux/agents', '.config/tool', '.ssh/keys',
    'Library/Application Support', '.CLAUDE/Hooks', 'library/caches',
])
def test_r2_home_and_agent_roots(workspace, target):
    home, repo, _, _ = workspace
    assert guardian.dangerous_shell_reason(f'rm -r "{home}/{target}"', cwd=str(repo))


@pytest.mark.parametrize('command', [
    'rm -rf docs.local/scratch', 'rm -rf .worktrees/x/build',
    'rm -rf packages/shared/node_modules', 'rm -rf ~/Downloads/scratch',
    'rm -rf ~/.cache/pip', 'rm -rf ~/Library/Caches/tool',
    'rm -rf ~/.claude/hooks/__pycache__', 'unlink ~/Gits',
])
def test_r2_deep_cleanup_controls(workspace, command):
    home, repo, _, _ = workspace
    assert guardian.dangerous_shell_reason(command, cwd=str(repo), env={'HOME': str(home)}) is None


@pytest.mark.parametrize('depth', [1, 2, 3])
def test_r2_nested_container_probe(workspace, depth):
    home, _, _, outside = workspace
    target = home / 'Gits' / 'organization'
    (target.joinpath(*(['group'] * (depth - 1)), 'child', '.git')).mkdir(parents=True)
    assert guardian.dangerous_shell_reason(f'rm -r "{target}"', cwd=str(outside))


def test_r2_container_probe_limits(workspace, monkeypatch):
    home, _, _, outside = workspace
    target = home / 'Gits' / 'organization'; target.mkdir()
    real_scandir = os.scandir
    def limited(path):
        if str(path) == str(target):
            raise PermissionError('synthetic inaccessible directory')
        return real_scandir(path)
    monkeypatch.setattr(os, 'scandir', limited)
    assert guardian.dangerous_shell_reason(f'rm -r "{target}"', cwd=str(outside))


def test_r2_container_probe_entry_cap(workspace):
    home, _, _, outside = workspace
    target = home / 'Gits' / 'organization'; target.mkdir()
    for index in range(5001):
        (target / f'entry-{index}').touch()
    assert guardian.dangerous_shell_reason(f'rm -r "{target}"', cwd=str(outside))


@pytest.mark.parametrize('template', [
    'cd ~ && rm -rf ~+/Gits',
    'cd ~/Gits && cd "{outside}" && rm -rf ~-',
    'HOME="{parent}"; rm -rf ~/owner/Gits',
    'export HOME="{parent}"; rm -rf ~/owner/Gits',
    'HOME=/; rm -rf ~{home}/Gits',
    'rm -rf ~unresolvable/Gits',
])
def test_r2_tracked_tilde(workspace, template):
    home, repo, _, outside = workspace
    command = template.format(home=home, parent=home.parent, outside=outside)
    assert guardian.dangerous_shell_reason(command, cwd=str(repo), env={'HOME': str(home)})


@pytest.mark.parametrize('command', [
    'ln -s ~/Gits ~/Downloads/g && rm -rf ~/Downloads/g/',
    'cd ~/Downloads && ln -s ~/Gits g && rm -rf g/',
    'mv ~/Gits ~/Downloads/g && rm -rf ~/Downloads/g',
    'mv ~/.claude ~/Downloads/c',
    'cp -R ~/Downloads/scratch ~/Downloads/g && rm -rf ~/Downloads/g',
    'ln -s ~/Downloads/scratch ~/Downloads/g && rm -rf ~/Downloads/g/',
])
def test_r2_same_command_path_creation(workspace, command):
    home, repo, _, _ = workspace
    assert guardian.dangerous_shell_reason(command, cwd=str(repo), env={'HOME': str(home)})


@pytest.mark.parametrize('command', [
    'H=$(echo ~); rm -rf "$H/Gits"',
    'H=$(dirname ~/x); rm -rf "$H"/Gits',
    'read -r H <<< ~; rm -rf "$H/Gits"',
    'printf -v H %s ~; rm -rf "$H/Gits"',
    'for H in ~; do rm -rf "$H/Gits"; done',
    'rm -rf "$UNSET_Y"/GiTs',
    'H=$(echo ~); rm -rf "$H/Documents"',
    'export H=$(echo ~); rm -rf "$H/scratch"',
])
def test_r2_unknown_assignment_tail(workspace, command):
    home, repo, _, _ = workspace
    assert guardian.dangerous_shell_reason(command, cwd=str(repo), env={'HOME': str(home)})


@pytest.mark.parametrize('wrapper', [
    'timeout 5', 'gtimeout -s TERM 5', 'caffeinate', 'caffeinate -t 5',
    'exec -a foo', 'arch -arm64', 'stdbuf -o0', 'script -q /dev/null',
    'flock /dev/null', 'doas',
])
def test_r2_wrappers(workspace, wrapper):
    home, repo, _, _ = workspace
    assert guardian.dangerous_shell_reason(f'{wrapper} rm -r ~/Gits', cwd=str(repo))
    assert guardian.dangerous_shell_reason(f'{wrapper} rm -r docs.local/scratch', cwd=str(repo)) is None


@pytest.mark.parametrize('command', [
    'find ~/Gits -delete', 'find ~/Gits -mindepth 1 -delete',
    'find ~/.claude ~/Documents -delete', 'find -H ~/Gits -delete',
    'rsync -a --delete ~/Downloads/scratch/ ~/Gits/',
    'rsync --delete-before -a ~/Downloads/scratch/ ~/.claude/',
    'rsync -a --delete -- ~/Downloads/scratch/ ~/Documents/',
])
def test_r2_other_delete_tools(workspace, command):
    home, repo, _, _ = workspace
    assert guardian.dangerous_shell_reason(command, cwd=str(repo))


@pytest.mark.parametrize('command', [
    'find docs.local/scratch -delete',
    'find . -name __pycache__ -type d -prune -exec rm -r {} +',
    'rsync -a --delete ~/Downloads/scratch/ docs.local/scratch/',
    'rsync -a --delete docs.local/scratch/ remote:~/Gits/',
])
def test_r2_other_delete_controls(workspace, command):
    home, repo, _, _ = workspace
    assert guardian.dangerous_shell_reason(command, cwd=str(repo)) is None


def test_r2_samefile_oserror_does_not_escape(workspace, monkeypatch):
    home, repo, _, outside = workspace
    def inaccessible(*args):
        raise OSError('synthetic ELOOP')
    monkeypatch.setattr(os.path, 'samefile', inaccessible)
    assert guardian.dangerous_shell_reason(f'rm -rf "{outside}"', cwd=str(repo)) is None


def test_r2_symlinked_container_physical_parent(tmp_path, monkeypatch):
    home = tmp_path / 'owner'; home.mkdir(); monkeypatch.setenv('HOME', str(home))
    store = tmp_path / 'store'
    container = store / 'Gits'; container.mkdir(parents=True)
    (home / 'Gits').symlink_to(container, target_is_directory=True)
    assert guardian.dangerous_shell_reason(f'rm -rf "{store}"', cwd=str(home))


@pytest.mark.parametrize('command', [
    'ln -s ~/Gits ~/Downloads/g',
    'ln -s ~/Downloads/scratch ~/Downloads/g && rm -rf docs.local/scratch',
    'mv docs.local/../docs.local/scratch docs.local/moved',
    'rm --interactive=never ~/Gits',
])
def test_r2_link_and_move_controls(workspace, command):
    home, repo, _, _ = workspace
    assert guardian.dangerous_shell_reason(command, cwd=str(repo)) is None


@pytest.mark.parametrize('command', [
    'rm -r ~/Gits', 'rm -rf ~/.claude/hooks',
    'timeout 5 rm -r ~/Gits', 'find ~/Gits -delete',
    'rsync -a --delete ~/Downloads/scratch/ ~/Gits/',
    'ln -s ~/Gits ~/Downloads/g && rm -rf ~/Downloads/g/',
    'HOME=/; rm -rf ~{home}/Gits',
    "rm -rf '>' ~/Gits",
    r'rm -rf \> ~/Gits',
    "rsync --delete ~/Downloads/scratch/ '>' ~/Gits/",
    'true && H=$(echo ~); rm -rf "$H/Documents"',
    'if true; then H=$(echo ~); fi; rm -rf "$H/Documents"',
])
def test_r2_real_hook_boundary(workspace, command):
    home, repo, _, _ = workspace
    env = {key: value for key, value in os.environ.items()
           if key not in {'CLAUDE_WORKER', 'AUTONOMOUS', 'GIT_GUARDIAN_LIB'}}
    env.update(HOME=str(home), GIT_GUARDIAN_LIB=str(SKILL))
    result = subprocess.run([sys.executable, str(ROOT / 'scripts/hooks/fail-open.py'),
                             str(SKILL / 'hooks/pre_tool_use.py')],
        cwd=repo, env=env, text=True, capture_output=True,
        input=json.dumps({'tool_name': 'Bash', 'tool_input': {'command': command.format(home=home)},
                          'session_id': 'synthetic-501-r2'}))
    assert result.returncode == 2, (command, result.stdout, result.stderr)
    assert result.stderr == ''
    assert json.loads(result.stdout)['decision'] == 'block'
    assert (repo / '.git').is_dir()

@pytest.mark.parametrize('command', [
    'mv -t ~/Downloads/g ~/Gits',
    'mv --target-directory=~/Downloads/g ~/.claude',
    'ln -s -t ~/Downloads/g ~/Gits && rm -rf ~/Downloads/g/',
    'ln -s ~/Gits ~/Downloads/g >/dev/null && rm -rf ~/Downloads/g/',
    'rsync --delete ~/Downloads/scratch/ ~/Gits/ >/dev/null',
    'rsync --delete ~/Downloads/scratch/ ~/Gits/ > docs.local/log',
])
def test_r2_destination_options_and_redirections(workspace, command):
    home, repo, _, _ = workspace
    assert guardian.dangerous_shell_reason(command, cwd=str(repo))


def test_r2_config_physical_alias(workspace, tmp_path):
    home, repo, _, _ = workspace
    config = tmp_path / 'physical' / 'agent'; (config / 'hooks').mkdir(parents=True)
    (home / '.claude').symlink_to(config, target_is_directory=True)
    assert guardian.dangerous_shell_reason(f'rm -r "{config}/hooks"', cwd=str(repo))

@pytest.mark.parametrize('command', [
    'cd ~/Downloads && ln -s ~/Gits && rm -rf Gits/',
    'mv -t~/Downloads/g ~/Gits',
])
def test_r2_implicit_link_and_attached_destination(workspace, command):
    home, repo, _, _ = workspace
    assert guardian.dangerous_shell_reason(command, cwd=str(repo))


# Fresh scan regressions for shell operands and uncertain assignments.
@pytest.mark.parametrize('command', [
    "rm -rf '>' ~/Gits",
    "rm -rf '2>' ~/Gits",
    r'rm -rf \> ~/Gits',
    "rsync --delete ~/Downloads/scratch/ '>' ~/Gits/",
    'true && H=$(echo ~); rm -rf "$H/Documents"',
    'false || H=$(echo ~); rm -rf "$H/Documents"',
    'if true; then H=$(echo ~); fi; rm -rf "$H/Documents"',
    'H=~/Downloads/scratch; true && H=$(echo ~); rm -rf "$H/Documents"',
    'rm -rf docs.local/scratch >/dev/null; rm -rf ~/Gits',
])
def test_r2_scan_parser_regressions(workspace, command):
    home, repo, _, _ = workspace
    assert guardian.dangerous_shell_reason(command, cwd=str(repo))


@pytest.mark.parametrize('command', [
    'rm -rf docs.local/scratch > docs.local/result',
    'rm -rf docs.local/scratch 2>docs.local/result',
    'rm -rf docs.local/scratch >"docs.local/log spaced"',
    'rm -rf docs.local/scratch >$(echo docs.local/log)',
    'rm -rf docs.local/scratch >"docs.local/$(echo log)"',
    'rm -rf docs.local/scratch >docs.local/log && rm -rf docs.local/other',
    'rsync --delete ~/Downloads/scratch/ docs.local/scratch/ > docs.local/log',
    "rsync --delete ~/Downloads/scratch/ docs.local/scratch/ >'docs.local/log spaced'",
    "echo 'rm -rf > ~/Gits'",
])
def test_r2_scan_redirection_cleanup_controls(workspace, command):
    home, repo, _, _ = workspace
    assert guardian.dangerous_shell_reason(command, cwd=str(repo)) is None


@pytest.mark.parametrize('command', [
    'find -L ~/Downloads/g -delete',
    'find -H ~/Downloads/g -delete',
    'find ~/Downloads/g -follow -delete',
    'rsync -a --delete ~/Downloads/scratch/ ~/Downloads/g',
])
def test_r2_followed_delete_alias(workspace, command):
    home, repo, _, _ = workspace
    (home / 'Downloads/g').symlink_to(home / 'Gits', target_is_directory=True)
    assert guardian.dangerous_shell_reason(command, cwd=str(repo))
    env = {key: value for key, value in os.environ.items()
           if key not in {'CLAUDE_WORKER', 'AUTONOMOUS', 'GIT_GUARDIAN_LIB'}}
    env.update(HOME=str(home), GIT_GUARDIAN_LIB=str(SKILL))
    result = subprocess.run([sys.executable, str(ROOT / 'scripts/hooks/fail-open.py'),
                             str(SKILL / 'hooks/pre_tool_use.py')],
        cwd=repo, env=env, text=True, capture_output=True,
        input=json.dumps({'tool_name': 'Bash', 'tool_input': {'command': command},
                          'session_id': 'synthetic-501-followed-alias'}))
    assert result.returncode == 2, (command, result.stdout, result.stderr)
    assert result.stderr == ''
    assert json.loads(result.stdout)['decision'] == 'block'
    assert (repo / '.git').is_dir()


@pytest.mark.parametrize('command', [
    'rm -rf ~/Downloads/g', 'find ~/Downloads/g -delete',
    'find -P ~/Downloads/g -delete', 'find -L -P ~/Downloads/g -delete',
    'find -L ~/Downloads/s -delete',
    'rsync -a --delete ~/Downloads/scratch/ ~/Downloads/s',
])
def test_r2_delete_alias_controls(workspace, command):
    home, repo, _, scratch = workspace
    (home / 'Downloads/g').symlink_to(home / 'Gits', target_is_directory=True)
    (home / 'Downloads/s').symlink_to(scratch, target_is_directory=True)
    assert guardian.dangerous_shell_reason(command, cwd=str(repo)) is None


@pytest.mark.parametrize('command', [
    'ln -s ~/Gits ~/Downloads/new && find -L ~/Downloads/new -delete',
    'ln -s ~/Gits ~/Downloads/new && rsync -a --delete ~/Downloads/scratch/ ~/Downloads/new',
])
def test_r2_created_alias_delete_tools(workspace, command):
    home, repo, _, _ = workspace
    assert not (home / 'Downloads/new').exists()
    assert guardian.dangerous_shell_reason(command, cwd=str(repo))
