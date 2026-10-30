"""Owned synthetic processes only; native observations never parse ps text."""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import uuid

import pytest
from test_heavy_suite_lock import SCRIPT, env, load_module, wait_for

sys.path.insert(0, str(SCRIPT.parent))
import proc_identity as proc


@pytest.fixture(autouse=True)
def isolated_resources(monkeypatch, tmp_path):
    for key in list(os.environ):
        if key.startswith('GOLEMS_HEAVY_'): monkeypatch.delenv(key)
    for key, value in env(tmp_path).items():
        if key == 'HOME' or key.startswith('GOLEMS_HEAVY_'): monkeypatch.setenv(key, value)


@pytest.fixture
def tree(tmp_path):
    marker = uuid.uuid4().hex
    children = []
    def spawn(code, environment=None):
        p = subprocess.Popen([sys.executable, '-c', code, '', '\udcff\u2028\u2029'], env={**env(tmp_path), 'LIFECYCLE_FIXTURE_ID': marker, 'ODD': 'a\udcff\u2028\u2029', **(environment or {})}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        children.append((p, proc.identity(p.pid)))
        return p
    control = spawn('import time; time.sleep(60)', {'LIFECYCLE_FIXTURE_ID': uuid.uuid4().hex})
    yield tmp_path, marker, spawn
    assert control.poll() is None, 'unrelated control was signalled'
    for pid in proc.list_pids():
        try: snapshot = proc.identity(pid)
        except proc.ProcIdentityUnavailable: continue
        if snapshot is not None and snapshot.uid == os.geteuid():
            try:
                if proc.has_env(pid, b'LIFECYCLE_FIXTURE_ID', marker.encode()) is True: children.append((None, snapshot))
            except proc.ProcIdentityUnavailable: pass
    for p, snapshot in children:
        if snapshot is not None and proc.same_process(snapshot):
            with proc.pinned_process(snapshot) as fd:
                if fd is None: os.kill(snapshot.pid, signal.SIGKILL)
                else: signal.pidfd_send_signal(fd, signal.SIGKILL)
        if p is not None: p.wait(timeout=5)


def survivors(marker):
    result = []
    for pid in proc.list_pids():
        try: snapshot = proc.identity(pid)
        except proc.ProcIdentityUnavailable: continue
        if snapshot is not None and snapshot.uid == os.geteuid():
            try:
                if proc.has_env(pid, b'LIFECYCLE_FIXTURE_ID', marker.encode()) is True: result.append(pid)
            except proc.ProcIdentityUnavailable: pass
    return result


@pytest.mark.skipif(sys.platform != 'darwin' or not Path('/usr/bin/top').stat().st_mode & 0o4000,
                    reason='Darwin setuid child fixture')
@pytest.mark.parametrize('cancel', [False, True], ids=['timeout', 'cancel'])
def test_setuid_group_child_is_cleaned_without_false_ok(tree, cancel):
    home, marker, _ = tree
    ready = home / 'setuid.pid'
    code = ("import subprocess; from pathlib import Path; "
            "p=subprocess.Popen(['/usr/bin/top','-l','6','-s','1','-n','1'], "
            "stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); "
            f"Path({str(ready)!r}).write_text(str(p.pid)); p.wait()")
    wrapper = subprocess.Popen([sys.executable, str(SCRIPT), '--timeout-seconds',
        '8' if cancel else '1', '--kill-grace-seconds', '.1', '--', sys.executable, '-c', code],
        env={**env(home), 'LIFECYCLE_FIXTURE_ID': marker}, stderr=subprocess.PIPE, text=True)
    top_pid = group = None
    def member_alive():
        try: return os.getpgid(top_pid) == group
        except ProcessLookupError: return False
    try:
        wait_for(ready)
        top_pid = int(ready.read_text())
        group = os.getpgid(top_pid)
        time.sleep(.2)
        try: observed = proc.identity(top_pid)
        except proc.ProcIdentityUnavailable as error:
            assert error.reason == 'permission' and error.ruid == os.getuid()
        else: pytest.skip(f'kernel permits setuid inspection: {observed}')
        if cancel: wrapper.send_signal(signal.SIGTERM)
        _, err = wrapper.communicate(timeout=10)
        assert wrapper.returncode == (143 if cancel else 124), err
        deadline = time.monotonic() + .5
        while member_alive() and time.monotonic() < deadline: time.sleep(.01)
        assert not member_alive(), err
    finally:
        if wrapper.poll() is None: wrapper.terminate()
        wrapper.communicate(timeout=10)
        # The red fixture may survive the old wrapper; let its bounded six samples end.
        # Never signal a protected PID whose incarnation cannot be inspected.
        if top_pid is not None:
            deadline = time.monotonic() + 8
            while member_alive() and time.monotonic() < deadline: time.sleep(.02)
            assert not member_alive(), 'bounded fixture did not exit'


@pytest.mark.parametrize('mode', ['ordinary', 'force', 'held', 'expiry', 'setup', 'invalid', 'nested'])
@pytest.mark.parametrize('busy', [False, True])
def test_hard_deadline_cleans_tree(tree, mode, busy):
    home, marker, _ = tree
    e = {**env(home), 'LIFECYCLE_FIXTURE_ID': marker, 'ODD': '\udcff\u2028\u2029'}
    if mode == 'force': e['GOLEMS_HEAVY_FORCE'] = '1'
    if mode == 'held': e['GOLEMS_HEAVY_SUITE_HELD'] = 'fixture'
    if mode == 'invalid': e['GOLEMS_HEAVY_MAX_LOAD'] = 'nan'
    holder = (home / 'base.slot0.lock').open('w')
    if mode == 'expiry':
        fcntl.flock(holder, fcntl.LOCK_EX); e.update(GOLEMS_HEAVY_LOCK=str(home / 'base.lock'), GOLEMS_HEAVY_MAX_WAIT_SECONDS='0')
    if mode == 'setup': e['GOLEMS_HEAVY_LOCK'] = str(home / 'base.slot0.lock' / 'bad')
    leaf = "import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(60)"
    code = f"import subprocess,sys,time; subprocess.Popen([sys.executable,'-c',{leaf!r},'', {('a' + chr(0xdcff) + chr(0x2028) + chr(0x2029))!r}],start_new_session=True);\nwhile True: " + ('sum(range(1000))' if busy else 'time.sleep(.01)')
    command = [sys.executable, '-c', code]
    if mode == 'nested': command = [sys.executable, str(SCRIPT), '--', *command]
    try:
        r = subprocess.run([sys.executable, str(SCRIPT), '--timeout-seconds', '.5', '--kill-grace-seconds', '.1', '--', *command], env=e, capture_output=True, text=True, timeout=10)
        assert r.returncode == 124, r.stderr
        lines = [line for line in r.stderr.split('\n') if 'TIMEOUT' in line]
        assert len(lines) == 1 and lines[0].startswith('heavy-suite: TIMEOUT after 0.5s; terminating suite process tree (suite_id=')
        assert not survivors(marker)
        receipt = json.loads(next((home / '.local/state/golems/runs').glob('*.cleanup.json')).read_text())
        assert receipt['cleanup'] == 'ok' and not receipt['survivors'] and not receipt['incomplete']
        assert receipt['members_seen'] and receipt['signalled']
    finally: holder.close()


@pytest.mark.parametrize('signum', [signal.SIGINT, signal.SIGTERM, signal.SIGHUP, None])
def test_reparented_child_and_cancellation(tree, signum):
    home, marker, spawn = tree
    ready = home / 'ready'
    leaf = f"import signal,time; from pathlib import Path; signal.signal(signal.SIGTERM,signal.SIG_IGN); Path({str(ready)!r}).touch(); time.sleep(60)"
    code = f"import subprocess,sys,time,signal; from pathlib import Path; subprocess.Popen([sys.executable,'-c',{leaf!r}],start_new_session=True);\nwhile not Path({str(ready)!r}).exists(): time.sleep(.01)\n" + ("time.sleep(.1)" if signum is None else "signal.signal(signal.SIGTERM,lambda *a:sys.exit(0)); time.sleep(60)")
    wrapper = subprocess.Popen([sys.executable, str(SCRIPT), '--kill-grace-seconds', '.1', '--', sys.executable, '-c', code], env={**env(home), 'LIFECYCLE_FIXTURE_ID': marker}, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    try:
        wait_for(ready)
        if signum is not None: wrapper.send_signal(signum)
        _, err = wrapper.communicate(timeout=10)
        assert wrapper.returncode == (0 if signum is None else 128 + signum), err
        assert not survivors(marker)
    finally:
        if wrapper.poll() is None: wrapper.kill()
        wrapper.communicate(timeout=5)


@pytest.mark.parametrize('flag', ['timeout-seconds', 'kill-grace-seconds'])
@pytest.mark.parametrize('value', ['nan', 'inf', '-1', 'nonsense'])
@pytest.mark.parametrize('mode', ['force', 'held'])
def test_invalid_controls_never_launch(tmp_path, flag, value, mode):
    e = {**env(tmp_path), 'GOLEMS_HEAVY_' + ('FORCE' if mode == 'force' else 'SUITE_HELD'): '1'}
    r = subprocess.run([sys.executable, str(SCRIPT), f'--{flag}={value}', '--', sys.executable, '-c', 'raise SystemExit(99)'], env=e, capture_output=True, text=True, timeout=5)
    assert r.returncode == 2 and f'invalid {flag}; expected a finite number' in r.stderr


@pytest.mark.parametrize('status', [0, 7, 75, 124])
def test_completed_status_beats_late_bookkeeping(monkeypatch, tmp_path, status):
    m = load_module(); monkeypatch.setenv('HOME', str(tmp_path))
    old = m.save_run
    def slow(path, record):
        old(path, record)
        if record.get('leader_pid'): time.sleep(.15)
    monkeypatch.setattr(m, 'save_run', slow)
    assert m.main(['--timeout-seconds', '.1', '--', sys.executable, '-c', f'raise SystemExit({status})']) == status


@pytest.mark.parametrize('signum', [signal.SIGINT, signal.SIGTERM])
def test_cancellation_during_final_notice(monkeypatch, tmp_path, signum):
    m = load_module(); monkeypatch.setenv('HOME', str(tmp_path))
    assert hasattr(m, 'SuiteTree')
    original = m.notice
    def notice(message):
        if 'SUITE DONE' in message: os.kill(os.getpid(), signum)
        original(message)
    monkeypatch.setattr(m, 'notice', notice)
    assert m.main(['--', sys.executable, '-c', 'pass']) == 128 + signum


@pytest.mark.parametrize('reload_dependency', [False, True], ids=['cached', 'reloaded'])
@pytest.mark.parametrize('case', ['reused-group', 'old-marker', 'same-birth-marker', 'foreign', 'hidden'])
def test_identity_authority_is_not_numeric_or_env_only(monkeypatch, case, reload_dependency):
    if reload_dependency:
        spec = importlib.util.spec_from_file_location('proc_identity', SCRIPT.with_name('proc_identity.py'))
        replacement = importlib.util.module_from_spec(spec)
        monkeypatch.setitem(sys.modules, spec.name, replacement)
        spec.loader.exec_module(replacement)
    m = load_module()
    native = m.proc  # Collection may have replaced the canonical proc_identity module.
    leader_pid = max(os.getpid(), os.getppid(), os.getpgrp()) + 1
    other_pid = leader_pid + 1
    leader = native.ProcIdentity(leader_pid, os.getpid(), leader_pid, os.geteuid(), os.getuid(), (100, 1))
    other = native.ProcIdentity(other_pid, 1, leader_pid, os.geteuid(), os.getuid(), leader.start if case == 'same-birth-marker' else (99, 0) if case == 'old-marker' else (101, 0))
    if case == 'foreign': other = native.ProcIdentity(other_pid, leader_pid, leader_pid, os.geteuid()+1, os.getuid()+1, (101, 0))
    tracker = m.SuiteTree(leader, 'a'*32, False)
    snapshot = native.ChildrenSnapshot()
    snapshot[other.pid] = (other.ppid, other.pgid, other.start, other.uid, other.ruid)
    if case == 'foreign': snapshot[leader.pid] = (leader.ppid, leader.pgid, leader.start, leader.uid, leader.ruid)
    if case == 'hidden': tracker.known[(other.pid, other.start)] = other; snapshot.pop(other.pid); snapshot.unavailable[other.pid] = native.ProcIdentityUnavailable('hidden', uid=os.geteuid())
    snapshot_reads = []
    def read_snapshot():
        snapshot_reads.append(True)
        return snapshot
    monkeypatch.setattr(native, 'children_snapshot', read_snapshot)
    monkeypatch.setattr(native, 'identity', lambda pid: leader if case == 'foreign' and pid == leader.pid else other if case == 'same-birth-marker' and pid == other.pid else None)
    monkeypatch.setattr(native, 'owned', lambda *args: case in ('old-marker', 'same-birth-marker'))
    found = tracker.scan()
    assert snapshot_reads == [True], "authority fixture did not reach the consumer dependency"
    if case in ('reused-group', 'old-marker', 'same-birth-marker'): assert not found
    else: assert tracker.incomplete


@pytest.mark.parametrize('cli,expected', [([], 3), (['--timeout-seconds', '4'], 4)])
def test_live_receipt_and_configuration_precedence(tree, cli, expected):
    home, marker, _ = tree; ready = home / 'ready'; release = home / 'release'
    code = f"import time; from pathlib import Path; Path({str(ready)!r}).touch();\nwhile not Path({str(release)!r}).exists(): time.sleep(.01)"
    p = subprocess.Popen([sys.executable, str(SCRIPT), *cli, '--', sys.executable, '-c', code], env={**env(home), 'GOLEMS_HEAVY_TIMEOUT_SECONDS': '3', 'LIFECYCLE_FIXTURE_ID': marker}, stderr=subprocess.PIPE, text=True)
    try:
        wait_for(ready)
        path = next((home / '.local/state/golems/runs').glob('*.json')); record = json.loads(path.read_text())
        assert record['leader_pid'] and record['leader_birth'] and record['owner_birth'] and record['wrapper_birth']
        assert record['wall_limit_s'] == expected and len(record['cmd_sha256']) == 64
        assert path.stat().st_mode & 0o777 == 0o600 and path.parent.stat().st_mode & 0o777 == 0o700
        release.touch(); _, err = p.communicate(timeout=5)
        assert p.returncode == 0 and not path.exists(), err
        assert not survivors(marker)
    finally:
        release.touch()
        if p.poll() is None: p.terminate()
        p.communicate(timeout=5)


@pytest.mark.parametrize('expires', [False, True])
def test_unrelated_later_marker_is_reported_without_signalling(tree, expires):
    home, marker, _ = tree
    ready, release, stranger_ready = (home / name for name in ('ready', 'release', 'stranger-ready'))
    code = f"import time; from pathlib import Path; Path({str(ready)!r}).touch();\nwhile not Path({str(release)!r}).exists(): time.sleep(.01)"
    wrapper = subprocess.Popen([sys.executable, str(SCRIPT), '--timeout-seconds', '0.5' if expires else '3', '--kill-grace-seconds', '.1', '--', sys.executable, '-c', code], env={**env(home), 'LIFECYCLE_FIXTURE_ID': marker}, stderr=subprocess.PIPE, text=True)
    stranger, snapshot = None, None
    try:
        wait_for(ready)
        run = next((home / '.local/state/golems/runs').glob('*.json'))
        record = json.loads(run.read_text())
        while record['leader_birth'] is None:
            assert wrapper.poll() is None
            time.sleep(.01); record = json.loads(run.read_text())
        stranger_code = f"import time; from pathlib import Path; Path({str(stranger_ready)!r}).touch(); time.sleep(60)"
        stranger = subprocess.Popen([sys.executable, '-c', stranger_code], start_new_session=True, env={**env(home), 'GOLEMS_HEAVY_SUITE_ID': record['suite_id']}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        snapshot = proc.identity(stranger.pid)
        wait_for(stranger_ready)
        assert snapshot.ppid == os.getpid() and snapshot.pgid == stranger.pid
        assert snapshot.start > (tuple(bytes.fromhex(key) if isinstance(key, str) else key for key in record['leader_birth']))
        if not expires: release.touch()
        _, err = wrapper.communicate(timeout=10)
        assert stranger.poll() is None, 'unrelated marker process was signalled'
        assert wrapper.returncode == (124 if expires else 70), err
        receipt = json.loads(run.read_text())
        assert receipt['cleanup'] == 'failed' and receipt['incomplete']
        assert any(row['pid'] == stranger.pid and row['status'] == 'unattributed marker process (not signalled)' for row in receipt['unattributed_marker_processes'])
        assert stranger.pid not in {row['pid'] for row in receipt['signalled']}
        assert stranger.pid not in {row['pid'] for row in receipt['members_seen']}
        assert not survivors(marker)
    finally:
        release.touch()
        if wrapper.poll() is None: wrapper.terminate()
        wrapper.communicate(timeout=5)
        if snapshot is not None and proc.same_process(snapshot):
            with proc.pinned_process(snapshot) as fd:
                if fd is None: os.kill(snapshot.pid, signal.SIGKILL)
                else: signal.pidfd_send_signal(fd, signal.SIGKILL)
        if stranger is not None: stranger.wait(timeout=5)


def test_finished_command_retains_live_group_leader_until_cleanup(monkeypatch):
    m = load_module(); cleanup = m.cleanup_tree
    def with_live_leader(tree, child, *args):
        assert child.poll() is None and proc.same_process(tree.leader)
        return cleanup(tree, child, *args)
    monkeypatch.setattr(m, 'cleanup_tree', with_live_leader)
    assert m.main(['--', sys.executable, '-c', 'pass']) == 0


@pytest.mark.parametrize('closed_stdin', [False, True])
def test_command_does_not_inherit_launch_control_pipes(tmp_path, closed_stdin):
    probe = "import os;\nfor fd in range(3,256):\n try: os.fstat(fd)\n except OSError: continue\n raise AssertionError('launch descriptor inherited')"
    result = subprocess.run([sys.executable, str(SCRIPT), '--', sys.executable, '-c', probe], env={**env(tmp_path), 'GOLEMS_HEAVY_FORCE': '1'}, capture_output=True, text=True, timeout=5, preexec_fn=(lambda: os.close(0)) if closed_stdin else None)
    assert result.returncode == 0, result.stderr
