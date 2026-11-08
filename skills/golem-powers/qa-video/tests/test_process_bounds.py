"""Real lock crash and scheduler drain regressions, without provider calls."""
import importlib.util
import json
import os
from pathlib import Path
import signal
import sys
import subprocess
import threading
import time
from argparse import Namespace

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'


def wait_until(predicate):
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(.01)
    raise AssertionError('condition did not become true')


def test_killed_wrapper_blocks_retry_until_group_dies(tmp_path):
    command = ['bash', str(SCRIPTS / 'run-step.sh'), str(tmp_path), 'probe', '--']
    childfile = tmp_path / 'child.pid'
    child = None
    wrapper = None
    try:
        subprocess.run(command + [sys.executable, '-c',
                       'import os, signal, pathlib; pathlib.Path(' + repr(str(childfile)) +
                       ').write_text(str(os.getpid())); signal.pause()'], check=True)
        wait_until(childfile.exists)
        child = int(childfile.read_text())
        wrapper = int((tmp_path / 'logs/probe.pid').read_text())
        os.kill(wrapper, signal.SIGKILL)
        def dead(pid):
            state = subprocess.run(['ps', '-o', 'stat=', '-p', str(pid)], capture_output=True, text=True).stdout.strip()
            return not state or state.startswith('Z')
        wait_until(lambda: dead(wrapper))
        result = subprocess.run(command + ['true'], capture_output=True)
        assert result.returncode != 0, 'retry allowed a duplicate writer while child lives'
        assert os.getpgid(child) == wrapper
        os.killpg(wrapper, signal.SIGKILL)
        wait_until(lambda: dead(child))
        # The group must be fully reaped before reclamation, not merely zombied.
        def restarted():
            return subprocess.run(command + ['true'], capture_output=True).returncode == 0
        wait_until(restarted)
    finally:
        for pid in (child, wrapper):
            if pid:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass


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


def test_drain_preserves_dispatch_stop_cause(tmp_path):
    spec = importlib.util.spec_from_file_location('batch_quota', SCRIPTS / 'visual-batch.py')
    batch = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(batch)
    release = threading.Event()
    def read(*args):
        sheet = args[3]
        if sheet == 'quota':
            return dict(batch.failed(sheet, 'quota exhausted'), fatal='DISPATCH_STOPPED: quota exhausted')
        release.wait(3)
        return batch.failed(sheet, 'blocked')
    batch.read_sheet = read
    args = Namespace(workdir=tmp_path, budget_seconds=.03, drain_seconds=.03,
                     concurrency=2, timeout=1, helper=Path('fixture'), question='facts')
    try:
        assert batch.run(args, ['quota', 'blocked']) == 2
        summary = json.loads((tmp_path / 'visual/summary.json').read_text())
        assert summary['status'] == 'DISPATCH_STOPPED'
        assert summary['cause'] == 'DISPATCH_STOPPED: quota exhausted'
    finally:
        release.set()
