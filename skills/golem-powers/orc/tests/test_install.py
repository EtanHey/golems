"""Global orc agents install tests; HOME always points inside this worktree."""

import os
import shutil
import subprocess
import uuid
from datetime import date
from pathlib import Path

import pytest


SKILL = Path(__file__).resolve().parents[1]
INSTALL = SKILL / "scripts" / "install.sh"
NAMES = ("orc-helper", "brain-worker", "coach-mail")
SCRATCH = Path(__file__).resolve().parent / ".scratch"


@pytest.fixture
def home():
    root = SCRATCH / uuid.uuid4().hex
    path = root / "home"
    path.mkdir(parents=True)
    yield path
    shutil.rmtree(root)
    if not any(SCRATCH.iterdir()):
        SCRATCH.rmdir()


def run_install(home, *args):
    return subprocess.run(
        ["bash", str(INSTALL), *args],
        env={**os.environ, "HOME": str(home)},
        capture_output=True,
        text=True,
        timeout=30,
    )


def link(home, name):
    return home / ".claude" / "agents" / f"{name}.md"


def snapshot(root):
    state = {}
    for directory, dirs, files in os.walk(root):
        for name in dirs + files:
            path = Path(directory) / name
            if path.is_symlink():
                state[str(path)] = ("link", os.readlink(path), path.lstat().st_mtime_ns)
            elif path.is_file():
                state[str(path)] = ("file", path.read_bytes(), path.stat().st_mtime_ns)
            else:
                state[str(path)] = ("dir",)
    return state


def test_fresh_install_links_all_agents(home):
    result = run_install(home)
    assert result.returncode == 0, result.stdout + result.stderr
    for name in NAMES:
        owner = SKILL.parent / "coach" if name == "coach-mail" else SKILL
        target = owner / "agents" / f"{name}.md"
        assert link(home, name).is_symlink()
        assert os.readlink(link(home, name)) == str(target)
        assert f"[link] {link(home, name)}" in result.stdout


def test_rerun_is_no_op(home):
    assert run_install(home).returncode == 0
    before = snapshot(home)
    result = run_install(home)
    assert result.returncode == 0, result.stdout + result.stderr
    assert snapshot(home) == before
    for name in NAMES:
        assert f"[keep] {link(home, name)}" in result.stdout


@pytest.mark.parametrize("name", NAMES)
def test_hand_placed_file_is_backed_up(home, name):
    original = link(home, name)
    original.parent.mkdir(parents=True)
    original.write_bytes(b"hand placed\n")
    result = run_install(home)
    backup = original.parent / f".{name}.md.bak-{date.today():%Y%m%d}"
    assert result.returncode == 0, result.stdout + result.stderr
    assert backup.read_bytes() == b"hand placed\n"
    assert original.is_symlink()
    assert f"[backup] {original}" in result.stdout


@pytest.mark.parametrize("name", NAMES)
def test_existing_backup_refuses_without_data_loss(home, name):
    original = link(home, name)
    original.parent.mkdir(parents=True)
    original.write_bytes(b"new hand placed\n")
    backup = original.parent / f".{name}.md.bak-{date.today():%Y%m%d}"
    backup.write_bytes(b"old backup\n")
    before = snapshot(home)
    result = run_install(home)
    assert result.returncode != 0
    assert snapshot(home) == before
    assert "[conflict]" in result.stdout


@pytest.mark.parametrize("hand_placed", [False, True])
def test_dry_run_changes_nothing(home, hand_placed):
    if hand_placed:
        original = link(home, "orc-helper")
        original.parent.mkdir(parents=True)
        original.write_bytes(b"hand placed\n")
    before = snapshot(home)
    result = run_install(home, "--dry-run")
    assert result.returncode == 0, result.stdout + result.stderr
    assert snapshot(home) == before
    assert "[dry-run]" in result.stdout


@pytest.mark.parametrize("name", NAMES)
def test_stale_symlink_is_replaced(home, name):
    original = link(home, name)
    original.parent.mkdir(parents=True)
    original.symlink_to(home / "missing-agent.md")
    result = run_install(home)
    assert result.returncode == 0, result.stdout + result.stderr
    owner = SKILL.parent / "coach" if name == "coach-mail" else SKILL
    assert original.resolve() == owner / "agents" / f"{name}.md"
    assert "[unlink]" in result.stdout
