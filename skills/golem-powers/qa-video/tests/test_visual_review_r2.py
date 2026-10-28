"""Offline regressions for the five confirmed QV1 review blockers."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from argparse import Namespace
from types import SimpleNamespace

import pytest

SCRIPT = Path(__file__).parents[1]/'scripts/visual-batch.py'
spec = importlib.util.spec_from_file_location('review_batch', SCRIPT)
batch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(batch)


def cli(tmp_path, finding):
    image = tmp_path/'sheet.png'
    image.write_bytes(b'synthetic')
    (tmp_path/'index.tsv').write_text('sheet.png\t0\t10\t20\tsynthetic\n')
    helper = tmp_path/'helper.py'
    helper.write_text("print('Coverage: 1/1; complete;')\nprint(" + repr(finding) + ")\n")
    result = subprocess.run([sys.executable, str(SCRIPT), '--helper', str(helper), '--index', str(tmp_path/'index.tsv'), '--workdir', str(tmp_path), '--question', 'facts'], text=True, capture_output=True, timeout=5)
    assert 'Traceback' not in result.stderr
    summary = json.loads((tmp_path/'visual/summary.json').read_text())
    assert summary == json.loads(result.stdout)
    assert [s['sheet'] for s in summary['sheets']] == [str(image)]
    assert sum(summary['counts'].values()) == 1
    return result, summary


@pytest.mark.parametrize('finding,bad', [
    ('tile #25: visible', [25]), ('frame 25: visible', [25]),
    ('tiles 1, 2, and 25: visible', [25]),
    ('tiles 18-25: visible', list(range(20, 26))),
    ('tiles 18–25: visible', list(range(20, 26))),
    ('tiles 18 to 25: visible', list(range(20, 26))),
    ('tile twenty-five: visible', []), ('tiles [25]: visible', []),
    ('tiles twenty-five: visible', []), ('tile 2five: visible', []),
    ('tile: 25 visible', []), ('tiles 1/25: visible', []),
])
def test_citation_cli(tmp_path, finding, bad):
    result, summary = cli(tmp_path, finding)
    assert result.returncode == 2
    item, = summary['sheets']
    assert item['state'] == 'INVALID'
    assert item['offending_indexes'] == bad


@pytest.mark.parametrize('overflow', [False, True])
def test_long_output_always_has_final_ledger(tmp_path, overflow):
    finding = 'x' * (2 * 1024 * 1024) if overflow else 'tile ' + '9' * 4301
    result, summary = cli(tmp_path, finding)
    assert result.returncode == 2
    item, = summary['sheets']
    assert item['state'] == 'FAILED'
    assert item['attempts'] == 2
    assert ('output byte limit' if overflow else 'numeric citation') in item['cause']


def run_args(tmp_path):
    return Namespace(workdir=tmp_path, budget_seconds=10, concurrency=1, timeout=1,
                     helper=tmp_path/'fake.py', question='facts', model='synthetic')


def test_retry_entry_deadline_preserves_identity_and_attempt(tmp_path, monkeypatch):
    now, writes = [0.], [0]
    real_atomic = batch.atomic
    def atomic(path, text):
        real_atomic(path, text)
        if path.name == 'progress.json':
            writes[0] += 1
            if writes[0] == 3:
                now[0] = 11.
    monkeypatch.setattr(batch, 'time', SimpleNamespace(monotonic=lambda: now[0]))
    monkeypatch.setattr(batch, 'atomic', atomic)
    monkeypatch.setattr(batch, 'read_sheet', lambda *a: dict(sheet=a[3], finding='NOT DETERMINED', ok=False, fatal='', cause='synthetic failure'))
    sheets = ['first.png']
    assert batch.run(run_args(tmp_path), sheets) == 2
    summary = json.loads((tmp_path/'visual/summary.json').read_text())
    assert sorted(s['sheet'] for s in summary['sheets']) == sorted(sheets)
    first = next(s for s in summary['sheets'] if s['sheet'] == sheets[0])
    assert first['state'] == 'FAILED' and first['attempts'] == len(first['history']) == 1
    assert all(s['attempts'] == len(s.get('history', [])) for s in summary['sheets'])


def test_retry_oserror_is_fresh_failed_attempt(tmp_path, monkeypatch):
    (tmp_path/'index.tsv').write_text('sheet.png\t0\t10\t20\tsynthetic\n')
    calls = []
    def read(*args):
        calls.append(1)
        if len(calls) == 1:
            return dict(sheet=args[3], finding='tile 25: visible', ok=True, fatal='', cause='')
        raise OSError('synthetic retry launch failed token=secret-value /outside/private.pem')
    monkeypatch.setattr(batch, 'read_sheet', read)
    assert batch.run(run_args(tmp_path), [str(tmp_path/'sheet.png')]) == 2
    item, = json.loads((tmp_path/'visual/summary.json').read_text())['sheets']
    assert item['state'] == 'FAILED' and item['attempts'] == 2
    assert [h['state'] for h in item['history']] == ['INVALID', 'FAILED']
    assert 'synthetic retry launch failed' in item['cause']
    assert 'secret-value' not in item['cause'] and '/outside' not in item['cause']


def test_setup_obeys_total_deadline(tmp_path, monkeypatch):
    fake = tmp_path/'agy'
    fake.write_text('#!' + sys.executable + '\nimport time\ntime.sleep(.6)\n')
    fake.chmod(0o755)
    monkeypatch.setenv('PATH', str(tmp_path)+os.pathsep+os.environ['PATH'])
    image = tmp_path/'sheet.png'
    image.write_bytes(b'synthetic')
    start = time.monotonic()
    result = subprocess.run([sys.executable, str(SCRIPT), '--budget-seconds', '.15', '--workdir', str(tmp_path), '--question', 'facts', str(image)], capture_output=True, text=True, timeout=2)
    assert time.monotonic() - start < .55
    summary = json.loads(result.stdout)
    assert summary['status'] == 'BUDGET_EXCEEDED'
    assert summary['sheets'][0]['state'] == 'NOT_READ'
    assert summary['sheets'][0]['attempts'] == 0


@pytest.mark.parametrize('stream', ['stdout', 'stderr'])
def test_stream_limit_stops_live_writer(tmp_path, stream):
    helper = tmp_path/'writer.py'
    helper.write_text("import sys, time\nsys." + stream + ".write('x' * (2 * 1024 * 1024))\nsys." + stream + ".flush()\ntime.sleep(3)\n")
    start = time.monotonic()
    item = batch.read_sheet(helper, 'facts', 2, 'sheet.png')
    assert time.monotonic() - start < 1
    assert not item['ok'] and item['cause'] == 'output byte limit exceeded'


def test_large_range_keeps_exact_interval_without_expansion():
    item = batch.validate(dict(sheet='synthetic', finding='tiles 18-999999999: visible', ok=True), 20)
    assert item['state'] == 'INVALID'
    assert item['offending_intervals'] == [[20, 999999999]]
    assert len(item['offending_indexes']) <= 1000
