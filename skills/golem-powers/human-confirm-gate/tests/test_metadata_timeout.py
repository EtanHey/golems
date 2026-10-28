"""FX6: slow read-only GitHub metadata may retry once; local reads stay bounded."""
import contextlib
import io
import json
import subprocess
import sys
import unittest
from unittest.mock import patch

import test_lead_issuer as lead
import tokens


class MetadataTimeout(lead.Fixture, unittest.TestCase):
    def setUp(self):
        self.make()
        self.calls = self.home / 'gh-calls'
        self.fake = self.home / 'gh'
        self.stderr = io.StringIO()

    def fake_gh(self, mode):
        self.fake.write_text(f'''#!{sys.executable}
import json, pathlib, sys, time
calls = pathlib.Path({str(self.calls)!r})
with calls.open('a') as stream:
    stream.write(' '.join(sys.argv[1:3]) + '\\n')
if sys.argv[1:3] == ['repo', 'view']:
    if {mode!r} == 'slow': time.sleep(3)
    if {mode!r} == 'hung' or ({mode!r} == 'once' and len(calls.read_text().splitlines()) == 1):
        time.sleep(16)
    print(json.dumps({{'defaultBranchRef': {{'name': 'develop'}}}}))
else:
    print(json.dumps({self.pr!r}))
''')
        self.fake.chmod(0o700)

    def issue_real_reads(self):
        with patch.object(tokens, 'GH_CANDIDATES', (str(self.fake),)), contextlib.redirect_stderr(self.stderr):
            return self.issuer.issue([str(self.repo), '--ref', 'refs/heads/topic', '--sha', lead.SHA,
                                      '--session', 'timeout-fixture'], home=self.home,
                                     anchor_fn=lambda _: self.anchor)

    def test_issuer_tolerates_three_second_gh(self):
        self.fake_gh('slow')
        self.assertEqual(json.loads(self.issue_real_reads().read_text())['kind'], 'lead')
        self.assertEqual(self.calls.read_text().splitlines(), ['repo view', 'pr view'])
        self.assertEqual(self.stderr.getvalue(), '')

    def test_gh_past_bound_refuses_without_a_token(self):
        self.fake_gh('hung')
        with self.assertRaises(subprocess.TimeoutExpired):
            self.issue_real_reads()
        self.assertEqual(self.calls.read_text().splitlines(), ['repo view', 'repo view'])
        self.assertEqual(self.store(), [])
        self.assertEqual(self.stderr.getvalue().count('retrying once'), 1)

    def test_gh_timeout_once_then_answers_issues_after_one_retry(self):
        self.fake_gh('once')
        self.assertTrue(self.issue_real_reads().is_file())
        self.assertEqual(self.calls.read_text().splitlines(), ['repo view', 'repo view', 'pr view'])
        self.assertEqual(self.stderr.getvalue().count('retrying once'), 1)

    def test_local_read_timeout_is_two_seconds_without_retry(self):
        for binary in (tokens.GIT, tokens.SSH):
            with self.subTest(binary=binary):
                argv = [binary, 'fixture-read']
                with patch.object(tokens.subprocess, 'run', side_effect=subprocess.TimeoutExpired(argv, 2)) as run:
                    with self.assertRaises(subprocess.TimeoutExpired):
                        tokens.read_command(argv)
                self.assertEqual(run.call_count, 1)
                self.assertEqual(run.call_args.kwargs['timeout'], 2)

    def test_both_metadata_reads_use_fifteen_seconds_and_retry_only_timeout(self):
        with patch.object(tokens, 'GH_CANDIDATES', (str(self.fake),)):
            self.fake_gh('fast')
            for verb in ('repo', 'pr'):
                argv = [str(self.fake), verb, 'view', 'fixture', '--json', 'number']
                ok = subprocess.CompletedProcess(argv, 0, ' {} \n', '')
                notice = io.StringIO()
                with patch.object(tokens.subprocess, 'run', side_effect=[subprocess.TimeoutExpired(argv, 15), ok]) as run:
                    with contextlib.redirect_stderr(notice):
                        self.assertEqual(self.issuer.read_metadata(argv), '{}')
                self.assertEqual(notice.getvalue(),
                                 'golems-lead-confirm: GitHub metadata probe timed out; retrying once\n')
                self.assertEqual(run.call_count, 2)
                self.assertEqual([call.kwargs['timeout'] for call in run.call_args_list], [15, 15])
                for error in (subprocess.CalledProcessError(1, argv), OSError('unavailable')):
                    with patch.object(tokens.subprocess, 'run', side_effect=error) as run:
                        with self.assertRaises(type(error)):
                            self.issuer.read_metadata(argv)
                    self.assertEqual(run.call_count, 1)

    def test_gh_write_and_other_reads_never_retry(self):
        for args in (['pr', 'edit'], ['repo', 'delete'], ['api', 'repos/o/r']):
            argv = [str(self.fake), *args]
            with self.subTest(args=args):
                with patch.object(tokens.subprocess, 'run', side_effect=subprocess.TimeoutExpired(argv, 2)) as run:
                    with self.assertRaises(subprocess.TimeoutExpired):
                        tokens.read_command(argv)
                self.assertEqual(run.call_count, 1)

                with patch.object(tokens.subprocess, 'run') as run:
                    with self.assertRaises(ValueError):
                        self.issuer.read_metadata(argv)
                run.assert_not_called()

    def test_hook_metadata_gh_budget_is_below_every_host_manifest_timeout(self):
        self.fake_gh('fast')
        op = dict(repo=str(self.repo), ref='refs/heads/topic', source='HEAD', remote='origin')
        responses = ['topic', 'git@github.com:o/r.git',
                     json.dumps(dict(defaultBranchRef=dict(name='develop'))), json.dumps(self.pr)]
        with patch.object(tokens, 'GH_CANDIDATES', (str(self.fake),)):
            with patch.object(tokens.subprocess, 'run', side_effect=[
                    subprocess.CompletedProcess([], 0, value, '') for value in responses]) as run:
                tokens.lead_metadata(op)
        gh_timeouts = [call.kwargs['timeout'] for call in run.call_args_list if call.args[0][0] == str(self.fake)]
        self.assertEqual(gh_timeouts, [2, 2])
        manifest = json.loads((lead.ROOT.parents[2] / 'scripts/hooks/manifest.json').read_text())
        budgets = [(host, hook['timeout']) for host, hooks in manifest['hosts'].items()
                   for hook in hooks if hook['id'] == 'human-confirm-gate']
        self.assertTrue(budgets, 'manifest must register the human-confirm gate')
        for host, budget in budgets:
            with self.subTest(host=host):
                self.assertLess(sum(gh_timeouts), budget)


if __name__ == '__main__':
    unittest.main()
