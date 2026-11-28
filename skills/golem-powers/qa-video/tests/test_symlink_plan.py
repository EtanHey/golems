"""Real plan CLI through a scratch installed skills link; no media/provider calls."""
import os
from pathlib import Path
import subprocess

import pytest


@pytest.mark.parametrize("file_link", [False, True])
def test_plan_through_installed_skill_link(tmp_path, file_link):
    root = Path(__file__).resolve().parents[4]
    home = tmp_path / 'home with spaces'
    skills = home / '.claude/skills'
    skills.mkdir(parents=True)
    (skills / 'qa-video').symlink_to(root / 'skills/golem-powers/qa-video', target_is_directory=True)
    entry = skills / 'qa-video/scripts/default.sh'
    if file_link:
        entry = home / 'plan.sh'
        entry.symlink_to(skills / 'qa-video/scripts/default.sh')
    result = subprocess.run(['bash', str(entry), 'plan',
                             'unused.mp4', str(tmp_path / 'run'), 'review'],
                            env=dict(os.environ, HOME=str(home)), text=True, capture_output=True)
    assert result.returncode == 0, result.stderr
    assert str(root / 'skills/golem-powers/qa-video/scripts') in result.stdout
    assert '<claude.judgment model>' not in result.stdout
