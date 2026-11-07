"""Real lock crash and scheduler drain regressions, without provider calls."""
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import threading
import time
from argparse import Namespace

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'


def test_killed_step_can_restart(tmp_path):
    command = ['bash', str(SCRIPTS / 'run-step.sh'), str(tmp_path), 'probe', '--']
    subprocess.run(command + ['sleep', '30'], check=True)
    pidfile = tmp_path / 'logs/probe.pid'
    pid = int(pidfile.read_text())
    os.kill(pid, signal.SIGKILL)
    # Reap is performed by the OS parent; wait for death rather than a fixed delay.
    for _ in range(200):
        state = subprocess.run(['ps', '-o', 'stat=', '-p', str(pid)], capture_output=True, text=True).stdout.strip()
        if not state or state.startswith('Z'):
            break
        time.sleep(.01)
    result = subprocess.run(command + ['true'], capture_output=True)
    assert result.returncode == 0, result.stderr


def test_bounded_drain_and_finally_summary(tmp_path):
    spec = importlib.util.spec_from_file_location('batch_bounds', SCRIPTS / 'visual-batch.py')
    batch = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(batch)
    release = threading.Event()
    batch.read_sheet = lambda *a: (release.wait(3), batch.failed('sheet', 'blocked'))[1]
    args = Namespace(workdir=tmp_path, budget_seconds=.03, drain_seconds=.03,
                     concurrency=1, timeout=1, helper=Path('fixture'), question='facts')
    started = time.monotonic()
    try:
        assert batch.run(args, ['sheet', 'unstarted']) == 2
        assert time.monotonic() - started < .5
        summary = json.loads((tmp_path / 'visual/summary.json').read_text())
        assert summary['counts']['FAILED'] == 1
        assert summary['counts']['NOT_READ'] == 1
    finally:
        release.set()


def test_unexpected_failure_publishes_summary(tmp_path):
    spec = importlib.util.spec_from_file_location('batch_failure', SCRIPTS / 'visual-batch.py')
    batch = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(batch)
    def broken(*args):
        raise RuntimeError('unexpected helper failure')
    batch.read_sheet = broken
    args = Namespace(workdir=tmp_path, budget_seconds=1, concurrency=1,
                     timeout=1, helper=Path('fixture'), question='facts')
    import pytest
    with pytest.raises(RuntimeError):
        batch.run(args, ['sheet', 'unstarted'])
    summary = json.loads((tmp_path / 'visual/summary.json').read_text())
    assert summary['status'] == 'FAILED'
    assert sum(summary['counts'].values()) == 2
