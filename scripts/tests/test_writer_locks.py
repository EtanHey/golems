"""Real entry-point regressions for stale ownership and concurrent state writers."""
import fcntl
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class WriterLocks(unittest.TestCase):
    def setUp(self):
        scratch = ROOT / 'docs.local/writer-lock-tests'
        scratch.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=scratch)
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)

    def test_reused_pid_does_not_block_guard(self):
        log = self.home / 'Gits/golems/docs.local/stalker-golem'
        log.mkdir(parents=True)
        (log / 'live-guard.pid').write_text(str(os.getpid()))
        # Stop at the first live check: no network or launchd operations.
        bin_dir = self.home / 'bin'
        bin_dir.mkdir()
        probe = bin_dir / 'yt-dlp'
        probe.write_text('#!/bin/sh\necho reached > "$HOME/reached"\nkill -TERM "$PPID"\nexit 1\n')
        probe.chmod(0o755)
        result = subprocess.run(['bash', str(ROOT / 'scripts/stalker/stalker-live-guard.sh'), 'fixture'],
                                env=dict(os.environ, HOME=str(self.home), PATH=f'{bin_dir}:/usr/bin:/bin'),
                                capture_output=True, text=True, timeout=15)
        self.assertTrue((self.home / 'reached').exists(), result.stdout + result.stderr)

    def test_competing_watcher_cannot_touch_locked_state(self):
        gh = self.home / 'gh'
        gh.write_text('#!/bin/sh\necho unexpected-gh-call >&2\nexit 1\n')
        gh.chmod(0o755)
        state = self.home / 'state.json'
        state.write_text('{"retries_by_sha": {"head": 2}}')
        with Path(str(state) + '.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            result = subprocess.run([str(ROOT / 'scripts/pr-watch'), 'o/r', '1',
                                     '--head', 'a' * 40, '--state-file', str(state), '--deadline', '1s'],
                                    env=dict(os.environ, PATH=f'{self.home}:/usr/bin:/bin'),
                                    capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 30, result.stdout + result.stderr)
        self.assertIn('state file already watched', result.stderr)
        self.assertEqual(state.read_text(), '{"retries_by_sha": {"head": 2}}')


if __name__ == '__main__':
    unittest.main()
