"""Real admission CLI and per-read validation; no paid reader is launched."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

S = Path(os.environ.get('QA_VIDEO_TEST_SCRIPTS', Path(__file__).parents[1] / 'scripts'))
spec = importlib.util.spec_from_file_location('policy', S / 'reader-policy.py')
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


def admit(work, count=52, *flags, action='admit'):
    dense = work / 'dense'
    dense.mkdir(exist_ok=True)
    for i in range(count):
        (dense / f'{i}.png').write_bytes(b'fixture')
    (dense / 'index.tsv').write_text(''.join(f'{i}.png\t0\n' for i in range(count)))
    return subprocess.run([sys.executable, str(S / 'reader-policy.py'), action, str(work),
                           *flags], capture_output=True, text=True)


def test_default_still_refuses_over_five(tmp_path):
    result = admit(tmp_path)
    assert result.returncode == 3 and 'exceeds $5' in result.stderr


@pytest.mark.parametrize('action', ['admit', 'plan'])
def test_explicit_authorization_and_validation(tmp_path, action):
    result = admit(tmp_path, 52, '--authorized-usd', '7', '--authorized-by', 'lead', action=action)
    assert result.returncode == 0, result.stderr
    row = policy.validate(tmp_path / 'visual/cost-admission.json', [tmp_path / 'dense/0.png'])
    assert row['authorized_usd'] == 7 and row['authorized_by'] == 'lead'
    assert row['estimated_usd'] == 5.2
    assert admit(tmp_path).returncode == 0  # re-admission preserves the recorded ceiling
    row = json.loads((tmp_path / 'visual/cost-admission.json').read_text())
    assert row['authorized_usd'] == 7 and row['authorized_by'] == 'lead'


def test_authorized_ceiling_refuses_excess(tmp_path):
    result = admit(tmp_path, 71, '--authorized-usd', '7', '--authorized-by', 'lead')
    assert result.returncode == 3
    assert '$7.10' in result.stderr and '$7.00' in result.stderr


@pytest.mark.parametrize('flags', [
    ['--authorized-usd', '7'], ['--authorized-usd', '7', '--authorized-by', '  '],
    ['--authorized-by', 'lead'],
    *[['--authorized-usd', value, '--authorized-by', 'lead'] for value in ['0', '-1', 'nan', 'inf']],
])
def test_invalid_authorization_fails_closed(tmp_path, flags):
    result = admit(tmp_path, 1, *flags)
    assert result.returncode == 3, result.stderr
    assert 'COST_HOLD: positive finite authorized-usd' in result.stderr
    path = tmp_path / 'visual/cost-admission.json'
    assert not path.exists() or json.loads(path.read_text())['status'] != 'ADMITTED'


@pytest.mark.parametrize('patch', [
    {'authorized_usd': 8, 'authorized_by': None}, {'estimated_usd': 7.1},
    *[{'authorized_usd': value} for value in [0, -1, float('nan'), float('inf'), True, '7']],
])
def test_tampered_record_refused(tmp_path, patch):
    assert admit(tmp_path, 52, '--authorized-usd', '7', '--authorized-by', 'lead').returncode == 0
    path = tmp_path / 'visual/cost-admission.json'
    row = json.loads(path.read_text())
    row.update(patch)
    path.write_text(json.dumps(row))
    with pytest.raises(ValueError):
        policy.validate(path, [])
    assert admit(tmp_path).returncode != 0


def test_plan_before_extraction_records_authorization(tmp_path):
    result = subprocess.run([sys.executable, str(S / 'reader-policy.py'), 'plan', str(tmp_path),
        '--authorized-usd', '7', '--authorized-by', 'lead'], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    row = json.loads((tmp_path / 'visual/cost-admission.json').read_text())
    assert row['status'] == 'PENDING' and row['authorized_usd'] == 7
    assert admit(tmp_path).returncode == 0


@pytest.mark.parametrize('patch', [
    {'estimated_usd': 1}, {'price_per_sheet_usd': 1},
    *[{'price_per_sheet_usd': value} for value in [0, -1, float('nan'), float('inf'), True, '0.1']],
])
def test_validate_recomputes_run_estimate(tmp_path, patch):
    assert admit(tmp_path, 52, '--authorized-usd', '7', '--authorized-by', 'lead').returncode == 0
    path = tmp_path / 'visual/cost-admission.json'
    row = json.loads(path.read_text())
    row.update(patch)
    path.write_text(json.dumps(row))
    with pytest.raises(ValueError, match='COST_HOLD'):
        policy.validate(path, [])


def test_replan_clears_prior_authorization(tmp_path):
    assert admit(tmp_path, 52, '--authorized-usd', '7', '--authorized-by', 'lead').returncode == 0
    old = json.loads((tmp_path / 'visual/run.json').read_text())
    result = admit(tmp_path, action='plan')
    assert result.returncode == 3 and 'exceeds $5' in result.stderr
    row = json.loads((tmp_path / 'visual/cost-admission.json').read_text())
    assert row['run_id'] != old['run_id']
    assert 'authorized_usd' not in row and 'authorized_by' not in row
    assert row['status'] == 'COST_HOLD'
