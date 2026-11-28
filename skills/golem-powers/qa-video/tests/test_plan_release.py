"""Plan from checkout and an installed symlink, without repository-only Node scripts."""
import json
import os
from pathlib import Path
import shutil
import subprocess

import pytest

SKILL = Path(__file__).resolve().parents[1]
ROOT = SKILL.parents[2]


def plan(skill, work, home):
    env = {k: v for k, v in os.environ.items() if k not in ('GOLEMS_ROOT', 'GOLEMS_MODEL_ROLES_ROOT')}
    env['HOME'] = str(home)
    return subprocess.run(['bash', str(skill / 'scripts/default.sh'), 'plan',
                           '/unused.mov', str(work), 'debrief'], env=env,
                          capture_output=True, text=True, timeout=20)


@pytest.mark.parametrize('installed', [False, True])
def test_plan_resolves_models_from_checkout_and_release(tmp_path, installed):
    skill = SKILL
    roles = json.loads((ROOT / 'standards/model-roles.json').read_text())
    if installed:
        release = tmp_path / '.golems/releases/fixture'
        skill = release / 'skills/golem-powers/qa-video'
        shutil.copytree(SKILL, skill, ignore=shutil.ignore_patterns('tests', '__pycache__'))
        (release / 'standards').mkdir()
        (release / 'standards/model-roles.json').write_text(json.dumps(roles))
        link = tmp_path / '.claude/skills/qa-video'
        link.parent.mkdir(parents=True)
        link.symlink_to(skill, target_is_directory=True)
        skill = link
    result = plan(skill, tmp_path / 'work', tmp_path)
    assert result.returncode == 0, result.stderr
    for role in ('claude.judgment', 'claude.subagent.cheap'):
        assert roles['roles'][role]['model'] in result.stdout
    assert 'MODULE_NOT_FOUND' not in result.stderr


def test_missing_roles_names_missing_file(tmp_path):
    skill = tmp_path / 'release/skills/golem-powers/qa-video'
    shutil.copytree(SKILL, skill, ignore=shutil.ignore_patterns('tests', '__pycache__'))
    result = plan(skill, tmp_path / 'work', tmp_path)
    assert result.returncode != 0
    assert 'model roles not found' in result.stderr
    assert 'standards/model-roles.json' in result.stderr
    assert 'delegate_task(' not in result.stdout
