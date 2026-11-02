import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest import mock
import runpy
import signal
import sys

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'scripts/agent-browser/agent-browser'


class AgentBrowserTests(unittest.TestCase):
    def setUp(self):
        scratch = ROOT / '.worktrees/agent-browser-tests'
        scratch.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=scratch)
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.bin = self.home / 'bin'
        self.bin.mkdir()
        self.profile = self.home / 'Library/Application Support/golems-agent-browser'
        self.env = dict(os.environ, HOME=str(self.home), PATH=f'{self.bin}:{os.environ["PATH"]}')
        self.stub('open', 'import json,sys\nfrom pathlib import Path\np=Path.home()\n(p/"argv").write_text(json.dumps(sys.argv[1:]))\n(p/"running").touch()')
        self.stub('lsof', 'from pathlib import Path\nimport sys\np=Path.home()\nif not (p/"running").exists():sys.exit(1)\nprint("p12345\\nn" + ("*:9333" if (p/"unsafe").exists() else "127.0.0.1:9333"))')
        self.stub('ps', 'from pathlib import Path\nimport sys\np=Path.home()\nif not (p/"running").exists() and not (p/"starting").exists() and not (p/"other_profile").exists():sys.exit(0)\ncommand="/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta --user-data-dir=" + str(p/"Library/Application Support/golems-agent-browser") + " --remote-debugging-port=9333" if not (p/"foreign").exists() else "unrelated browser"\nif (p/"other_profile").exists():command="/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta --user-data-dir=/another-profile"\nprint(("12345 " if "-axo" in sys.argv else "") + command)')

    def stub(self, name, body):
        target = self.bin / name
        target.write_text('#!/usr/bin/env python3\n' + body + '\n')
        target.chmod(0o755)

    def run_cli(self, *arguments):
        # Never signal a real process from a fake-pid fixture, including reaping.
        runner = """
import os, runpy, sys
from pathlib import Path
from unittest import mock
def terminate(pid, sig):
    home = Path.home()
    with (home / 'signals').open('a') as log:
        log.write(f'{pid} {int(sig)}\\n')
    for marker in ('running', 'starting'):
        (home / marker).unlink(missing_ok=True)
sys.argv = sys.argv[1:]
with mock.patch('os.kill', side_effect=terminate):
    runpy.run_path(sys.argv[0], run_name='__main__')
"""
        return subprocess.run(['python3', '-c', runner, str(SCRIPT), *arguments],
                              env=self.env, capture_output=True, text=True)

    def leases(self, value=None):
        target = self.profile / '.leases.json'
        if value is not None:
            self.profile.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(value))
        return json.loads(target.read_text())

    def test_launch_argv_and_private_profile(self):
        result = self.run_cli('start')
        self.assertEqual(result.returncode, 0, result.stderr)
        argv = json.loads((self.home / 'argv').read_text())
        self.assertEqual(argv[:4], ['-g', '-a', '/Applications/Google Chrome Beta.app', '--args'])
        self.assertIn('--remote-debugging-address=127.0.0.1', argv)
        self.assertIn('--remote-debugging-port=9333', argv)
        self.assertIn('--no-startup-window', argv)
        self.assertEqual((self.profile / '.leases.json').stat().st_mode & 0o777, 0o600)
        self.assertIn(f'--user-data-dir={self.profile}', argv)
        self.assertFalse(any('headless' in arg or 'automation' in arg for arg in argv))
        self.assertEqual(self.profile.stat().st_mode & 0o777, 0o700)

    def test_single_instance_and_status(self):
        (self.home / 'running').touch()
        self.leases({'existing': int(time.time()) + 1800})
        result = self.run_cli('start')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('already running', result.stdout)
        self.assertFalse((self.home / 'argv').exists())
        result = self.run_cli('status')
        self.assertEqual(result.returncode, 0, result.stderr)
        for value in ['12345', '9333', '127.0.0.1', str(self.profile)]:
            self.assertIn(value, result.stdout)

    def test_foreign_or_wildcard_listener_refused(self):
        (self.home / 'running').touch()
        for marker in ['foreign', 'unsafe']:
            with self.subTest(marker=marker):
                (self.home / marker).touch()
                result = self.run_cli('start')
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('refusing', result.stderr)
                self.assertNotEqual(self.run_cli('stop').returncode, 0)
                self.assertFalse((self.home / 'argv').exists())
                (self.home / marker).unlink()

    def test_concurrent_starts_launch_once(self):
        self.stub('open', 'import json,sys,time\nfrom pathlib import Path\np=Path.home()\nwith (p/"launches").open("a") as f:f.write("launch\\n")\ntime.sleep(0.1)\n(p/"running").touch()')
        children = [subprocess.Popen(['python3', str(SCRIPT), 'start', '--lease', f'worker-{index}'], env=self.env,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                    for index in range(2)]
        for child in children:
            stdout, stderr = child.communicate(timeout=10)
            self.assertEqual(child.returncode, 0, stderr)
        self.assertEqual((self.home / 'launches').read_text().splitlines(), ['launch'])
        self.assertEqual(set(self.leases()), {'worker-0', 'worker-1'})

    def test_stopped_status_and_stop(self):
        self.assertIn('stopped pid=none', self.run_cli('status').stdout)
        self.assertEqual(self.run_cli('stop').returncode, 0)
        self.assertFalse((self.home / 'argv').exists())

    def test_starting_process_prevents_second_launch(self):
        (self.home / 'starting').touch()
        self.leases({'existing': int(time.time()) + 1800})
        result = self.run_cli('start')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('already starting', result.stderr)
        self.assertFalse((self.home / 'argv').exists())
        self.assertIn('starting pid=12345', self.run_cli('status').stdout)

    def test_other_beta_profile_refused(self):
        (self.home / 'other_profile').touch()
        result = self.run_cli('start')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('another profile', result.stderr)
        self.assertFalse((self.home / 'argv').exists())
        self.assertNotEqual(self.run_cli('stop').returncode, 0)

    def test_bare_beta_binary_refused_without_launch(self):
        self.stub('ps', 'import sys\nprint(("12345 " if "-axo" in sys.argv else "") + "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta")')
        result = self.run_cli('start')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('another profile', result.stderr)
        self.assertFalse((self.home / 'argv').exists())
        self.assertNotEqual(self.run_cli('stop').returncode, 0)

    def test_stop_signals_only_owned_pid(self):
        (self.home / 'running').touch()
        with mock.patch.dict(os.environ, self.env, clear=True):
            module = runpy.run_path(str(SCRIPT), run_name='agent_browser_test')
            def stopped(pid, sig):
                self.assertEqual((pid, sig), (12345, signal.SIGTERM))
                (self.home / 'running').unlink()
            with mock.patch.object(sys, 'argv', ['agent-browser', 'stop']), \
                    mock.patch('os.kill', side_effect=stopped) as kill:
                self.assertEqual(module['main'](), 0)
                kill.assert_called_once_with(12345, signal.SIGTERM)
        self.assertFalse((self.home / 'argv').exists())

    def test_one_lease_release_stops_and_default_name_matches_parent(self):
        self.assertEqual(self.run_cli('start').returncode, 0)
        self.assertEqual(set(self.leases()), {f'pid-{os.getpid()}'})
        result = self.run_cli('release')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('stopped pid=none', result.stdout)
        self.assertEqual(self.leases(), {})
        self.assertEqual((self.home / 'signals').read_text(), f'12345 {int(signal.SIGTERM)}\n')

    def test_two_leases_keep_browser_until_last_release(self):
        for name in ('worker-a', 'worker-b'):
            self.assertEqual(self.run_cli('start', '--lease', name).returncode, 0)
        result = self.run_cli('release', 'worker-a')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('running pid=12345', result.stdout)
        self.assertEqual(set(self.leases()), {'worker-b'})
        self.assertFalse((self.home / 'signals').exists())
        self.assertNotEqual(self.run_cli('stop').returncode, 0)
        self.assertEqual(self.run_cli('release', 'worker-b').returncode, 0)
        self.assertFalse((self.home / 'running').exists())

    def test_renewal_updates_same_lease(self):
        self.assertEqual(self.run_cli('start', '--lease', 'renew', '--ttl', '1m').returncode, 0)
        expiry = self.leases()['renew']
        self.assertEqual(self.run_cli('start', '--lease', 'renew', '--ttl', '1h').returncode, 0)
        self.assertEqual(set(self.leases()), {'renew'})
        self.assertGreater(self.leases()['renew'], expiry + 3000)
        self.assertIn('renew', self.run_cli('status').stdout)

    def test_expiry_reaps_on_every_lifecycle_entry(self):
        for action in ('reap', 'status', 'release', 'start'):
            with self.subTest(action=action):
                (self.home / 'running').touch()
                self.leases({'expired': int(time.time()) - 1})
                result = self.run_cli(action)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn('agent browser stopped', result.stdout)
                self.assertNotIn('expired', self.leases())
                self.assertEqual((self.home / 'running').exists(), action == 'start')

    def test_reap_prunes_only_expired_leases(self):
        (self.home / 'running').touch()
        self.leases({'expired': 1, 'live': int(time.time()) + 100})
        self.assertEqual(self.run_cli('reap').returncode, 0)
        self.assertEqual(set(self.leases()), {'live'})
        self.assertFalse((self.home / 'signals').exists())

    def test_corrupt_leases_fail_closed_without_replacement_or_signal(self):
        (self.home / 'running').touch()
        self.profile.mkdir(parents=True)
        target = self.profile / '.leases.json'
        for contents in ('{broken', '[]', '{"a":true}', '{"a":0}', '{"a":1.5}',
                         '{"a":1,"a":2}', '{"bad name":1}', '{"a":NaN}'):
            target.write_text(contents)
            for action in ('start', 'release', 'reap', 'status', 'stop'):
                with self.subTest(contents=contents, action=action):
                    result = self.run_cli(action)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('corrupt leases file', result.stderr)
                    self.assertEqual(target.read_text(), contents)
                    self.assertFalse((self.home / 'signals').exists())

    def test_symlink_leases_refused(self):
        self.profile.mkdir(parents=True)
        other = self.home / 'other-leases'
        other.write_text('{}')
        (self.profile / '.leases.json').symlink_to(other)
        self.assertNotEqual(self.run_cli('reap').returncode, 0)
        self.assertFalse((self.home / 'signals').exists())
        self.assertEqual(other.read_text(), '{}')

    def test_invalid_start_arguments_do_not_launch(self):
        for arguments in (('--ttl', '0m'), ('--ttl', 'forever'), ('--lease', '../other')):
            self.assertEqual(self.run_cli('start', *arguments).returncode, 2)
        self.assertFalse((self.home / 'argv').exists())

    def test_unknown_command(self):
        self.assertEqual(self.run_cli('wat').returncode, 2)


if __name__ == '__main__':
    unittest.main()
