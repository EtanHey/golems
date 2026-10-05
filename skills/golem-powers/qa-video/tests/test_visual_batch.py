"""Offline scheduler checks using a subprocess helper; no provider requests."""
import importlib.util
import json
import re
import subprocess
import sys
import time
from pathlib import Path

import pytest

SKILL = Path(__file__).resolve().parents[1]
DRIVER = SKILL / 'scripts/visual-batch.py'


@pytest.fixture
def setup(tmp_path):
    helper = tmp_path / 'helper.py'
    helper.write_text('''import json, sys, time
from pathlib import Path
image = Path(sys.argv[-1])
image.with_suffix('.timeout').write_text(sys.argv[sys.argv.index('--timeout') + 1])
with (image.parent / 'starts').open('a') as f: f.write('start ' + str(time.monotonic()) + '\\n')
latencies = image.parent / 'latencies.json'
time.sleep(json.loads(latencies.read_text())[image.stem] if latencies.exists() else (.08 if image.stem == '0' else .3))
if image.stem == '0' and (image.parent / 'quota').exists():
    print('DISPATCH_STOPPED: quota / 429; our own dispatch', file=sys.stderr)
    sys.exit(2)
with (image.parent / 'starts').open('a') as f: f.write('end ' + str(time.monotonic()) + '\\n')
print('Coverage: 1/1; complete; 0 image findings omitted by output cap.')
print(str(image) + ': synthetic finding' + ('; color NOT DETERMINED' if (image.parent / 'unknown').exists() else ''))
''')
    images = [tmp_path / f'{i}.png' for i in range(8)]
    for image in images:
        image.write_bytes(b'synthetic stub input')
    index = tmp_path / 'index.tsv'
    index.write_text('sheet_file\twindow_start_s\tfps\ttiles\tlabel\n' +
                     ''.join(f'{p.name}\t0\t10\t20\ttest\n' for p in images))
    def launch(*extra):
        return subprocess.Popen([sys.executable, str(DRIVER), '--index', str(index),
                                 '--question', 'facts', '--workdir', str(tmp_path),
                                 '--helper', str(helper), *extra], stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True)
    return tmp_path, launch


def finish(process):
    out, err = process.communicate(timeout=10)
    return process.returncode, json.loads(out), err


def test_concurrent_incremental_progress_and_cap(setup):
    work, launch = setup
    started = time.monotonic()
    process = launch('--concurrency', '99')
    samples, counts = [], []
    while process.poll() is None:
        path = work / 'progress.json'
        if path.exists():
            samples.append(json.loads(path.read_text()))
        if (work / 'visual/findings.jsonl').exists():
            counts.append(len((work / 'visual/findings.jsonl').read_text().splitlines()))
        time.sleep(.02)
    code, result, err = finish(process)
    assert code == 0 and result['status'] == 'COMPLETE'
    assert result['concurrency'] == 4 and 'cap' in err
    assert time.monotonic() - started < 1.8  # serial stub calls take >2.1s
    assert any(0 < s['completed'] < 8 for s in samples)
    assert any(0 < c < 8 for c in counts)
    events = [row.split() for row in (work / 'starts').read_text().splitlines()]
    active, peak = 0, 0
    for kind, _ in sorted(events, key=lambda row: float(row[1])):
        active += 1 if kind == 'start' else -1
        peak = max(peak, active)
    assert peak == 4
    eta = [s['eta_seconds'] for s in samples if s['eta_seconds'] is not None]
    assert all(e >= 0 for e in eta)
    assert json.loads((work / 'progress.json').read_text())['eta_seconds'] == 0
    assert len((work / 'visual/findings.jsonl').read_text().splitlines()) == 8
    assert re.match(r'visual 8/8 sheets · elapsed .* · ETA .* · budget .*',
                    (work / 'progress.txt').read_text().strip())


def test_budget_partial_and_unread(setup):
    work, launch = setup
    code, result, _ = finish(launch('--concurrency', '1', '--budget-seconds', '.12'))
    assert code != 0 and result['status'] == 'BUDGET_EXCEEDED'
    assert 0 < result['completed'] < 8
    assert len(result['unread']) == 8 - result['completed']
    assert all(10 <= float(p.read_text()) < 30.12 for p in work.glob('*.timeout'))
    assert all(x['finding'].startswith('NOT DETERMINED') for x in result['unread'])
    assert len((work / 'visual/findings.jsonl').read_text().splitlines()) == result['completed']


def test_quota_stops_new_calls(setup):
    work, launch = setup
    (work / 'quota').touch()
    code, result, err = finish(launch('--concurrency', '2'))
    assert code != 0 and result['status'] == 'DISPATCH_STOPPED'
    assert sum(row.startswith('start ') for row in (work / 'starts').read_text().splitlines()) == 2
    assert len(result['unread']) == 6 and 'our own dispatch' in err


def test_shells_are_bash32_safe():
    forbidden = re.compile(r'\b(?:mapfile|readarray|coproc)\b|declare\s+-A|\$\{[^}]+(?:,,|\^\^)[^}]*\}|\|&')
    for path in (SKILL / 'scripts').glob('*.sh'):
        subprocess.run(['/bin/bash', '-n', str(path)], check=True)
        assert not forbidden.search(path.read_text()), str(path)


@pytest.mark.parametrize('reason', ['429 quota exceeded', '401 authentication failed', 'invalid_credential', 'rate limit'])
def test_helper_stops_on_provider_error_without_retry(reason):
    spec = importlib.util.spec_from_file_location('visual', SKILL / 'scripts/visual-gather.py')
    v = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(v)
    calls = []
    def run(paths):
        calls.append(paths)
        return subprocess.CompletedProcess([], 1, '', reason)
    with pytest.raises(v.DispatchError):
        v.gather(['/a.png', '/b.png'], run)
    assert len(calls) == 1


def test_explicit_sheet_list_and_default_concurrency(setup):
    work, _ = setup
    p = subprocess.run([sys.executable, str(DRIVER), '--question', 'facts',
                        '--workdir', str(work), '--helper', str(work / 'helper.py'),
                        str(work / '0.png'), str(work / '1.png')], capture_output=True, text=True)
    assert p.returncode == 0 and json.loads(p.stdout)['concurrency'] == 3


def test_setup_auth_error_is_propagated(monkeypatch, capsys):
    spec = importlib.util.spec_from_file_location('visual', SKILL / 'scripts/visual-gather.py')
    v = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(v)
    monkeypatch.setattr(v.sys, 'argv', ['visual', '--question', 'facts', str(SKILL / 'evals/fixtures/alpha.png')])
    def lookup(args, **kwargs):
        if args[0] == 'agy':
            raise subprocess.CalledProcessError(1, args, '', '401 auth error')
        return str(SKILL.parents[2]) if args[0] == 'git' else 'flash-high'
    monkeypatch.setattr(v.subprocess, 'check_output', lookup)
    assert v.main() == 2 and 'DISPATCH_STOPPED:' in capsys.readouterr().err


@pytest.mark.parametrize('slowdown', [False, True])
def test_eta_matches_throughput_and_can_rise(setup, slowdown):
    work, launch = setup
    for i in range(8, 12):
        (work / f'{i}.png').touch()
    with (work / 'index.tsv').open('a') as f:
        f.write(''.join(f'{i}.png\t0\t10\t20\ttest\n' for i in range(8, 12)))
    (work / 'latencies.json').write_text(json.dumps({str(i): .9 if slowdown and i >= 3 else .3 for i in range(12)}))
    process, samples = launch('--concurrency', '3'), []
    while process.poll() is None:
        if (work / 'progress.json').exists():
            samples.append(json.loads((work / 'progress.json').read_text()))
        time.sleep(.01)
    assert finish(process)[0] == 0
    first = next(s['eta_seconds'] for s in samples if s['completed'] == 3)
    assert .7 * .9 <= first <= 1.3 * .9  # nine remaining sheets, three .3s waves
    if slowdown:
        assert max(s['eta_seconds'] for s in samples if 3 < s['completed'] < 12) > first


def test_unknown_detail_is_successful_coverage(setup):
    work, launch = setup
    (work / 'unknown').touch()
    code, result, _ = finish(launch())
    assert code == 0 and result['status'] == 'COMPLETE' and not result['unresolved']
    assert 'NOT DETERMINED' in (work / 'visual/findings.jsonl').read_text()
