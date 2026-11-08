"""Run the real sandbox CLI against disposable Git worktrees and a local remote."""
import json
import os
from pathlib import Path
import subprocess

import pytest

RUNNER = Path(__file__).parents[1] / "scripts/live-eval-runner.sh"


@pytest.fixture
def sandbox(tmp_path):
    repo = tmp_path / "Gits/golems"
    repo.mkdir(parents=True)

    def git(*args, cwd=repo, check=True):
        return subprocess.run(["git", "-C", str(cwd), *map(str, args)],
                              capture_output=True, text=True, check=check)

    git("init", "-qb", "master")
    git("config", "user.name", "Fixture")
    git("config", "user.email", "fixture@example.com")
    (repo / "tracked").write_text("original\n")
    (repo / ".gitignore").write_text("ignored\ndocs.local/\n")
    floor = repo / "scripts/repogolem/worktree-disk-floor.py"
    floor.parent.mkdir(parents=True)
    floor.write_bytes((Path(__file__).parents[4] / "scripts/repogolem/worktree-disk-floor.py").read_bytes())
    git("add", ".")
    git("-c", "core.hooksPath=/dev/null", "commit", "-qm", "fixture")
    git("init", "--bare", "-q", tmp_path / "remote.git")
    git("remote", "add", "origin", tmp_path / "remote.git")
    git("push", "-q", "origin", "master")
    git("remote", "set-head", "origin", "master")
    branch = "sandbox-eval-fixture-1"
    path = repo.parent / branch
    def run(action, cwd=repo):
        return subprocess.run(["bash", str(RUNNER), "sandbox", "--skill", "fixture", "--eval-id", "1", action],
                              cwd=cwd, env={**os.environ, "HOME": str(tmp_path), "GOLEMS_WORKTREE_MIN_FREE_GB": "0"},
                              capture_output=True, text=True)
    assert run("--create").returncode == 0
    return repo, path, branch, git, tmp_path, run


@pytest.mark.parametrize("state", ["clean", "tracked", "untracked", "ignored", "unmerged", "locked", "foreign", "hidden", "hidden-large", "offline", "self"])
def test_cleanup_is_truthful_and_preserves_work(sandbox, state):
    repo, path, branch, git, home, run = sandbox
    if state in {"tracked", "untracked", "ignored"}:
        (path / state).write_text("preserve me\n")
    elif state == "unmerged":
        git("-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "-qm", "local work", cwd=path)
    elif state == "locked":
        # Real Git removal must fail; an old success receipt must not rescue it.
        git("worktree", "lock", "--reason", "fixture removal failure", path)
        (repo / "docs.local").mkdir()
        (repo / "docs.local/cleanup-receipt.json").write_text(json.dumps({"disposition": "REMOVED", "remove_rc": 0}))
    elif state == "foreign":
        git("worktree", "remove", path)
        path.mkdir()
        (path / "untracked").write_text("foreign work\n")
    elif state in {"hidden", "hidden-large"}:
        if state == "hidden-large":
            for i in range(6000):
                (path / f"zz_{i:05d}_padding_for_large_index_output").touch()
            git("add", ".", cwd=path)
            git("-c", "core.hooksPath=/dev/null", "commit", "-qm", "large index", cwd=path)
            git("push", "-q", "origin", "HEAD:master", cwd=path)
            assert len(git("ls-files", "-v", cwd=path).stdout) > 200_000
        git("update-index", "--assume-unchanged", "tracked", cwd=path)
        (path / "tracked").write_text("hidden work\n")
    elif state == "offline":
        git("remote", "set-url", "origin", home / "missing-remote")
    result = run("--cleanup", cwd=path if state == "self" else repo)
    assert (result.returncode == 0) == (state == "clean"), result.stdout + result.stderr
    assert ("Sandbox cleaned up:" in result.stdout) == (state == "clean")
    assert path.exists() == (state != "clean")
    assert (git("rev-parse", "--verify", branch, check=False).returncode == 0) == (state != "clean")
    if state == "clean":
        assert str(path) not in git("worktree", "list", "--porcelain").stdout
        assert "remove_rc=0; registered=false; physical=false; branch=deleted" in result.stdout
    elif state in {"tracked", "untracked", "ignored", "foreign", "hidden", "hidden-large"}:
        name = {"foreign": "untracked", "hidden": "tracked", "hidden-large": "tracked"}.get(state, state)
        assert "work" in (path / name).read_text() or "preserve" in (path / name).read_text()
    elif state == "locked":
        assert "locked" in result.stderr
    elif state == "unmerged":
        assert f"git worktree remove --force {path}" in result.stderr


def test_create_after_cleanup_uses_current_head(sandbox):
    repo, path, branch, git, _, run = sandbox
    assert run("--cleanup").returncode == 0
    (repo / "tracked").write_text("current skill text\n")
    git("-c", "core.hooksPath=/dev/null", "commit", "-qam", "new skill")
    assert run("--create").returncode == 0
    assert git("rev-parse", "HEAD", cwd=path).stdout == git("rev-parse", "HEAD").stdout
    assert (path / "tracked").read_text() == "current skill text\n"
