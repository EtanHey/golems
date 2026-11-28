"""Required-check fixtures exercise the real readiness predicate, including reruns."""
import os
import runpy
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WATCH = runpy.run_path(str(Path(os.environ.get('MERGE_RULE_ROOT', ROOT)) / 'scripts/pr-watch'))


class RequiredCheckTests(unittest.TestCase):
    def verdict(self, rows):
        return WATCH['checks_verdict'](dict(requiredChecks=[('suite', None)], statusCheckRollup=rows))

    def row(self, conclusion='success', status='completed', id=1):
        return dict(id=id, name='suite', status=status, conclusion=conclusion)

    def test_skipped_required_suite(self):
        self.assertNotEqual(self.verdict([self.row('skipped')]), 'green')

    def test_queued_required_suite(self):
        self.assertNotEqual(self.verdict([self.row(None, 'queued')]), 'green')

    def test_cancelled_required_suite(self):
        self.assertNotEqual(self.verdict([self.row('cancelled')]), 'green')

    def test_missing_required_suite(self):
        self.assertNotEqual(self.verdict([dict(context='other', state='SUCCESS')]), 'green')

    def test_latest_rerun_success(self):
        self.assertEqual(self.verdict([self.row('failure'), self.row(id=2)]), 'green')

    def test_latest_queued_rerun_blocks_old_green(self):
        self.assertNotEqual(self.verdict([self.row(), self.row(None, 'queued', 2)]), 'green')

    def test_neutral_required_suite(self):
        self.assertNotEqual(self.verdict([self.row('neutral')]), 'green')

    def test_all_green(self):
        self.assertEqual(self.verdict([self.row()]), 'green')

    def test_optional_skipped_control(self):
        self.assertEqual(self.verdict([self.row(), dict(id=2, name='optional', status='completed', conclusion='skipped')]), 'green')


if __name__ == '__main__':
    unittest.main()


class PreflightTests(unittest.TestCase):
    def test_fixture_states_and_head_confirmation(self):
        from contextlib import redirect_stdout
        from io import StringIO
        from unittest.mock import patch
        ns = runpy.run_path(str(ROOT / 'scripts/merge-preflight'))
        preflight = ns['preflight']
        watch = preflight.__globals__['watch']
        head = 'a' * 40
        pr = dict(headRefOid=head, baseRefName='master', state='OPEN', isDraft=False)
        for conclusion, status, expected in [('skipped', 'completed', 1), (None, 'queued', 1),
                ('cancelled', 'completed', 1), ('success', 'completed', 0)]:
            with self.subTest(conclusion=conclusion), patch.dict(watch, {
                'gh_json': lambda *a, **kw: pr,
                'read_required_checks': lambda *a: [('suite', None)],
                'read_checks': lambda *a: [dict(id=1, name='suite', status=status, conclusion=conclusion)]
            }), redirect_stdout(StringIO()):
                self.assertEqual(preflight('owner/repo', 1, head), expected)
        for rows in [[], [dict(id=1, name='other', status='completed', conclusion='success')]]:
            with patch.dict(watch, {'gh_json': lambda *a, **kw: pr,
                    'read_required_checks': lambda *a: [('suite', None)], 'read_checks': lambda *a: rows}), redirect_stdout(StringIO()):
                self.assertEqual(preflight('owner/repo', 1, head), 1)
        with patch.dict(watch, {'gh_json': lambda *a, **kw: dict(pr, isDraft=True)}), redirect_stdout(StringIO()):
            self.assertEqual(preflight('owner/repo', 1, head), 1)
        reads = iter([pr, dict(pr, headRefOid='b' * 40)])
        with patch.dict(watch, {'gh_json': lambda *a, **kw: next(reads),
                'read_required_checks': lambda *a: [('suite', None)],
                'read_checks': lambda *a: [dict(id=1, name='suite', status='completed', conclusion='success')]}), redirect_stdout(StringIO()):
            self.assertEqual(preflight('owner/repo', 1, head), 1)
