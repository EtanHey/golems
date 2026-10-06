import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'scripts/agent-browser/agent-browser'


class AgentBrowserTests(unittest.TestCase):
    def setUp(self):
        scratch = ROOT / 'docs.local/agent-browser-tests'
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

    def run_cli(self, command):
        return subprocess.run(['python3', str(SCRIPT), command], env=self.env, capture_output=True, text=True)

    def test_launch_argv_and_private_profile(self):
        result = self.run_cli('start')
        self.assertEqual(result.returncode, 0, result.stderr)
        argv = json.loads((self.home / 'argv').read_text())
        self.assertEqual(argv[:4], ['-g', '-a', 'Google Chrome Beta', '--args'])
        self.assertIn('--remote-debugging-address=127.0.0.1', argv)
        self.assertIn('--remote-debugging-port=9333', argv)
        self.assertIn(f'--user-data-dir={self.profile}', argv)
        self.assertFalse(any('headless' in arg or 'automation' in arg for arg in argv))
        self.assertEqual(self.profile.stat().st_mode & 0o777, 0o700)

    def test_single_instance_and_status(self):
        (self.home / 'running').touch()
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
        children = [subprocess.Popen(['python3', str(SCRIPT), 'start'], env=self.env,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                    for _ in range(2)]
        for child in children:
            stdout, stderr = child.communicate(timeout=10)
            self.assertEqual(child.returncode, 0, stderr)
        self.assertEqual((self.home / 'launches').read_text().splitlines(), ['launch'])

    def test_stopped_status_and_stop(self):
        self.assertIn('stopped pid=none', self.run_cli('status').stdout)
        self.assertEqual(self.run_cli('stop').returncode, 0)
        self.assertFalse((self.home / 'argv').exists())

    def test_starting_process_prevents_second_launch(self):
        (self.home / 'starting').touch()
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

    def test_unknown_command(self):
        self.assertEqual(self.run_cli('wat').returncode, 2)


if __name__ == '__main__':
    unittest.main()
