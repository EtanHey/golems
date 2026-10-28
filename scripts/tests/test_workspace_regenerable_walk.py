"""W1c round-one regressions: ignored caches can contain unpublished repositories."""
from contextlib import contextmanager
import os
from pathlib import Path

import pytest

from test_workspace_preservation import ignored
from test_workspace_retire import git, load_retire, retire_args, run, tree


def cache(tree, name=".venv"):
    ignored(tree, name + "/")
    root = tree[1] / name
    root.mkdir()
    (root / "cache").write_text("regenerable\n")
    return root


def nested(root, external, marker):
    package = root / "src/somepkg"
    package.mkdir(parents=True)
    options = ["--separate-git-dir", str(external)] if marker == "gitfile" else []
    git(package, "init", "-q", *options)
    git(package, "config", "user.name", "Fixture")
    git(package, "config", "user.email", "fixture@example.com")
    (package / "precious").write_text("unpublished work\n")
    git(package, "add", "precious")
    git(package, "commit", "-qm", "local-only fixture commit")
    return git(package, "rev-parse", "HEAD")


def at_move(module, tree, monkeypatch, action):
    real_git = module.git
    def inject(repo, *words):
        result = real_git(repo, *words)
        if (words[:2] == ("worktree", "move") and Path(words[2]) == tree[1]
                and result.returncode == 0):
            action(Path(words[3]))
        return result
    monkeypatch.setattr(module, "git", inject)


@pytest.mark.parametrize("phase", ["before", "after"])
@pytest.mark.parametrize("marker", ["directory", "gitfile"])
def test_nested_cache_repository_retained(tree, monkeypatch, phase, marker):
    root = cache(tree)
    external = tree[2].parent / "package.git"
    heads = []
    if phase == "before":
        heads.append(nested(root, external, marker))
        result, receipt = run(tree)
        code = result.returncode
    else:
        module = load_retire()
        at_move(module, tree, monkeypatch,
                lambda moved: heads.append(nested(moved / ".venv", external, marker)))
        receipt, code = module.retire(retire_args(tree))
    assert code == 2 and receipt["disposition"] == "RETAINED"
    assert "nested repository in regenerable dir: .venv/src/somepkg/.git" in receipt["reason"]
    assert receipt["remove_rc"] is None
    assert receipt["move_back_rc"] == (0 if phase == "after" else None)
    assert (root / "src/somepkg/precious").read_text() == "unpublished work\n"
    assert git(root / "src/somepkg", "rev-parse", "HEAD") == heads[0]
    walk = receipt["regenerable_walks"][-1]
    assert walk["phase"] == ("after_move" if phase == "after" else "before_move")
    assert walk["nested_repositories"] == [".venv/src/somepkg/.git"]


@pytest.mark.parametrize("phase", ["before", "after"])
def test_unreadable_cache_walk_retains(tree, monkeypatch, phase):
    root = cache(tree)
    blocked = root / "blocked"
    blocked.mkdir()
    (blocked / "precious").write_text("valuable\n")
    module, moved_paths = load_retire(), []
    if phase == "before":
        blocked.chmod(0)
    else:
        def block(moved):
            moved_paths.append(moved)
            (moved / ".venv/blocked").chmod(0)
        at_move(module, tree, monkeypatch, block)
    try:
        receipt, code = module.retire(retire_args(tree))
        assert code == 2 and receipt["disposition"] == "RETAINED"
        assert "regenerable walk evidence incomplete" in receipt["reason"]
        assert receipt["remove_rc"] is None
        assert receipt["move_back_rc"] == (0 if phase == "after" else None)
    finally:
        for worktree in [tree[1], *moved_paths]:
            candidate = worktree / ".venv/blocked"
            if os.path.lexists(candidate):
                candidate.chmod(0o700)
    assert (blocked / "precious").read_text() == "valuable\n"


def test_vanished_cache_entry_is_incomplete_evidence(tree, monkeypatch):
    root = cache(tree)
    (root / "vanish").write_text("cache\n")
    module = load_retire()
    real_scandir = module.os.scandir
    @contextmanager
    def vanish(directory):
        with real_scandir(directory) as stream:
            entries = list(stream)
            if any(entry.name == "vanish" for entry in entries):
                os.unlink("vanish", dir_fd=directory)
            yield iter(entries)
    monkeypatch.setattr(module.os, "scandir", vanish)
    receipt, code = module.retire(retire_args(tree))
    assert code == 2 and receipt["disposition"] == "RETAINED"
    assert "regenerable walk evidence incomplete" in receipt["reason"]
    assert receipt["remove_rc"] is None and tree[1].is_dir()


@pytest.mark.parametrize("budget", ["time", "entries"])
def test_cache_walk_budget_exceeded_retains(tree, monkeypatch, budget):
    root = cache(tree)
    (root / "another").write_text("cache\n")
    module = load_retire()
    setting = "REGENERABLE_WALK_SECONDS" if budget == "time" else "REGENERABLE_WALK_ENTRIES"
    monkeypatch.setattr(module, setting, 0 if budget == "time" else 1, raising=False)
    receipt, code = module.retire(retire_args(tree))
    assert code == 2 and receipt["disposition"] == "RETAINED"
    assert budget + " budget exceeded" in receipt["reason"]
    assert receipt["remove_rc"] is None and tree[1].is_dir()
    walk = receipt["regenerable_walks"][-1]
    assert walk["budget_hit"] == budget
    assert walk["duration_seconds"] >= 0 and walk["entry_count"] <= 1


def test_plain_cache_walks_record_before_and_after_removal(tree):
    root = cache(tree, "node_modules")
    ignored(tree, "node_modules/", "__pycache__/")
    (tree[1] / "__pycache__").mkdir()
    (tree[1] / "__pycache__/module.pyc").write_bytes(b"cache")
    result, receipt = run(tree)
    assert result.returncode == 0 and receipt["disposition"] == "REMOVED"
    assert [walk["phase"] for walk in receipt["regenerable_walks"]] == [
        "before_move", "before_move", "after_move"]
    assert all(walk["entry_count"] == 2 and walk["duration_seconds"] >= 0
               and walk["budget_hit"] is None for walk in receipt["regenerable_walks"])
    assert not root.exists()


def test_cache_walk_never_follows_directory_symlinks(tree):
    root = cache(tree, "node_modules")
    outside = tree[2].parent / "outside"
    head = nested(outside, tree[2].parent / "unused.git", "directory")
    (root / "linked-source").symlink_to(outside, target_is_directory=True)
    result, receipt = run(tree)
    assert result.returncode == 0 and receipt["disposition"] == "REMOVED"
    assert git(outside / "src/somepkg", "rev-parse", "HEAD") == head
    assert all(walk["entry_count"] == 2 for walk in receipt["regenerable_walks"])


def test_nested_repository_receipt_caps_paths(tree):
    root = cache(tree)
    for number in range(21):
        package = root / str(number)
        package.mkdir()
        (package / ".git").write_text("gitdir: unavailable\n")
    result, receipt = run(tree)
    assert result.returncode == 2 and receipt["disposition"] == "RETAINED"
    paths = receipt["regenerable_walks"][-1]["nested_repositories"]
    assert len(paths) == 20
    assert all(path.startswith(".venv/") and path.endswith("/.git") for path in paths)
