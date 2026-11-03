"""A real setuid ps held at write(2), with no timing-dependent read window."""
import json
import os
from pathlib import Path
import sys
import time

import pytest
from test_heavy_suite_lock import env, load_module


@pytest.mark.skipif(sys.platform != 'darwin' or not Path('/bin/ps').stat().st_mode & 0o4000,
                    reason='Darwin setuid ps fixture')
@pytest.mark.parametrize('complete', [True, False], ids=['completed', 'detached-survivor'])
def test_setuid_ps_lifetime_controls_cleanup(monkeypatch, tmp_path, complete):
    m = load_module()
    for key in list(os.environ):
        if key.startswith('GOLEMS_HEAVY_'): monkeypatch.delenv(key)
    for key, value in env(tmp_path).items():
        if key == 'HOME' or key.startswith('GOLEMS_HEAVY_'): monkeypatch.setenv(key, value)
    fifo, ready, release, exit_parent = [tmp_path / name for name in ('output', 'ready', 'exec', 'exit-parent')]
    os.mkfifo(fifo)
    fd = os.open(fifo, os.O_RDWR | os.O_NONBLOCK)
    try:
        while True:
            try: os.write(fd, b'x' * 4096)
            except BlockingIOError: break
        # The Python incarnation must be observed before exec. ps then blocks
        # on the full FIFO until a native scan has observed its effective UID 0.
        code = (f'import os,time; from pathlib import Path; Path({str(ready)!r}).write_text(str(os.getpid()))\n'
                f'while not Path({str(release)!r}).exists(): time.sleep(.005)\n'
                f'os.dup2(os.open({str(fifo)!r},os.O_WRONLY),1)\n'
                'os.execv("/bin/ps",["ps","-p",str(os.getpid()),"-o","pid="])')
        if not complete:
            code = (f'import subprocess,sys,time; from pathlib import Path; '
                    f'subprocess.Popen([sys.executable,"-c",{code!r}], start_new_session=True)\n'
                    f'while not Path({str(exit_parent)!r}).exists(): time.sleep(.005)')
        original = m.SuiteTree.scan
        observed_root = []

        def scan(tree, *args, **kwargs):
            rows = original(tree, *args, **kwargs)
            if ready.exists():
                pid = int(ready.read_text())
                if any(key[0] == pid for key in tree.known): release.touch()
                if m.proc._scope_hint(pid).get('uid') == 0:
                    observed_root.append(pid)
                    exit_parent.touch()
                    if complete:
                        while True:
                            try: os.read(fd, 65536)
                            except BlockingIOError: break
            return rows

        monkeypatch.setattr(m.SuiteTree, 'scan', scan)
        result = m.main(['--timeout-seconds', '5', '--kill-grace-seconds', '.1', '--', sys.executable, '-c', code])
        assert observed_root, 'fixture never reached the real setuid ps lifetime'
        receipt = json.loads(next((tmp_path / '.local/state/golems/runs').glob('*.cleanup.json')).read_text())
        assert result == (0 if complete else 70), receipt
        assert receipt['cleanup'] == ('ok' if complete else 'failed'), receipt
        if complete:
            assert not receipt['incomplete'] and not receipt['survivors']
        else:
            pid = int(ready.read_text())
            assert m.proc.identity(pid).uid == 0, 'the real setuid survivor must still be alive'
            assert f'uid-filtered:{pid}' in receipt['incomplete']
            assert pid not in {row['pid'] for row in receipt['signalled']}
    finally:
        # Release our blocked fixture; neither the test nor wrapper needs to
        # signal an unverified or foreign-UID PID to dispose of it.
        while True:
            try: os.read(fd, 65536)
            except BlockingIOError: break
        os.close(fd)
        if ready.exists():
            pid = int(ready.read_text())
            deadline = time.monotonic() + 5
            while m.proc.identity(pid) is not None and time.monotonic() < deadline: time.sleep(.01)
            assert m.proc.identity(pid) is None, 'fixture outlived its released output pipe'
