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
                'read_required_policy': lambda *a: ([('suite', None)], True),
                'read_checks': lambda *a: [dict(id=1, name='suite', status=status, conclusion=conclusion)]
            }), redirect_stdout(StringIO()):
                self.assertEqual(preflight('owner/repo', 1, head), expected)
        for rows in [[], [dict(id=1, name='other', status='completed', conclusion='success')]]:
            with patch.dict(watch, {'gh_json': lambda *a, **kw: pr,
                    'read_required_policy': lambda *a: ([('suite', None)], True), 'read_checks': lambda *a: rows}), redirect_stdout(StringIO()):
                self.assertEqual(preflight('owner/repo', 1, head), 1)
        with patch.dict(watch, {'gh_json': lambda *a, **kw: dict(pr, isDraft=True)}), redirect_stdout(StringIO()):
            self.assertEqual(preflight('owner/repo', 1, head), 1)
        reads = iter([pr, dict(pr, headRefOid='b' * 40)])
        with patch.dict(watch, {'gh_json': lambda *a, **kw: next(reads),
                'read_required_policy': lambda *a: ([('suite', None)], True),
                'read_checks': lambda *a: [dict(id=1, name='suite', status='completed', conclusion='success')]}), redirect_stdout(StringIO()):
            self.assertEqual(preflight('owner/repo', 1, head), 1)


# Distinct source identities deliberately use colliding names and unrelated IDs.
def collision_cases():
    skipped = dict(id=1, name='suite', status='completed', conclusion='skipped',
                   app={'id': 7}, workflowName='first', workflow_id=501)
    return {
        'P1_workflows': [skipped, dict(skipped, id=2, conclusion='success', workflowName='second', workflow_id=502)],
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
                    'read_required_policy': lambda *a: ([('suite', None)], True),
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
                'read_required_policy': lambda *a: ([('suite', None)], True),
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
                        'read_required_policy': lambda *a: ([('suite', None)], True),
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


class PolicyAndWorkflowTests(unittest.TestCase):
    def gate(self, rows, before, after, strict):
        from contextlib import redirect_stdout
        from io import StringIO
        from unittest.mock import patch
        preflight = runpy.run_path(str(ROOT / 'scripts/merge-preflight'))['preflight']
        reads = iter([before, after])
        out = StringIO()
        with patch.dict(preflight.__globals__['watch'], {
                'gh_json': lambda *a, **kw: next(reads),
                'read_required_policy': lambda *a: ([('suite', None)], strict),
                'read_checks': lambda *a: rows}), redirect_stdout(out):
            rc = preflight('owner/repo', 1, 'a' * 40)
        return rc, out.getvalue()

    def test_lazy_merge_state_change_does_not_change_pr_identity(self):
        pr = dict(headRefOid='a' * 40, baseRefName='master', state='OPEN', isDraft=False,
                  mergeStateStatus='UNKNOWN')
        rows = [dict(id=1, name='suite', status='completed', conclusion='success')]
        for state in ['BEHIND', 'CLEAN']:
            rc, out = self.gate(rows, pr, dict(pr, mergeStateStatus=state), True)
            self.assertEqual(rc, 0)
            self.assertNotIn('head/base/state/draft changed', out)
            self.assertEqual('ADMIN-ELIGIBLE' in out, state == 'BEHIND')
        rc, out = self.gate(rows, pr, dict(pr, mergeStateStatus='BEHIND'), False)
        self.assertEqual(rc, 0)
        self.assertIn('admin not allowed: up-to-date not required', out)
        self.assertNotIn('ADMIN-ELIGIBLE', out)
        for field, value in [('headRefOid', 'b' * 40), ('baseRefName', 'other'),
                             ('state', 'CLOSED'), ('isDraft', True)]:
            rc, out = self.gate(rows, pr, dict(pr, **{field: value}), True)
            self.assertEqual(rc, 1, field)
            self.assertNotIn('ADMIN-ELIGIBLE', out)

    def test_ruleset_and_classic_strict_policy(self):
        from types import SimpleNamespace
        from unittest.mock import patch
        read = WATCH['read_required_policy']
        args = SimpleNamespace(repo='owner/repo')
        for ruleset_strict, classic_strict, ruleset_contexts, expected in [
                (True, False, True, True), (False, True, True, True),
                (False, False, True, False), (False, True, False, True),
                (False, False, False, False)]:
            rules = [dict(type='required_status_checks', parameters=dict(
                required_status_checks=[dict(context='suite')] if ruleset_contexts else [],
                strict_required_status_checks_policy=ruleset_strict))]
            protection = dict(required_status_checks=dict(contexts=['classic'], checks=[], strict=classic_strict))
            with self.subTest(ruleset=ruleset_strict, classic=classic_strict, contexts=ruleset_contexts), patch.dict(read.__globals__, {
                    'api_list': lambda *a: rules, 'gh_json': lambda *a, **kw: protection}):
                contexts, strict = read(args, 'master', 100)
            self.assertEqual(strict, expected)
            self.assertEqual(contexts, [('suite' if ruleset_contexts else 'classic', None)])

    def test_same_display_name_workflow_files_remain_distinct(self):
        import copy
        from types import SimpleNamespace
        from unittest.mock import patch
        head = 'a' * 40
        reader = WATCH['read_checks']
        checks, runs, fixtures = [], [], {}
        base = 'repos/owner/repo'
        for job_id, run_id, suite_id, workflow_id, conclusion in [
                (1, 101, 201, 501, 'skipped'), (2, 102, 202, 502, 'success')]:
            job = dict(id=job_id, name='suite', status='completed', conclusion=conclusion)
            checks.append(dict(job, app={'id': 7}, check_suite={'id': suite_id}))
            runs.append(dict(id=run_id, head_sha=head, check_suite_id=suite_id,
                             workflow_id=workflow_id, name='CI', status='completed', conclusion='success'))
            fixtures[f'{base}/actions/runs/{run_id}/jobs?filter=all'] = [job]
        fixtures[f'{base}/commits/{head}/check-runs?filter=all'] = checks
        fixtures[f'{base}/actions/runs?head_sha={head}'] = runs
        fixtures[f'{base}/commits/{head}/statuses'] = []
        with patch.dict(reader.__globals__, {'api_list': lambda endpoint, *a: copy.deepcopy(fixtures[endpoint])}):
            rows = reader(SimpleNamespace(repo='owner/repo', head=head), 100)
        data = dict(requiredChecks=[('suite', None)], statusCheckRollup=rows)
        self.assertNotEqual(WATCH['checks_verdict'](data), 'green')
        pr = dict(headRefOid=head, baseRefName='master', state='OPEN', isDraft=False, mergeStateStatus='BEHIND')
        rc, out = self.gate(rows, pr, pr, True)
        self.assertEqual(rc, 1)
        self.assertNotIn('ADMIN-ELIGIBLE', out)


if __name__ == '__main__':
    unittest.main()
