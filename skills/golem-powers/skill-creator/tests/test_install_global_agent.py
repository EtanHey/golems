"""install.sh ships the skill-creator agent as a global ~/.claude/agents symlink.

Every run points HOME at a scratch dir inside this checkout, so the real
~/.claude is never touched and nothing lands in /tmp.
"""

import os
import shutil
import subprocess
import uuid
from datetime import date
from pathlib import Path

import pytest


SKILL_DIR = Path(__file__).resolve().parents[1]
INSTALL = SKILL_DIR / "scripts" / "install.sh"
SOURCE_AGENT = SKILL_DIR / "agents" / "skill-creator.md"
SCRATCH_ROOT = Path(__file__).resolve().parent / ".scratch"


@pytest.fixture
def home():
    scratch = SCRATCH_ROOT / uuid.uuid4().hex
    (scratch / "home").mkdir(parents=True)
    yield scratch / "home"
    shutil.rmtree(scratch, ignore_errors=True)
    if SCRATCH_ROOT.is_dir() and not any(SCRATCH_ROOT.iterdir()):
        SCRATCH_ROOT.rmdir()


def run_install(home, *args):
    env = {**os.environ, "HOME": str(home)}
    return subprocess.run(
        ["bash", str(INSTALL), *args],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )


def agent_link(home):
    return home / ".claude" / "agents" / "skill-creator.md"


def snapshot(root):
    """Every path under root with its kind, link target or bytes, and mtime."""
    state = {}
    for dirpath, dirnames, filenames in os.walk(root):
        for name in dirnames + filenames:
            path = Path(dirpath) / name
            stat = path.lstat()
            if path.is_symlink():
                state[str(path)] = ("link", os.readlink(path), stat.st_mtime_ns)
            elif path.is_dir():
                state[str(path)] = ("dir", None, None)
            else:
                state[str(path)] = ("file", path.read_bytes(), stat.st_mtime_ns)
    return state


def test_source_agent_is_a_valid_claude_code_agent():
    text = SOURCE_AGENT.read_text()
    assert text.startswith("---\n")
    frontmatter = text.split("---\n", 2)[1]
    assert "name: skill-creator\n" in frontmatter
    assert "description: " in frontmatter


def test_fresh_install_links_the_global_agent(home):
    result = run_install(home)

    assert result.returncode == 0, result.stdout + result.stderr
    link = agent_link(home)
    assert link.is_symlink()
    assert os.readlink(link) == str(SOURCE_AGENT)
    assert link.read_text() == SOURCE_AGENT.read_text()


def test_rerun_is_a_no_op(home):
    first = run_install(home)
    assert first.returncode == 0, first.stdout + first.stderr
    before = snapshot(home)

    second = run_install(home)

    assert second.returncode == 0, second.stdout + second.stderr
    assert snapshot(home) == before
    assert f"symlink already correct: {agent_link(home)}" in second.stdout


def test_hand_placed_file_is_backed_up_then_linked(home):
    link = agent_link(home)
    link.parent.mkdir(parents=True)
    link.write_text("hand-placed agent\n")
    day_before = date.today().strftime("%Y%m%d")

    result = run_install(home)

    assert result.returncode == 0, result.stdout + result.stderr
    backups = sorted(link.parent.glob(".skill-creator.md.bak-*"))
    assert len(backups) == 1
    backup = backups[0]
    assert backup.name in {
        f".skill-creator.md.bak-{day_before}",
        f".skill-creator.md.bak-{date.today().strftime('%Y%m%d')}",
    }
    assert backup.read_text() == "hand-placed agent\n"
    assert str(backup) in result.stdout
    assert link.is_symlink()
    assert os.readlink(link) == str(SOURCE_AGENT)


def test_existing_backup_is_never_overwritten(home):
    link = agent_link(home)
    link.parent.mkdir(parents=True)
    link.write_text("second hand-placed agent\n")
    backup = link.parent / f".skill-creator.md.bak-{date.today().strftime('%Y%m%d')}"
    backup.write_text("first backup\n")

    result = run_install(home)

    assert result.returncode != 0
    assert backup.read_text() == "first backup\n"
    assert not link.is_symlink()
    assert link.read_text() == "second hand-placed agent\n"


def test_dry_run_changes_nothing(home):
    link = agent_link(home)
    link.parent.mkdir(parents=True)
    link.write_text("hand-placed agent\n")
    before = snapshot(home)

    result = run_install(home, "--dry-run")

    assert result.returncode == 0, result.stdout + result.stderr
    assert snapshot(home) == before
    assert "would back up" in result.stdout
    assert f"would link: {link}" in result.stdout


def test_dry_run_on_fresh_home_changes_nothing(home):
    result = run_install(home, "--dry-run")

    assert result.returncode == 0, result.stdout + result.stderr
    assert snapshot(home) == {}


def test_legacy_backup_agent_is_reported_and_left_alone(home):
    agents = home / ".claude" / "agents"
    agents.mkdir(parents=True)
    legacy = agents / "skill-creator-backup.md"
    legacy.write_text("legacy prompt\n")
    stamp = legacy.lstat().st_mtime_ns

    result = run_install(home)

    assert result.returncode == 0, result.stdout + result.stderr
    assert legacy.read_text() == "legacy prompt\n"
    assert legacy.lstat().st_mtime_ns == stamp
    assert str(legacy) in result.stdout
    assert agent_link(home).is_symlink()
