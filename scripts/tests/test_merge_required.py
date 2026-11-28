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


# Distinct source identities deliberately use colliding names and unrelated IDs.
def collision_cases():
    skipped = dict(id=1, name='suite', status='completed', conclusion='skipped',
                   app={'id': 7}, workflowName='first')
    return {
        'P1_workflows': [skipped, dict(skipped, id=2, conclusion='success', workflowName='second')],
        'P2_apps': [skipped, dict(skipped, id=2, conclusion='success', app={'id': 8})],
        'P3_status_namespace': [skipped, dict(id=999, context='suite', state='success')],
    }


class CollisionTests(unittest.TestCase):
    def test_required_context_preserves_every_source(self):
        for name, rows in collision_cases().items():
            with self.subTest(case=name):
                data = dict(requiredChecks=[('suite', None)], statusCheckRollup=rows)
                self.assertNotEqual(WATCH['checks_verdict'](data), 'green')

    def test_preflight_rejects_source_collisions(self):
        from contextlib import redirect_stdout
        from io import StringIO
        from unittest.mock import patch
        preflight = runpy.run_path(str(ROOT / 'scripts/merge-preflight'))['preflight']
        watch = preflight.__globals__['watch']
        head = 'a' * 40
        pr = dict(headRefOid=head, baseRefName='master', state='OPEN', isDraft=False,
                  mergeStateStatus='CLEAN')
        for name, rows in collision_cases().items():
            with self.subTest(case=name), patch.dict(watch, {
                    'gh_json': lambda *a, **kw: pr,
                    'read_required_checks': lambda *a: [('suite', None)],
                    'read_checks': lambda *a: rows}), redirect_stdout(StringIO()):
                self.assertEqual(preflight('owner/repo', 1, head), 1)

    def test_latest_success_per_source_and_all_sources_green(self):
        from contextlib import redirect_stdout
        from io import StringIO
        from unittest.mock import patch
        rows = collision_cases()['P1_workflows']
        rows.append(dict(rows[0], id=3, conclusion='success'))
        data = dict(requiredChecks=[('suite', None)], statusCheckRollup=rows)
        self.assertEqual(WATCH['checks_verdict'](data), 'green')
        preflight = runpy.run_path(str(ROOT / 'scripts/merge-preflight'))['preflight']
        head = 'a' * 40
        pr = dict(headRefOid=head, baseRefName='master', state='OPEN', isDraft=False,
                  mergeStateStatus='CLEAN')
        with patch.dict(preflight.__globals__['watch'], {
                'gh_json': lambda *a, **kw: pr,
                'read_required_checks': lambda *a: [('suite', None)],
                'read_checks': lambda *a: rows}), redirect_stdout(StringIO()):
            self.assertEqual(preflight('owner/repo', 1, head), 0)


class AdminReceiptTests(unittest.TestCase):
    def test_admin_marker_requires_success_and_behind(self):
        from contextlib import redirect_stdout
        from io import StringIO
        from unittest.mock import patch
        preflight = runpy.run_path(str(ROOT / 'scripts/merge-preflight'))['preflight']
        watch = preflight.__globals__['watch']
        head = 'a' * 40
        for state in ['BEHIND', 'BLOCKED', 'CLEAN', 'UNKNOWN']:
            for conclusion in ['SUCCESS', 'SKIPPED']:
                pr = dict(headRefOid=head, baseRefName='master', state='OPEN', isDraft=False,
                          mergeStateStatus=state)
                rows = [dict(id=1, name='suite', status='COMPLETED', conclusion=conclusion)]
                output = StringIO()
                with self.subTest(state=state, conclusion=conclusion), patch.dict(watch, {
                        'gh_json': lambda *a, **kw: pr,
                        'read_required_checks': lambda *a: [('suite', None)],
                        'read_checks': lambda *a: rows}), redirect_stdout(output):
                    rc = preflight('owner/repo', 1, head)
                self.assertEqual(rc, 0 if conclusion == 'SUCCESS' else 1)
                eligible = conclusion == 'SUCCESS' and state == 'BEHIND'
                self.assertEqual('ADMIN-ELIGIBLE: BEHIND only' in output.getvalue(), eligible)
                self.assertEqual('admin not allowed' in output.getvalue(), not eligible)

    def test_legacy_status_casing_is_consistent(self):
        for state in ['success', 'SUCCESS']:
            check = dict(id=1, context='suite', state=state)
            self.assertTrue(WATCH['check_success'](check))
            self.assertEqual(WATCH['checks_verdict'](dict(
                statusCheckRollup=[check], requiredChecks=[('suite', None)])), 'green')


if __name__ == '__main__':
    unittest.main()
