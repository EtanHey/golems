"""The gather route from an installed (non-git) release copy; a stub agy, no provider requests.

w70 2026-11-12 (dictation lead, verified on the M1): resolve_model ran `git rev-parse` and every
installed release failed SETUP_FAILED exit 128, so seats read the frames themselves.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

SKILL = Path(__file__).resolve().parents[1]
ROLES = SKILL.parents[2] / 'standards/model-roles.json'

AGY = r'''#!/usr/bin/env python3
import json, sys
from pathlib import Path
state = Path(__file__).with_name('calls')
if sys.argv[1:2] == ['models']:
    print('gemini-3.8-flash-high\tGemini 3.8 Flash (High)'); sys.exit(0)
prompt = sys.argv[sys.argv.index('--print') + 1]
paths = json.loads(prompt[prompt.index('{"question"'):])['image_paths']
calls = int(state.read_text()) if state.exists() else 0
state.write_text(str(calls + 1))
if calls < int(Path(__file__).with_name('truncate_first').read_text() or 0):
    print(json.dumps({'status': 'SUCCESS', 'response': '<truncated'})); sys.exit(0)
body = {'images': [{'path': p, 'finding': 'tile 0: red box at left, Save label visible'} for p in paths]}
print(json.dumps({'status': 'SUCCESS', 'response': json.dumps(body)}))
'''


def release(tmp_path, truncate_first=0, roles=True):
    """A release-shaped, non-git tree: <root>/skills/golem-powers/qa-video + <root>/standards."""
    root = tmp_path / 'releases' / '2026.11.12-test'
    shutil.copytree(SKILL, root / 'skills/golem-powers/qa-video', ignore=shutil.ignore_patterns('evals', 'tests', '__pycache__'))
    if roles:
        (root / 'standards').mkdir()
        shutil.copy(ROLES, root / 'standards/model-roles.json')
    bin_dir = tmp_path / 'bin'
    bin_dir.mkdir()
    (bin_dir / 'agy').write_text(AGY)
    (bin_dir / 'agy').chmod(0o755)
    (bin_dir / 'truncate_first').write_text(str(truncate_first))
    sheet = tmp_path / 'frames' / 'sheet_001.jpg'
    sheet.parent.mkdir()
    sheet.write_bytes(b'\xff\xd8\xff\xe0 synthetic jpeg')
    (sheet.parent / 'index.tsv').write_text('sheet_001.jpg\t0.000\t10\t1\tclick-save\n')
    env = {k: v for k, v in os.environ.items() if k not in ('GOLEMS_ROOT', 'QA_VIDEO_VISUAL_TIER')}
    env.update(PATH=f'{bin_dir}{os.pathsep}{env["PATH"]}', HOME=str(tmp_path / 'home'))
    scripts = root / 'skills/golem-powers/qa-video/scripts'
    assert subprocess.run(['git', '-C', str(scripts), 'rev-parse'], capture_output=True).returncode != 0
    return scripts, sheet, env, bin_dir


def batch(scripts, sheet, env, *extra):
    return subprocess.run([sys.executable, str(scripts / 'visual-batch.py'), '--question', 'facts',
                           '--workdir', str(sheet.parent.parent / 'work'), '--budget-seconds', '60',
                           *extra, str(sheet)], env=env, capture_output=True, text=True, timeout=120)


def summary(sheet):
    return json.loads((sheet.parent.parent / 'work/visual/summary.json').read_text())


def test_setup_succeeds_from_a_non_git_release_copy(tmp_path):
    scripts, sheet, env, _ = release(tmp_path)
    result = batch(scripts, sheet, env)
    assert 'SETUP_FAILED' not in result.stderr and 'not a git repository' not in result.stderr
    assert result.returncode == 0, result.stdout + result.stderr
    assert summary(sheet)['counts']['READ'] == 1


def test_missing_roles_fail_with_a_clear_cause_and_env_override_works(tmp_path):
    scripts, sheet, env, _ = release(tmp_path, roles=False)
    one = subprocess.run([sys.executable, str(scripts / 'visual-gather.py'), '--question', 'q', str(sheet)],
                         env=env, capture_output=True, text=True, timeout=60)
    assert one.returncode == 1 and 'model roles not found' in one.stderr
    ok = subprocess.run([sys.executable, str(scripts / 'visual-gather.py'), '--question', 'q', str(sheet)],
                        env=dict(env, QA_VIDEO_VISUAL_TIER='flash-high'), capture_output=True, text=True, timeout=60)
    assert ok.returncode == 0 and 'Coverage: 1/1; complete' in ok.stdout, ok.stderr


def test_per_call_timeout_above_120_is_accepted_up_to_the_cap(tmp_path):
    scripts, sheet, env, _ = release(tmp_path)
    assert batch(scripts, sheet, env, '--timeout', '300').returncode == 0
    refused = batch(scripts, sheet, env, '--timeout', '601')
    assert refused.returncode == 2 and '<=600' in refused.stderr


def test_empty_or_truncated_output_gets_one_bounded_retry(tmp_path):
    # Two truncated responses exhaust visual-gather's own singleton retry, so the sheet comes back
    # "empty or truncated output"; the batch retries it once and the third call reads it.
    scripts, sheet, env, bin_dir = release(tmp_path, truncate_first=2)
    result = batch(scripts, sheet, env)
    item = summary(sheet)['sheets'][0]
    assert result.returncode == 0, result.stdout + result.stderr
    assert item['state'] == 'READ' and item['attempts'] == 2
    assert item['history'][0]['cause'].startswith('empty or truncated output')
    assert (bin_dir / 'calls').read_text() == '3'
