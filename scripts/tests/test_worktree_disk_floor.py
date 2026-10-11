"""Creation floor uses private fixtures and synthetic disk space, never real cleanup."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
from unittest import mock
import pytest

ROOT = Path(__file__).resolve().parents[2]
HELPER = ROOT / 'scripts/repogolem/worktree-disk-floor.py'


def helper():
    spec = importlib.util.spec_from_file_location('disk_floor', HELPER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize('free,allowed', [(14, False), (15, True), (16, True)])
def test_default_floor_boundary(tmp_path, monkeypatch, free, allowed):
    module = helper()
    monkeypatch.delenv('GOLEMS_WORKTREE_MIN_FREE_GB', raising=False)
    with mock.patch.object(module.shutil, 'disk_usage', return_value=mock.Mock(free=free*1024**3)):
        if allowed: module.check_space(tmp_path/'not-created')
        else:
            with pytest.raises(ValueError, match='15'): module.check_space(tmp_path/'not-created')
    assert not (tmp_path/'not-created').exists()


@pytest.mark.parametrize('value', ['garbage', '-1', 'nan', 'inf'])
def test_invalid_override_fails_closed(tmp_path, monkeypatch, value):
    monkeypatch.setenv('GOLEMS_WORKTREE_MIN_FREE_GB', value)
    with pytest.raises(ValueError): helper().check_space(tmp_path)


def test_zero_override_is_explicit(tmp_path, monkeypatch):
    module = helper()
    monkeypatch.setenv('GOLEMS_WORKTREE_MIN_FREE_GB', '0')
    with mock.patch.object(module.shutil, 'disk_usage', return_value=mock.Mock(free=0)):
        module.check_space(tmp_path)


def load_worktrees():
    sys.path.insert(0, str(ROOT/'skills/golem-powers/codex-workflows/scripts'))
    from codex_workflows_impl import worktrees
    return worktrees


def test_codex_creation_refuses_before_branch_or_directory(tmp_path, monkeypatch):
    module = load_worktrees()
    monkeypatch.setenv('GOLEMS_WORKTREE_MIN_FREE_GB', '99999999')
    worktree = tmp_path/'parent/lane'
    with mock.patch.object(module, '_run_git') as git, mock.patch.object(module, 'discover_default_branch'):
        with pytest.raises(module.CodexWorkflowError, match='worktree creation refused'):
            module.create_worker_worktree(repo=tmp_path, branch='fixture/lane', worktree=worktree)
    git.assert_not_called()
    assert not worktree.parent.exists()


@pytest.mark.parametrize('relative', [
    'scripts/ratchet/local-run.sh',
    'scripts/hooks/private-regression-gate.py',
    'scripts/hooks/install-hooks.mjs',
    'skills/golem-powers/skill-creator/scripts/live-eval-runner.sh',
])
def test_every_other_owned_creator_checks_floor(relative):
    text=(ROOT/relative).read_text()
    guard=text.index('worktree-disk-floor.py')
    if relative.endswith('.mjs'): add=text.index('mustGit(o.repo, "worktree", "add"')
    elif relative.endswith('.py'): add=text.index('git(repo, "worktree", "add"')
    else: add=text.index('git ', guard)
    assert guard < add


def test_desktop_machine_override_uses_50(tmp_path, monkeypatch):
    module = helper()
    monkeypatch.setenv('GOLEMS_WORKTREE_MIN_FREE_GB', '50')
    with mock.patch.object(module.shutil, 'disk_usage', return_value=mock.Mock(free=49*1024**3)):
        with pytest.raises(ValueError, match='50'): module.check_space(tmp_path)


def test_installed_eval_runner_refuses_before_any_git_add(tmp_path):
    import shutil
    home = tmp_path/'home'
    repo = home/'Gits/golems'
    repo.mkdir(parents=True)
    subprocess.run(['git','init','-q',str(repo)], check=True)
    subprocess.run(['git','-C',str(repo),'-c','user.name=Fixture','-c','user.email=fixture@localhost',
                    'commit','-q','--allow-empty','-m','fixture'], check=True)
    target = repo/'scripts/repogolem/worktree-disk-floor.py'
    target.parent.mkdir(parents=True)
    shutil.copy2(HELPER,target)
    script = ROOT/'skills/golem-powers/skill-creator/scripts/live-eval-runner.sh'
    env = dict(os.environ,HOME=str(home),GOLEMS_WORKTREE_MIN_FREE_GB='99999999')
    before = subprocess.check_output(['git','-C',str(repo),'branch','--list'],text=True)
    result = subprocess.run(['bash',str(script),'sandbox','--skill','fixture','--eval-id','1','--create'],
                            env=env,text=True,capture_output=True)
    assert result.returncode == 2
    assert 'worktree creation refused' in result.stderr
    assert subprocess.check_output(['git','-C',str(repo),'branch','--list'],text=True) == before
    assert not (home/'Gits/sandbox-eval-fixture-1').exists()
