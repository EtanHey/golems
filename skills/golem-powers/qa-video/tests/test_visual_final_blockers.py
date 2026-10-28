"""Offline compound-failure regressions from the final QV1 review."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys

import pytest

DRIVER = Path(__file__).parents[1]/'scripts/visual-batch.py'


def run(tmp_path, body, *, production=True, count=1, budget=4, setup=False):
    images = [tmp_path/f'{i}.png' for i in range(count)]
    for image in images:
        image.write_bytes(b'synthetic')
    (tmp_path/'index.tsv').write_text(''.join(f'{p.name}\t0\t10\t20\tsynthetic\n' for p in images))
    helper = tmp_path/('agy' if production else 'helper.py')
    helper.write_text('#!'+sys.executable+'\nimport os,sys,time,json\nfrom pathlib import Path\nwork=Path(__file__).parent\nwith (work/"launches").open("a") as f: f.write(str(os.getpid())+"\\n")\n'+body)
    helper.chmod(0o755)
    command = [sys.executable, str(DRIVER), '--question', 'facts', '--workdir', str(tmp_path), '--index', str(tmp_path/'index.tsv'), '--budget-seconds', str(budget), '--concurrency', '1']
    if not setup:
        command += ['--model', 'synthetic-model']
    if not production:
        command += ['--helper', str(helper)]
    result = subprocess.run(command, env=dict(os.environ, PATH=str(tmp_path)+os.pathsep+os.environ['PATH']), capture_output=True, text=True, timeout=8)
    return result, images


@pytest.mark.parametrize('finding', ['25th tile', 'the 25th tile.', 'button is visible in the 25th tile.', 'the last tile'])
def test_real_gather_rejects_unsupported_prefix_citations(tmp_path, finding):
    result, images = run(tmp_path, "assert '--print' in sys.argv\nprompt=sys.argv[sys.argv.index('--print')+1]\npaths=json.loads(prompt.splitlines()[-1])['image_paths']\nprint(json.dumps({'status':'SUCCESS','response':json.dumps({'images':[{'path':p,'finding':"+repr(finding)+"} for p in paths]})}))\n")
    summary = json.loads(result.stdout)
    assert result.returncode == 2 and summary['status'] != 'COMPLETE'
    assert summary['sheets'][0]['sheet'] == str(images[0])
    assert summary['sheets'][0]['state'] == 'INVALID'


def test_setup_timeout_with_stderr_keeps_every_identity(tmp_path):
    result, images = run(tmp_path, "assert sys.argv[1:]==['models']\nos.write(2,b'loading models \\xff\\n')\ntime.sleep(.8)\n", count=3, budget=.3, setup=True)
    assert 'Traceback' not in result.stderr
    assert len((tmp_path/'launches').read_text().splitlines()) == 1
    summary = json.loads(result.stdout)
    assert 'loading models' in summary['cause']
    assert summary == json.loads((tmp_path/'visual/summary.json').read_text())
    assert summary['status'] in ('BUDGET_EXCEEDED', 'SETUP_FAILED')
    assert sorted(s['sheet'] for s in summary['sheets']) == sorted(str(p) for p in images)
    assert all(s['state'] == 'NOT_READ' and s['attempts'] == 0 for s in summary['sheets'])
    assert sum(summary['counts'].values()) == len(images)


def test_provider_is_gone_when_batch_returns(tmp_path):
    result, _ = run(tmp_path, "assert '--print' in sys.argv\n(work/'provider.pid').write_text(str(os.getpid()))\ntime.sleep(5)\n", budget=.3)
    pid = int((tmp_path/'provider.pid').read_text())
    try:
        with pytest.raises(ProcessLookupError):
            os.kill(pid, 0)
        assert json.loads(result.stdout)['status'] == 'BUDGET_EXCEEDED'
    finally:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


@pytest.mark.parametrize('production,body', [
    (True, "assert '--print' in sys.argv\nos.write(2,b'429 quota exceeded\\n')\nos.write(1,b'x'*1100000)\n"),
    (False, "print('DISPATCH_STOPPED: quota / 429',file=sys.stderr)\nprint('tile 9999999999')\nraise SystemExit(2)\n"),
    (False, "os.write(2,b'DISPATCH_STOPPED: quota / 429\\n')\ntime.sleep(5)\n"),
])
def test_fatal_evidence_survives_compound_failure(tmp_path, production, body):
    result, _ = run(tmp_path, body, production=production, count=3, budget=.5 if 'sleep' in body else 4)
    summary = json.loads(result.stdout)
    assert result.returncode == 2 and summary['status'] == 'DISPATCH_STOPPED'
    assert len((tmp_path/'launches').read_text().splitlines()) == 1
    assert summary['counts']['NOT_READ'] == 2
    assert summary['sheets'][0]['attempts'] == 1
    assert summary['sheets'][0]['fatal']
    assert all(s['attempts'] == 0 for s in summary['unread'])
