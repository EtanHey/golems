"""Small live process tests; all fixtures stay in docs.local."""
import errno
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
HOOKS = ROOT / 'scripts/hooks'
sys.path.insert(0, str(HOOKS))
import heavy_watchdog as watchdog

class WatchdogTests(unittest.TestCase):
    def test_session_join_regression(self):
        for isolated in (False, True):
            read, write = os.pipe()
            leader = os.fork()
            if leader == 0:
                os.close(read)
                os.setsid() if isolated else os.setpgid(0, 0)
                os.write(write, b'1')
                os.close(write)
                time.sleep(.5)
                os._exit(0)
            os.close(write)
            os.read(read, 1)
            os.close(read)
            sibling = os.fork()
            if sibling == 0:
                try:
                    os.setpgid(0, leader)
                    os._exit(1 if isolated else 0)
                except OSError as error:
                    os._exit(0 if isolated and error.errno == errno.EPERM else 2)
            _, status = os.waitpid(sibling, 0)
            os.waitpid(leader, 0)
            self.assertEqual(os.waitstatus_to_exitcode(status), 0)

    def run_case(self, source, expected, limit='.2', survived=False):
        (ROOT / 'docs.local').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT/'docs.local') as directory:
            env = {**os.environ, 'HOME': directory}
            for key in list(env):
                if key.startswith('GOLEMS_HEAVY_'): del env[key]
            env['GOLEMS_HEAVY_SUITE_SLOTS'] = '1'
            result = subprocess.run([sys.executable, str(HOOKS/'heavy-suite.py'),
                '--limit-gb',limit,'--kill-grace-seconds','.1','--min-free-gb','0',
                '--max-load','99999','--',sys.executable,'-c',source],env=env,
                text=True,capture_output=True,timeout=20)
            self.assertEqual(result.returncode,expected,result.stderr)
            self.assertIn('SUITE DONE',result.stderr)
            if survived:
                self.assertEqual((Path(directory)/'survived').read_text(), 'yes')
                self.assertFalse((Path(directory)/'signalled').exists())
            return result, list(Path(directory).glob('.*-heavy.log')) and '\n'.join(p.read_text() for p in Path(directory).glob('.*-heavy.log'))

    def test_exit(self):
        result,_ = self.run_case('raise SystemExit(7)',7)
        self.assertIn('cleanup=ok',result.stderr)

    def test_allocator(self):
        sibling = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(6)'])
        try:
            self.run_case('import time; x=bytearray(260*1024*1024); time.sleep(10)',125)
            self.assertIsNone(sibling.poll())
        finally:
            sibling.wait()
        result,log = self.run_case('import time; x=bytearray(260*1024*1024); time.sleep(10)',125)
        self.assertIn('MEMORY_LIMIT',log)
        self.assertIn('cleanup=ok',result.stderr)

    def test_escapee_not_signalled(self):
        # Escapee exits on its own after alarm; no cleanup signal targets its PID.
        source = '''import os,time,signal
from pathlib import Path
if os.fork()==0:
 os.setsid()
 signal.signal(signal.SIGTERM, lambda *_: (Path.home()/'signalled').write_text('yes'))
 time.sleep(.4)
 x=bytearray(260*1024*1024)
 time.sleep(4)
 (Path.home()/'survived').write_text('yes')
 os._exit(0)
time.sleep(10)
'''
        result,log=self.run_case(source,126,survived=True)
        self.assertIn('ALARM unkillable escapee',log)

    def test_term_releases_slot(self):
        import fcntl
        with tempfile.TemporaryDirectory(dir=ROOT/'docs.local') as directory:
            env = {k:v for k,v in os.environ.items() if not k.startswith('GOLEMS_HEAVY_')}
            env['HOME'] = directory
            process = subprocess.Popen([sys.executable,str(HOOKS/'heavy-suite.py'),
                '--limit-gb','8','--kill-grace-seconds','.1','--min-free-gb','0',
                '--max-load','99999','--',sys.executable,'-c','import time; time.sleep(10)'],
                env=env,stderr=subprocess.PIPE,text=True)
            try:
                for line in process.stderr:
                    if 'SUITE START' in line: break
                process.terminate()
                self.assertEqual(process.wait(timeout=10),143)
                slot=Path(directory)/'.local/state/golems/heavy-suite.slot0.lock'
                with slot.open('a+') as stream:
                    fcntl.flock(stream,fcntl.LOCK_EX|fcntl.LOCK_NB)
            finally:
                if process.poll() is None:
                    process.terminate(); process.wait(timeout=10)
                process.stderr.close()

    def test_leader_reaped_after_signals(self):
        from unittest.mock import patch
        events=[]
        class Tree:
            leader=object()
            incomplete=set()
            signalled=[]
            def scan(self, **kw): return {}
        class Child:
            pid=12345
            returncode=None
            def wait(self, **kwargs): events.append('wait')
        with patch.object(os,'killpg',side_effect=lambda p,s: events.append(s)):
            self.assertEqual(watchdog.cleanup_group(Tree(),Child(),0),(True,[]))
        import signal
        self.assertEqual(events,[signal.SIGTERM,signal.SIGKILL,'wait'])

if __name__ == '__main__': unittest.main()
