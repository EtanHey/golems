"""Synthetic integrity checks; no model calls."""
import importlib.util
from pathlib import Path
import subprocess

import pytest

spec = importlib.util.spec_from_file_location('integrity', Path(__file__).parents[1]/'scripts/visual-batch.py')
batch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(batch)

@pytest.mark.parametrize('finding,state,bad', [('tile 25: visible', 'INVALID', [25]), ('tiles 0-19: visible', 'READ', []), ('tile -1: visible', 'INVALID', [-1])])
def test_bounds(finding, state, bad):
    item = batch.validate({'ok': True, 'finding': finding}, 20)
    assert item['state'] == state
    assert item['offending_indexes'] == bad


@pytest.mark.parametrize('finding', [
    '/evidence/frames/interval-001.jpg: Application visible.',
    'See evidence/frames/interval-001.jpg and evidence/tile/sheet-003.png.',
    'See frame-rate.png and tile-003.jpg.',
    r'C:\evidence\frames\interval-001.jpg: Application visible.',
    '20 tiles (0..19 in 4x5 grid). Before: tiles 0-14; after: tiles 15-19.',
    '20 tiles. The frame rate is 10 frames per second; framework visible.',
    'The tile layout is unchanged across frames.',
    'tiles 0..19: visible; tile 7, then tile 8 shows the result.',
    '/evidence with spaces/frames/interval-001.jpg: Application visible.',
])
def test_paths_counts_and_prose_are_not_bad_citations(finding):
    item = batch.validate(dict(ok=True, sheet='/evidence with spaces/frames/interval-001.jpg',
                               finding=finding), 20)
    assert item['state'] == 'READ', item


@pytest.mark.parametrize('finding', [
    '/evidence/frames/interval-001.jpg: tile 25: visible.',
    r'C:\evidence\frames\interval-001.jpg: tiles 18..25: visible.',
    '20 tiles (0..25 in a grid).', '20 tiles (19..0 in a grid).',
    'tiles 0..', 'tile 2.5', 'tiles 1/25', 'tile twenty-five',
    'the fourth tile', 'tile 0 and 25',
    '20 tiles 25: visible', 'tile 3 tile 25: visible',
])
def test_path_fix_keeps_bad_citations_invalid(finding):
    assert batch.validate(dict(ok=True, finding=finding), 20)['state'] == 'INVALID'


def test_retry_backoff_and_budget():
    now, sleeps = [0.], []
    def sleep(delay):
        sleeps.append(delay)
        now[0] += delay
    calls = []
    def read(question, timeout):
        calls.append(question)
        return {'ok': len(calls) == 2, 'finding': 'tile 0: visible', 'fatal': '', 'cause': 'timeout'}
    item = batch.retry_read(read, 'facts', 20, 10, 10, clock=lambda: now[0], sleep=sleep, jitter=lambda: 0)
    assert item['state'] == 'READ' and item['attempts'] == 2 and sleeps == [.25]
    calls.clear(); sleeps.clear(); now[0] = 0
    item = batch.retry_read(read, 'facts', 20, .1, 10, clock=lambda: now[0], sleep=sleep, jitter=lambda: 0)
    assert item['state'] == 'FAILED' and item['attempts'] == 1 and sleeps == []


def test_dispatch_never_retries():
    calls = []
    def read(question, timeout):
        calls.append(1)
        return {'ok': False, 'finding': '', 'fatal': 'DISPATCH_STOPPED: quota', 'cause': 'quota'}
    assert batch.retry_read(read, 'facts', 20, batch.time.monotonic()+10, 10)['state'] == 'FAILED'
    assert len(calls) == 1


def test_truncated_helper(tmp_path):
    helper = tmp_path/'helper.py'
    helper.write_text("print('tile 0: unfinished')")
    item = batch.read_sheet(helper, 'facts', 1, 'synthetic.png')
    assert not item['ok'] and 'truncated' in item['cause']

@pytest.mark.parametrize('valid', [False, True])
def test_mixed_coverage_and_complete_exit(tmp_path, valid):
    import json
    import sys
    helper = tmp_path/'helper.py'
    helper.write_text("import sys\nfrom pathlib import Path\nprint('Coverage: 1/1; complete;')\nprint('tile '+ ('0' if Path(sys.argv[-1]).stem == 'good' else '25') + ': visible')\n")
    for name in ('good', 'bad'):
        (tmp_path/(name+'.png')).write_bytes(b'synthetic')
    index = tmp_path/'index.tsv'
    index.write_text('good.png\t0\t10\t20\ttest\n' + ('' if valid else 'bad.png\t0\t10\t20\ttest\n'))
    result = subprocess.run([sys.executable, str(Path(batch.__file__)), '--helper', str(helper), '--index', str(index), '--workdir', str(tmp_path), '--question', 'facts'], capture_output=True, text=True)
    summary = json.loads(result.stdout)
    assert sum(summary['counts'].values()) == summary['total']
    assert (result.returncode == 0) == valid
    assert (summary['status'] == 'COMPLETE') == valid
    assert summary['counts']['READ'] == 1
    assert summary['counts']['INVALID'] == (0 if valid else 1)
    if not valid:
        assert summary['unresolved'][0]['offending_indexes'] == [25]
        assert summary['unresolved'][0]['attempts'] == 2
