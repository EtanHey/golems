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
    def test_memory_rows_ignores_continuation_lines(self):
        from unittest.mock import patch
        with patch.object(watchdog.sys, "platform", "linux"), patch.object(subprocess, "check_output", return_value="123 2048 /bin/python\ncontinued command text\n"):
            self.assertEqual(watchdog.memory_rows(), {123: (2048 * 1024, "/bin/python", "rss")})

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

    def run_case(self, source, expected, limit='.2', survived=False, absent=False, non_darwin=False):
        (ROOT / 'docs.local').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT/'docs.local') as directory:
            env = {**os.environ, 'HOME': directory}
            for key in list(env):
                if key.startswith('GOLEMS_HEAVY_'): del env[key]
            env['GOLEMS_HEAVY_SUITE_SLOTS'] = '1'
            helper_path = str(HOOKS/'heavy-suite.py')
            launcher = [sys.executable, helper_path]
            if non_darwin:
                # Change only the watchdog's platform view: native process identity stays Darwin.
                launcher = [sys.executable, '-c',
                    'import runpy,sys; from types import SimpleNamespace; '
                    f'sys.path.insert(0,{str(HOOKS)!r}); import heavy_watchdog as w; '
                    'w.sys=SimpleNamespace(platform="linux",stderr=sys.stderr); '
                    f'runpy.run_path({helper_path!r},run_name="__main__")']
            result = subprocess.run([*launcher,
                '--limit-gb',limit,'--kill-grace-seconds','.1','--min-free-gb','0',
                '--max-load','99999','--',sys.executable,'-c',source],env=env,
                text=True,capture_output=True,timeout=20)
            self.assertEqual(result.returncode,expected,result.stderr)
            self.assertIn('CLEANUP FAILED' if expected == 70 else 'SUITE DONE',result.stderr)
            if absent:
                self.assertFalse((Path(directory)/'survived').exists())
            if survived:
                self.assertEqual((Path(directory)/'survived').read_text(), 'yes')
                self.assertFalse((Path(directory)/'signalled').exists())
            if non_darwin:
                from unittest.mock import patch
                from types import SimpleNamespace
                with patch.object(watchdog, 'sys', SimpleNamespace(platform='linux')):
                    alarm = watchdog.log_path(directory)
            else:
                alarm = watchdog.log_path(directory)
            if expected in (125,126):
                self.assertTrue(alarm.is_file(), f'missing alarm log: {alarm}\n{result.stderr}')
            return result, alarm.read_text() if alarm.is_file() else ''

    def test_non_darwin_alarm_logs(self):
        _, log = self.run_case('import time; x=bytearray(260*1024*1024); time.sleep(10)',
            125, non_darwin=True)
        self.assertIn('MEMORY_LIMIT', log)
        self.assertIn('metric=rss', log)
        source = 'import os,time; from pathlib import Path\nif os.fork()==0:\n os.setsid()\n time.sleep(.4)\n x=bytearray(260*1024*1024)\n time.sleep(4)\n (Path.home()/"survived").write_text("yes")\n os._exit(0)\ntime.sleep(10)\n'
        _, log = self.run_case(source,126,survived=True,non_darwin=True)
        self.assertIn('ALARM unkillable escapee', log)
        self.assertIn('metric=rss', log)

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
        # subprocess.run waits for the escapee to close inherited stdout/stderr.
        # Its marker proves voluntary survival after the alarm, without TERM.
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
        for launch in ('os.setsid()', 'os.setpgid(0, 0)'):
            result,log=self.run_case(source.replace('os.setsid()', launch),126,survived=True)
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

    @unittest.skipUnless(sys.platform == 'darwin', 'Darwin native API')
    def test_darwin_live_footprint(self):
        child = subprocess.Popen([sys.executable, '-c',
            'import sys; x=bytearray(300*1024*1024); print("ready",flush=True); sys.stdin.read(1)'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(child.stdout.readline().strip(), 'ready')
            rows = watchdog.memory_rows({child.pid})
            self.assertEqual(rows[child.pid][2], 'phys_footprint')
            self.assertGreaterEqual(rows[child.pid][0], 280*1024*1024)
        finally:
            child.communicate('x', timeout=10)

    def test_per_pid_fallback(self):
        from unittest.mock import patch
        with patch.object(watchdog.sys, 'platform', 'darwin'), \
             patch.object(subprocess, 'check_output', return_value='123 2048 python\n124 4096 bun\n'), \
             patch.object(watchdog, 'physical_footprint', side_effect=[123456, OSError('denied')]):
            rows = watchdog.memory_rows()
            self.assertEqual(rows[123], (123456, 'python', 'phys_footprint'))
            self.assertEqual(rows[124], (4096*1024, 'bun', 'rss_fallback'))

    def test_log_failure_preserves_alarm(self):
        from unittest.mock import patch
        import io
        stream = io.StringIO()
        with patch.object(Path, 'open', side_effect=OSError('denied')), patch.object(sys, 'stderr', stream):
            self.assertEqual(watchdog.log_limit('test', 1024**3, [], 123), 125)
        self.assertIn('MEMORY_LIMIT',stream.getvalue())
        self.assertIn('1.000GiB',stream.getvalue())
        with tempfile.TemporaryDirectory(dir=ROOT/'docs.local') as directory, \
             patch.object(watchdog.sys, 'platform', 'linux'), patch.dict(os.environ, {'HOME':directory}):
            self.assertEqual(watchdog.log_limit('test', 1024**3, [], 123),125)
            self.assertTrue((Path(directory)/'.heavy-run.log').is_file())
            self.assertFalse((Path(directory)/'.m4-heavy.log').exists())

    def test_leader_dies_first_live(self):
        self.run_case('import os,signal,time; from pathlib import Path; '
            'os.kill(os.getppid(),signal.SIGKILL); time.sleep(2); '
            '(Path.home()/"survived").write_text("yes")',70,absent=True)

    def test_admission_refusals(self):
        import fcntl
        with tempfile.TemporaryDirectory(dir=ROOT/'docs.local') as directory:
            env = {k:v for k,v in os.environ.items() if not k.startswith('GOLEMS_HEAVY_')}
            env.update(HOME=directory, GOLEMS_HEAVY_SUITE_SLOTS='1')
            command = [sys.executable,str(HOOKS/'heavy-suite.py'),'--limit-gb','8',
                '--min-free-gb','0','--max-load','99999','--poll-seconds','.01',
                '--max-wait-seconds','.05','--',sys.executable,'-c','raise SystemExit(99)']
            result = subprocess.run(command,env={**env,'GOLEMS_HEAVY_FORCE':'1'},capture_output=True,text=True)
            self.assertEqual(result.returncode,75,result.stderr)
            slot=Path(directory)/'.local/state/golems/heavy-suite.slot0.lock'
            slot.parent.mkdir(parents=True)
            with slot.open('a+') as stream:
                fcntl.flock(stream,fcntl.LOCK_EX)
                result=subprocess.run(command,env=env,capture_output=True,text=True,timeout=5)
                self.assertEqual(result.returncode,75,result.stderr)
                self.assertIn('slot wait timed out',result.stderr)
            bad = Path(directory)/'not-a-directory'
            bad.write_text('fixture')
            result=subprocess.run(command,env={**env,'GOLEMS_HEAVY_LOCK':str(bad/'lock')},
                capture_output=True,text=True,timeout=5)
            self.assertEqual(result.returncode,75,result.stderr)
            self.assertIn('lock unavailable; refusing START',result.stderr)

    def test_unexpected_exception_cleans_group(self):
        from unittest.mock import patch
        spec = importlib.util.spec_from_file_location('watchdog_exception_suite', HOOKS/'heavy-suite.py')
        suite = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(suite)
        with tempfile.TemporaryDirectory(dir=ROOT/'docs.local') as directory, \
             patch.dict(os.environ, {'HOME':directory}), \
             patch.object(watchdog, 'measure', side_effect=TypeError('injected')), \
             patch.object(watchdog, 'cleanup_group', wraps=watchdog.cleanup_group) as cleanup:
            import signal
            previous = signal.signal(signal.SIGCHLD, signal.SIG_IGN)
            try:
                self.assertEqual(suite.run_command([sys.executable,'-c','import time; time.sleep(5)'],
                    grace=.05,limit_gb=8),70)
                self.assertEqual(cleanup.call_count,1)
                self.assertIsNotNone(cleanup.call_args.args[1].returncode)
                self.assertEqual(signal.getsignal(signal.SIGCHLD), signal.SIG_IGN)
            finally:
                signal.signal(signal.SIGCHLD, previous)

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
        with patch.object(os,'killpg',side_effect=lambda p,s: events.append(s)), \
             patch.object(watchdog.time, 'sleep', side_effect=AssertionError('unnecessary grace')):
            self.assertEqual(watchdog.cleanup_group(Tree(),Child(),5),(True,[]))
        import signal
        self.assertEqual(events,[signal.SIGTERM,signal.SIGKILL,'wait'])

if __name__ == '__main__': unittest.main()
