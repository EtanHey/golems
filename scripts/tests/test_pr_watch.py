import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'scripts/pr-watch'
HEAD = 'a' * 40


def snapshot(checks=None, head=HEAD, state='OPEN'):
    return dict(headRefOid=head, state=state, reviewDecision='',
                statusCheckRollup=checks or [])


class PrWatchTests(unittest.TestCase):
    def setUp(self):
        scratch = ROOT / 'docs.local/pr-watch-tests'
        scratch.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=scratch)
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        gh = self.home / 'gh'
        gh.write_text('''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
p = Path(os.environ['FIXTURE_DIR'])
steps = json.loads((p / 'steps').read_text())
n = int((p / 'calls').read_text()) if (p / 'calls').exists() else 0
(p / 'calls').write_text(str(n + 1))
with (p / 'argv').open('a') as f: f.write(json.dumps(sys.argv[1:]) + '\\n')
step = steps[min(n, len(steps) - 1)]
if 'sleep' in step:
    import time
    time.sleep(step['sleep'])
if 'raw' in step:
    print(step['raw'])
    sys.exit(0)
if 'error' in step:
    sys.stderr.write(step['error'])
    sys.exit(1)
print(json.dumps(step))
''')
        gh.chmod(0o755)

    def run_watch(self, steps, deadline='1s', retries=0):
        (self.home / 'steps').write_text(json.dumps(steps))
        env = dict(os.environ, FIXTURE_DIR=str(self.home),
                   PATH=f'{self.home}:{os.environ["PATH"]}')
        result = subprocess.run([str(SCRIPT), 'owner/repo', '42', '--head', HEAD,
                                 '--deadline', deadline, '--poll-seconds', '0.001',
                                 '--max-gh-retries', str(retries), '--state-file',
                                 str(self.home / 'state.json')],
                                env=env, capture_output=True, text=True, timeout=5)
        self.assertEqual(len(result.stdout.splitlines()), 1, result.stdout)
        event = json.loads(result.stdout)
        self.assertEqual(event['sha'], HEAD)
        return result, event

    def test_empty_rollup_never_ready(self):
        result, event = self.run_watch([snapshot()])
        self.assertEqual((result.returncode, event['event']), (20, 'DEADLINE'))

    def test_head_moved(self):
        result, event = self.run_watch([snapshot(head='b' * 40)])
        self.assertEqual((result.returncode, event['event']), (11, 'HEAD_MOVED'))
        self.assertEqual(event['observed_sha'], 'b' * 40)

    def test_gh_error_verbatim(self):
        for error in ['gh: HTTP 401\n', '  HTTP 403: rate limit\n\n']:
            with self.subTest(error=error):
                result, event = self.run_watch([dict(error=error)])
                self.assertEqual((result.returncode, event['event']), (30, 'GH_ERROR'))
                self.assertEqual(result.stderr, error)

    def test_pending_polls_are_silent(self):
        result, event = self.run_watch([snapshot([dict(status='IN_PROGRESS')])])
        self.assertEqual(event['event'], 'DEADLINE')
        self.assertGreater(int((self.home / 'calls').read_text()), 1)

    def test_failed_is_not_ready_even_with_pending(self):
        result, event = self.run_watch([snapshot([dict(status='COMPLETED', conclusion='FAILURE'),
                                                  dict(status='IN_PROGRESS')])])
        self.assertEqual((result.returncode, event['event']), (10, 'FAILED'))

    def test_green_checks_ready(self):
        result, event = self.run_watch([snapshot([dict(status='COMPLETED', conclusion='SUCCESS')])])
        self.assertEqual((result.returncode, event['event']), (0, 'READY'))
        self.assertIn('review_decision', event)

    def test_head_moves_during_green_read(self):
        green = snapshot([dict(status='COMPLETED', conclusion='SUCCESS')])
        result, event = self.run_watch([green, snapshot(head='b' * 40)])
        self.assertEqual((result.returncode, event['event']), (11, 'HEAD_MOVED'))

    def test_unknown_check_never_ready(self):
        result, event = self.run_watch([snapshot([dict(state='MYSTERY')])])
        self.assertEqual((result.returncode, event['event']), (20, 'DEADLINE'))

    def test_closed_pr_fails(self):
        result, event = self.run_watch([snapshot(state='CLOSED')])
        self.assertEqual((result.returncode, event['event']), (10, 'FAILED'))

    def test_retry_budget_is_bounded(self):
        result, event = self.run_watch([dict(error='unavailable\n')], '1s', retries=1)
        self.assertEqual((result.returncode, event['event']), (30, 'GH_ERROR'))
        self.assertEqual(int((self.home / 'calls').read_text()), 2)
        self.assertEqual(json.loads((self.home / 'state.json').read_text())['retries_by_sha'][HEAD], 1)

    def test_legacy_status_context(self):
        result, event = self.run_watch([snapshot([dict(state='SUCCESS')])])
        self.assertEqual((result.returncode, event['event']), (0, 'READY'))

    def test_missing_rollup_is_error(self):
        data = snapshot()
        del data['statusCheckRollup']
        result, event = self.run_watch([data])
        self.assertEqual((result.returncode, event['event']), (30, 'GH_ERROR'))

    def test_malformed_json_is_error(self):
        result, event = self.run_watch([dict(raw='not JSON')])
        self.assertEqual((result.returncode, event['event']), (30, 'GH_ERROR'))

    def test_hung_gh_respects_deadline(self):
        result, event = self.run_watch([dict(sleep=10)], '250ms')
        self.assertEqual((result.returncode, event['event']), (20, 'DEADLINE'))

    def test_state_corruption_is_error(self):
        (self.home / 'state.json').write_text('not JSON')
        result, event = self.run_watch([snapshot()])
        self.assertEqual((result.returncode, event['event']), (30, 'GH_ERROR'))
        self.assertFalse((self.home / 'calls').exists())

    def test_malformed_retry_state_is_error(self):
        (self.home / 'state.json').write_text(json.dumps(dict(retries_by_sha='bad')))
        result, event = self.run_watch([dict(error='unavailable\n')])
        self.assertEqual((result.returncode, event['event']), (30, 'GH_ERROR'))
        self.assertFalse((self.home / 'calls').exists())

    def test_observation_does_not_write_github(self):
        self.run_watch([snapshot([dict(state='SUCCESS')])])
        for argv in (self.home / 'argv').read_text().splitlines():
            self.assertEqual(json.loads(argv)[:5], ['--repo', 'owner/repo', 'pr', 'view', '42'])


if __name__ == '__main__':
    unittest.main()
