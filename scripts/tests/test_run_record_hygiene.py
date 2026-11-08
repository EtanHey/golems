import importlib.util
import json
import os
from pathlib import Path
import signal
import selectors
import subprocess
import sys
import pytest
ROOT = Path(__file__).resolve().parents[1]
GATE = ROOT / 'hooks/private-regression-gate.py'

def load():
    spec = importlib.util.spec_from_file_location('gate', GATE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def test_retention_is_scoped_and_skips_live_owners_and_symlinks(tmp_path, monkeypatch, capsys):
    records = tmp_path / "records"
    records.mkdir()
    (tmp_path / "docs.local").symlink_to(records, target_is_directory=True)
    gate = load()
    root = tmp_path / 'docs.local/hooks-private-gate-runs'
    root.mkdir(parents=True)
    runs = []
    for i in range(8):
        run = root / f'{i:032x}'
        run.mkdir()
        os.utime(run, (i, i))
        runs.append(run)
    gate.write_owner_marker(runs[0], os.getpid(), gate.start_token(os.getpid()))
    os.utime(runs[0], (0, 0))
    (root / 'unrelated').mkdir()
    outside = tmp_path / 'outside'
    outside.mkdir()
    (outside / 'keep').write_text('keep')
    (root / ('f' * 32)).symlink_to(outside)
    # Neither recursive enumeration nor decoding unrelated pending files is needed.
    (tmp_path / 'docs.local/pending.png').write_bytes(b'\xff')
    gate.prune_runs(tmp_path, keep=2)
    assert runs[0].exists()
    assert not runs[1].exists()
    assert runs[6].exists() and runs[7].exists()
    assert (outside / 'keep').read_text() == 'keep'
    assert (root / 'unrelated').exists()
    def refused(*args):
        raise PermissionError('fixture refusal')
    monkeypatch.setattr(gate.shutil, 'rmtree', refused)
    gate.prune_runs(tmp_path, keep=0)
    assert runs[6].exists() and 'WARN' in capsys.readouterr().out

@pytest.mark.parametrize('change', ['clean', 'dirty', 'commit'])
def test_real_sigkill_then_next_gate_reclaims_dead_run(tmp_path, change):
    repo = tmp_path / 'repo'
    repo.mkdir()
    def git(*args):
        return subprocess.check_output(['git', '-C', str(repo), *args], text=True).strip()
    git('init', '-q')
    git('config', 'user.email', 'fixture@example.com')
    git('config', 'user.name', 'Fixture')
    git('commit', '--allow-empty', '-qm', 'initial')
    sha = git('rev-parse', 'HEAD')
    wrapper = '''
import contextlib, importlib.util, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location('gate', sys.argv[1])
gate = importlib.util.module_from_spec(spec); spec.loader.exec_module(gate)
gate.slot = contextlib.nullcontext
original = gate.public_suites
manifest = gate.load_manifest
gate.load_manifest = lambda repo, sha, required=False, warn=True: manifest(repo, sha, required, False)
def pause(tree):
    suites = original(tree)
    print('READY', flush=True)
    sys.stdin.read()
    return suites
if sys.argv[4] == 'pause': gate.public_suites = pause
gate.run(Path(sys.argv[2]), sys.argv[3])
'''
    env = {**os.environ, 'GOLEMS_WORKTREE_MIN_FREE_GB': '0'}
    command = [sys.executable, '-c', wrapper, str(GATE), str(repo), sha]
    child = subprocess.Popen([*command, 'pause'], stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
    try:
        with selectors.DefaultSelector() as ready:
            ready.register(child.stdout, selectors.EVENT_READ)
            assert ready.select(timeout=20), 'gate did not reach worktree barrier'
            assert child.stdout.readline().strip() == 'READY'
        root = repo / 'docs.local/hooks-private-gate-runs'
        dead, = list(root.iterdir())
        tree = repo / '.worktrees' / ('hooks-private-gate-' + dead.name)
        if change != 'clean':
            (tree / 'local.txt').write_text('preserve')
        if change == 'commit':
            subprocess.run(['git', '-C', str(tree), 'add', 'local.txt'], check=True)
            subprocess.run(['git', '-C', str(tree), 'commit', '-qm', 'local-only'], check=True)
        child.send_signal(signal.SIGKILL)
        child.wait(timeout=10)
        assert child.returncode == -signal.SIGKILL
        for i in range(20):
            (root / f'{i:032x}').mkdir()
        result = subprocess.run([*command, 'run'], env=env, capture_output=True, text=True, timeout=30)
        assert result.returncode == 0, result.stderr
        assert 'worktree' in result.stdout
        if change == 'clean':
            assert not dead.exists() and not tree.exists()
        else:
            assert dead.exists() and (tree / 'local.txt').read_text() == 'preserve'
        assert '--force' not in GATE.read_text()
    finally:
        if child.poll() is None:
            child.kill()
        child.communicate(timeout=10)
