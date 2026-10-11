import json
import runpy
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr
from io import StringIO
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'scripts/pr-watch'
HEAD = 'a' * 40


def snapshot(checks=None, head=HEAD, state='OPEN'):
    return dict(headRefOid=head, state=state, reviewDecision='', baseRefName='master',
                statusCheckRollup=[dict(row, **({'name': row.get('name', f'check-{i}')}
                    if 'status' in row else {'context': row.get('context', f'context-{i}')}))
                    for i, row in enumerate(checks or [])])


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
if sys.argv[1] == 'api':
    from urllib.parse import urlsplit, parse_qs
    url = urlsplit(sys.argv[2]); query = parse_qs(url.query)
    page = int(query.get('page', ['1'])[0]); size = int(query.get('per_page', ['100'])[0])
    with (p / 'argv').open('a') as f: f.write(json.dumps(sys.argv[1:]) + '\\n')
    if (p / 'api').exists():
        fixtures = json.loads((p / 'api').read_text())
        if url.path in fixtures:
            data = fixtures[url.path]
            if isinstance(data, dict) and 'error' in data:
                sys.stdout.write(data.get('stdout', ''))
                sys.stderr.write(data['error']); sys.exit(1)
            if '/protection' in url.path:
                print(json.dumps(data)); sys.exit(0)
            key = next((k for k in ['check_runs', 'workflow_runs', 'jobs'] if isinstance(data, dict) and k in data), None)
            rows = data[key] if key else data
            chunk = rows[(page-1)*size:page*size]
            print(json.dumps({key: chunk} if key else chunk)); sys.exit(0)
    if '/rules/branches/' in url.path:
        print('[]'); sys.exit(0)
    if '/protection' in url.path:
        print('{"message":"Branch not protected","documentation_url":"https://docs.github.com/rest/branches/branch-protection#get-branch-protection","status":"404"}')
        sys.stderr.write('gh: Branch not protected (HTTP 404)\\n'); sys.exit(1)
    current = json.loads((p / 'current').read_text())
    rows = current.get('statusCheckRollup')
    if url.path.endswith('check-runs'):
        print(json.dumps({'check_runs': None if rows is None else [r for r in rows if 'status' in r]}))
    elif url.path.endswith('statuses'):
        print(json.dumps([r for r in rows or [] if 'status' not in r]))
    else:
        print(json.dumps({'workflow_runs': []}))
    sys.exit(0)
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
(p / 'current').write_text(json.dumps(step))
print(json.dumps(step))
''')
        gh.chmod(0o755)

    def run_watch(self, steps, deadline='3s', retries=0, settle='1ms'):
        (self.home / 'steps').write_text(json.dumps(steps))
        env = dict(os.environ, FIXTURE_DIR=str(self.home),
                   PATH=f'{self.home}:{os.environ["PATH"]}')
        result = subprocess.run([str(SCRIPT), 'owner/repo', '42', '--head', HEAD,
                                 '--deadline', deadline, '--poll-seconds', '0.001',
                                 '--max-gh-retries', str(retries), '--state-file',
                                 str(self.home / 'state.json')] +
                                (['--settle', settle] if settle else []),
                                env=env, capture_output=True, text=True, timeout=8)
        self.assertEqual(len(result.stdout.splitlines()), 1, result.stdout)
        event = json.loads(result.stdout)
        self.assertEqual(event['sha'], HEAD)
        return result, event

    def rest_fixture(self, checks, runs=None, jobs=None):
        base = 'repos/owner/repo'
        api = {f'{base}/commits/{HEAD}/check-runs': {'check_runs': checks},
               f'{base}/actions/runs': {'workflow_runs': runs or []},
               f'{base}/commits/{HEAD}/statuses': []}
        api.update({f'{base}/actions/runs/{run_id}/jobs': {'jobs': rows}
                    for run_id, rows in (jobs or {}).items()})
        (self.home / 'api').write_text(json.dumps(api))

    def test_required_ruleset_context_absent_is_pending(self):
        (self.home / 'api').write_text(json.dumps({
            'repos/owner/repo/rules/branches/master': [dict(type='required_status_checks',
                parameters=dict(required_status_checks=[dict(context='required')]))]}))
        result, event = self.run_watch([snapshot([dict(context='other', state='SUCCESS')])],
                                       deadline='2s')
        self.assertEqual((result.returncode, event['event']), (20, 'DEADLINE'))

    def test_classic_protection_context_absent_is_pending(self):
        (self.home / 'api').write_text(json.dumps({
            'repos/owner/repo/branches/master/protection': dict(
                required_status_checks=dict(contexts=['required'], checks=[]))}))
        result, event = self.run_watch([snapshot([dict(context='other', state='SUCCESS')])],
                                       deadline='2s')
        self.assertEqual((result.returncode, event['event']), (20, 'DEADLINE'))

    def test_unprotected_branch_404_is_ready(self):
        result, event = self.run_watch([snapshot([dict(state='SUCCESS')])])
        self.assertEqual((result.returncode, event['event']), (0, 'READY'))
        self.assertEqual(result.stderr, '')
        self.assertIn('/branches/master/protection', (self.home / 'argv').read_text())

    def test_other_protection_errors_fail_closed(self):
        cases = [('403', 'Resource not accessible by integration'),
                 ('404', 'Not Found'), ('403', 'Branch not protected'),
                 (None, 'Branch not protected'), ('404', None),
                 (['404'], 'Branch not protected')]
        for status, message in cases:
            with self.subTest(status=status, message=message):
                (self.home / 'calls').unlink(missing_ok=True)
                error = f'gh: {message} (HTTP {status})\n'
                (self.home / 'api').write_text(json.dumps({
                    'repos/owner/repo/branches/master/protection': dict(
                        error=error, stdout=json.dumps(dict(message=message, status=status)))}))
                result, event = self.run_watch([snapshot([dict(state='SUCCESS')])])
                self.assertEqual((result.returncode, event['event']), (30, 'GH_ERROR'))
                self.assertEqual(result.stderr, error)

    def test_required_manifest_read_once_during_settle(self):
        result, event = self.run_watch([snapshot([dict(state='SUCCESS')])], settle='200ms')
        self.assertEqual((result.returncode, event['event']), (0, 'READY'))
        calls = (self.home / 'argv').read_text()
        self.assertEqual(calls.count('/rules/branches/master?'), 1)
        self.assertEqual(calls.count('/branches/master/protection'), 1)

    def test_pending_poll_refreshes_required_manifest(self):
        green = snapshot([dict(id=1, context='ci', state='SUCCESS')])
        pending = snapshot([dict(id=1, context='ci', state='PENDING')])
        result, event = self.run_watch([green, pending, green], settle='200ms')
        self.assertEqual((result.returncode, event['event']), (0, 'READY'))
        self.assertEqual((self.home / 'argv').read_text().count('/rules/branches/master?'), 2)

    def test_pending_polls_reuse_required_manifest_before_settle(self):
        result, event = self.run_watch([snapshot([dict(context='ci', state='PENDING')])],
                                       deadline='1s')
        self.assertEqual((result.returncode, event['event']), (20, 'DEADLINE'))
        self.assertGreater(int((self.home / 'calls').read_text()), 1)
        self.assertEqual((self.home / 'argv').read_text().count('/rules/branches/master?'), 1)

    def test_green_window_refreshes_manifest_after_pending(self):
        pending = snapshot([dict(context='ci', state='PENDING')])
        green = snapshot([dict(context='ci', state='SUCCESS')])
        result, event = self.run_watch([pending, green], settle='200ms')
        self.assertEqual((result.returncode, event['event']), (0, 'READY'))
        self.assertEqual((self.home / 'argv').read_text().count('/rules/branches/master?'), 2)

    def test_new_registration_refreshes_required_manifest(self):
        green = snapshot([dict(id=1, context='ci', state='SUCCESS')])
        late = snapshot([dict(id=1, context='ci', state='SUCCESS'),
                         dict(id=2, context='late', state='SUCCESS')])
        result, event = self.run_watch([green, late], settle='200ms')
        self.assertEqual((result.returncode, event['event']), (0, 'READY'))
        self.assertEqual((self.home / 'argv').read_text().count('/rules/branches/master?'), 2)

    def test_base_change_refreshes_required_manifest(self):
        green = snapshot([dict(context='ci', state='SUCCESS')])
        changed = dict(green, baseRefName='protected')
        (self.home / 'api').write_text(json.dumps({
            'repos/owner/repo/rules/branches/protected': [dict(type='required_status_checks',
                parameters=dict(required_status_checks=[dict(context='required')]))]}))
        result, event = self.run_watch([green, changed], deadline='2s', settle='200ms')
        self.assertEqual((result.returncode, event['event']), (20, 'DEADLINE'))
        self.assertIn('/rules/branches/protected?', (self.home / 'argv').read_text())

    def test_ruleset_api_error_is_gh_error(self):
        error = 'gh: HTTP 403 rules unavailable\n'
        (self.home / 'api').write_text(json.dumps({
            'repos/owner/repo/rules/branches/master': dict(error=error)}))
        result, event = self.run_watch([snapshot([dict(state='SUCCESS')])])
        self.assertEqual((result.returncode, event['event']), (30, 'GH_ERROR'))
        self.assertEqual(result.stderr, error)

    def test_required_context_present_is_ready(self):
        (self.home / 'api').write_text(json.dumps({
            'repos/owner/repo/rules/branches/master': [dict(type='required_status_checks',
                parameters=dict(required_status_checks=[dict(context='required')]))]}))
        result, event = self.run_watch([snapshot([dict(context='required', state='SUCCESS')])])
        self.assertEqual((result.returncode, event['event']), (0, 'READY'))
        self.assertNotIn('/protection', (self.home / 'argv').read_text())

    def test_required_context_from_second_rules_page(self):
        rules = [dict(type='deletion') for _ in range(100)] + [dict(type='required_status_checks',
            parameters=dict(required_status_checks=[dict(context='required')]))]
        (self.home / 'api').write_text(json.dumps({'repos/owner/repo/rules/branches/master': rules}))
        result, event = self.run_watch([snapshot([dict(context='required', state='SUCCESS')])])
        self.assertEqual((result.returncode, event['event']), (0, 'READY'))
        self.assertIn('rules/branches/master?per_page=100&page=2', (self.home / 'argv').read_text())

    def test_wrong_app_cannot_satisfy_required_context(self):
        (self.home / 'api').write_text(json.dumps({
            'repos/owner/repo/rules/branches/master': [dict(type='required_status_checks',
                parameters=dict(required_status_checks=[dict(context='required', integration_id=7)]))]}))
        result, event = self.run_watch([snapshot([dict(id=1, name='required', app={'id': 8},
            status='completed', conclusion='success')])], deadline='2s')
        self.assertEqual((result.returncode, event['event']), (20, 'DEADLINE'))

    def test_malformed_ruleset_manifest_is_error(self):
        (self.home / 'api').write_text(json.dumps({
            'repos/owner/repo/rules/branches/master': [dict(type='required_status_checks', parameters={})]}))
        result, event = self.run_watch([snapshot([dict(state='SUCCESS')])])
        self.assertEqual((result.returncode, event['event']), (30, 'GH_ERROR'))

    def test_classic_protection_context_present_is_ready(self):
        (self.home / 'api').write_text(json.dumps({
            'repos/owner/repo/branches/master/protection': dict(
                required_status_checks=dict(contexts=['required'], checks=[dict(context='required', app_id=7)]))}))
        result, event = self.run_watch([snapshot([dict(id=1, name='required', app={'id': 7},
            status='completed', conclusion='success')])])
        self.assertEqual((result.returncode, event['event']), (0, 'READY'))

    def test_758_superseded_rollup_ready(self):
        def check(cid, suite, name, conclusion):
            return dict(id=cid, app={'id': 15368}, check_suite={'id': suite},
                        name=name, status='completed', conclusion=conclusion)
        def run(rid, suite, workflow, conclusion):
            return dict(id=rid, head_sha=HEAD, check_suite_id=suite,
                        workflow_id=1 if workflow == 'ratchet' else 2,
                        name=workflow, status='completed', conclusion=conclusion)
        rows = [check(101, 10, 'Loop-record', 'failure'),
                check(102, 10, 'ratchet', 'cancelled'),
                check(201, 11, 'Loop-record', 'success'),
                check(202, 11, 'ratchet', 'success'),
                check(301, 20, 'Check PR size label truth', 'failure'),
                check(401, 21, 'Check PR size label truth', 'success')]
        runs = [run(10, 10, 'ratchet', 'cancelled'), run(11, 11, 'ratchet', 'success'),
                run(20, 20, 'pr-size-label', 'failure'), run(21, 21, 'pr-size-label', 'success')]
        jobs = {11: [{k: v for k, v in row.items() if k not in {'app', 'check_suite'}}
                     for row in rows if row['check_suite']['id'] == 11],
                21: [{k: v for k, v in rows[-1].items() if k not in {'app', 'check_suite'}}]}
        self.rest_fixture(rows, runs, jobs)
        result, event = self.run_watch([snapshot()], deadline='4s')
        self.assertEqual(result.returncode, 0, (event, result.stderr))
        self.assertEqual((event['event'], event['checks']), ('READY', 'green'))
        (self.home / 'calls').unlink()
        result, event = self.run_watch([snapshot(state='MERGED')], deadline='4s')
        self.assertEqual((result.returncode, event['event'], event['checks']), (12, 'MERGED', 'green'))

    def test_newer_partial_workflow_cannot_reuse_older_green_jobs(self):
        checks = [dict(id=i, app={'id': 15368}, check_suite={'id': 10}, name=name,
                       status='completed', conclusion='success') for i, name in [(101, 'A'), (102, 'B')]]
        newest = dict(id=201, app={'id': 15368}, check_suite={'id': 20}, name='A',
                      status='completed', conclusion='success')
        runs = [dict(id=rid, head_sha=HEAD, check_suite_id=suite, workflow_id=1,
                     name='ci', status=status, conclusion=conclusion)
                for rid, suite, status, conclusion in [(10, 10, 'completed', 'success'), (20, 20, 'in_progress', None)]]
        self.rest_fixture(checks + [newest], runs, {20: [dict(id=201, name='A', status='completed', conclusion='success')]})
        result, event = self.run_watch([snapshot()])
        self.assertEqual((result.returncode, event['event']), (20, 'DEADLINE'))
        (self.home / 'calls').unlink()
        result, event = self.run_watch([snapshot(state='MERGED')], deadline='2s')
        self.assertEqual((result.returncode, event['event'], event['checks']), (12, 'MERGED', 'pending'))

    def test_newer_startup_failure_without_jobs_is_failed(self):
        check = dict(id=101, app={'id': 15368}, check_suite={'id': 10}, name='A',
                     status='completed', conclusion='success')
        runs = [dict(id=rid, head_sha=HEAD, check_suite_id=suite, workflow_id=1,
                     name='ci', status='completed', conclusion=conclusion)
                for rid, suite, conclusion in [(10, 10, 'success'), (20, 20, 'startup_failure')]]
        self.rest_fixture([check], runs, {20: []})
        result, event = self.run_watch([snapshot()])
        self.assertEqual((result.returncode, event['event'], event['checks']), (10, 'FAILED', 'failed'))

    def test_same_named_checks_from_different_apps_do_not_hide_failure(self):
        self.rest_fixture([dict(id=i, app={'id': app}, name='shared', status='completed', conclusion=result)
                           for i, app, result in [(101, 1, 'failure'), (102, 2, 'success')]])
        result, event = self.run_watch([snapshot()])
        self.assertEqual((result.returncode, event['event']), (10, 'FAILED'))

    def test_latest_checks_keep_workflows_and_pending_reruns_separate(self):
        classify = runpy.run_path(str(SCRIPT))['checks_verdict']
        old = dict(id=1, name='test', workflowName='A', status='completed', conclusion='failure',
                   completed_at='2026-10-11T18:00:00Z')
        new = dict(id=2, name='test', workflowName='A', status='queued')
        self.assertEqual(classify(snapshot([old, new])), 'pending')
        new.update(status='completed', conclusion='success')
        self.assertEqual(classify(snapshot([new, old])), 'green')
        other = dict(old, workflowName='B')
        self.assertEqual(classify(snapshot([new, other])), 'failed')
        self.assertEqual(classify(snapshot([dict(new, conclusion='cancelled')])), 'failed')

    def test_latest_legacy_context(self):
        classify = runpy.run_path(str(SCRIPT))['checks_verdict']
        rows = [dict(id=2, context='ci', state='success'), dict(id=1, context='ci', state='failure')]
        self.assertEqual(classify(snapshot(rows)), 'green')
        self.assertEqual(classify(snapshot(rows + [dict(id=3, context='other', state='failure')])), 'failed')

    def test_merged_reports_checks_without_claiming_ready(self):
        for checks, expected in [([dict(state='SUCCESS')], 'green'),
                                 ([dict(state='FAILURE')], 'failed'), ([], 'pending')]:
            with self.subTest(checks=checks):
                (self.home / 'calls').unlink(missing_ok=True)
                result, event = self.run_watch([snapshot(checks, state='MERGED')])
                self.assertEqual((result.returncode, event['event'], event['checks']), (12, 'MERGED', expected))

    def test_merge_during_head_confirmation_is_distinct(self):
        green = snapshot([dict(state='SUCCESS')])
        result, event = self.run_watch([green, green, snapshot(state='MERGED')])
        self.assertEqual((result.returncode, event['event'], event['checks']), (12, 'MERGED', 'green'))

    def test_healthy_poll_resets_retry_budget_and_null_review(self):
        green = snapshot([dict(state='SUCCESS')]); green['reviewDecision'] = None
        result, event = self.run_watch([dict(error='one\n'), snapshot(), dict(error='two\n'), green], retries=1, deadline='5s')
        self.assertEqual((result.returncode, event['event']), (0, 'READY'))
        self.assertEqual(result.stderr, 'one\ntwo\n')
        self.assertEqual(event['review_decision'], '')
        self.assertEqual(json.loads((self.home / 'state.json').read_text())['retries_by_sha'][HEAD], 0)

    def test_workflow_queued_before_jobs_prevents_ready(self):
        base = 'repos/owner/repo'
        api = {f'{base}/commits/{HEAD}/check-runs': {'check_runs': [
                   dict(id=1, name='ci', status='completed', conclusion='success')]},
               f'{base}/actions/runs': {'workflow_runs': [
                   dict(id=2, head_sha=HEAD, name='new', workflow_id=1, check_suite_id=2, status='queued')]},
               f'{base}/actions/runs/2/jobs': {'jobs': []},
               f'{base}/commits/{HEAD}/statuses': []}
        (self.home / 'api').write_text(json.dumps(api))
        result, event = self.run_watch([snapshot()], deadline='250ms')
        self.assertEqual((result.returncode, event['event']), (20, 'DEADLINE'))

    def test_paginated_checks_runs_jobs_and_statuses(self):
        base = 'repos/owner/repo'
        checks = [dict(id=i, name=f'check-{i}', status='completed', conclusion='success') for i in range(1, 101)]
        runs = [dict(id=i, head_sha=HEAD, name='workflow', workflow_id=1, check_suite_id=i, status='completed', conclusion='success') for i in range(1, 102)]
        jobs = [dict(id=1000+i, name=f'job-{i}', status='completed', conclusion='success') for i in range(101)]
        cases = [('checks', checks + [dict(id=101, name='late', status='completed', conclusion='failure')], [], [], []),
                 ('runs/jobs', checks, runs, jobs + [dict(id=2000, name='late', status='completed', conclusion='failure')], []),
                 ('statuses', checks, [], [], [dict(id=i, context=f'ctx-{i}', state='success') for i in range(100)] +
                  [dict(id=101, context='late', state='failure')])]
        for label, cr, wr, jr, statuses in cases:
            with self.subTest(label=label):
                (self.home / 'calls').unlink(missing_ok=True)
                (self.home / 'argv').unlink(missing_ok=True)
                api = {f'{base}/commits/{HEAD}/check-runs': {'check_runs': cr},
                       f'{base}/actions/runs': {'workflow_runs': wr},
                       f'{base}/commits/{HEAD}/statuses': statuses}
                api.update({f'{base}/actions/runs/{run["id"]}/jobs': {'jobs': jr if run['id'] == 101 else []} for run in wr})
                (self.home / 'api').write_text(json.dumps(api))
                result, event = self.run_watch([snapshot()], deadline='4s')
                self.assertEqual((result.returncode, event['event']), (10, 'FAILED'))
                calls = (self.home / 'argv').read_text()
                if label == 'runs/jobs':
                    self.assertIn(f'actions/runs?head_sha={HEAD}&per_page=100&page=2', calls)
                    self.assertIn('actions/runs/101/jobs?filter=all&per_page=100&page=2', calls)
                else:
                    self.assertIn('page=2', calls)

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
            command = json.loads(argv)
            if command[0] == 'api':
                self.assertNotIn('--method', command)
            else:
                self.assertEqual(command[:5], ['--repo', 'owner/repo', 'pr', 'view', '42'])


class SettleTests(unittest.TestCase):
    def test_settle_cli_default_duration_and_validation(self):
        parse = runpy.run_path(str(SCRIPT))['parse_args']
        argv = [str(SCRIPT), 'owner/repo', '42', '--head', HEAD]
        with patch.object(__import__('sys'), 'argv', argv):
            self.assertEqual(parse().settle, 180)
        with patch.object(__import__('sys'), 'argv', argv + ['--settle', '2m']):
            self.assertEqual(parse().settle, 120)
        for value in ['0s', '-1s', 'nan', '180']:
            with self.subTest(value=value), redirect_stderr(StringIO()), \
                 patch.object(__import__('sys'), 'argv', argv + ['--settle', value]):
                with self.assertRaises(SystemExit) as error:
                    parse()
                self.assertEqual(error.exception.code, 2)

    def simulate(self, steps, settle=180, deadline=400, retries=0):
        watch = runpy.run_path(str(SCRIPT))['watch']
        now = [0]
        def sleep(seconds):
            now[0] += seconds
        reads = []
        def read(args, remaining, checks=True, required_cache=None):
            reads.append((now[0], checks))
            step = steps[min(len(reads) - 1, len(steps) - 1)]
            if isinstance(step, str):
                raise watch.__globals__['GhCommandError'](step)
            return dict(step)
        args = SimpleNamespace(repo='owner/repo', pr=42, head=HEAD, settle=settle,
                               deadline=deadline, poll_seconds=30, max_gh_retries=retries,
                               state_file=Path('unused'))
        clock = SimpleNamespace(monotonic=lambda: now[0], time=lambda: now[0], sleep=sleep)
        with patch.dict(watch.__globals__, time=clock, read_pr=read), \
             patch.object(watch.__globals__['upstream'], 'load_state', return_value=({}, None)), \
             patch.object(watch.__globals__['upstream'], 'save_state'), \
             patch('builtins.print'), redirect_stderr(StringIO()):
            code = watch(args)
        return code, now[0], reads

    def test_late_registering_check_resets_settle(self):
        green = dict(id=1, name='ci', status='completed', conclusion='success')
        late = dict(id=2, name='late', status='completed', conclusion='success')
        code, elapsed, _ = self.simulate([snapshot([green]), snapshot([green, late])])
        self.assertEqual(code, 0)
        self.assertEqual(elapsed, 210)

    def test_pending_rerun_resets_green_window(self):
        green = dict(id=1, name='ci', status='completed', conclusion='success')
        pending = dict(green, id=2, status='queued', conclusion=None)
        rerun = dict(green, id=2)
        code, elapsed, _ = self.simulate([snapshot([green]), snapshot([pending]), snapshot([rerun])])
        self.assertEqual((code, elapsed), (0, 240))

    def test_settle_longer_than_deadline_never_ready(self):
        code, elapsed, _ = self.simulate([snapshot([dict(state='SUCCESS')])], deadline=60)
        self.assertEqual((code, elapsed), (20, 60))

    def test_head_moves_during_settle(self):
        code, _, _ = self.simulate([snapshot([dict(state='SUCCESS')]), snapshot(head='b' * 40)])
        self.assertEqual(code, 11)

    def test_workflow_run_attempt_resets_settle(self):
        run = dict(id=1, name='__workflow__', _kind='workflow', workflow_id=1,
                   workflowName='ci', run_attempt=1, status='completed', conclusion='success')
        code, elapsed, _ = self.simulate([snapshot([run]), snapshot([dict(run, run_attempt=2)])])
        self.assertEqual((code, elapsed), (0, 210))

    def test_api_error_interrupts_settle(self):
        green = snapshot([dict(state='SUCCESS')])
        code, elapsed, _ = self.simulate([green, 'temporary\n', green], retries=1)
        self.assertEqual((code, elapsed), (0, 240))


if __name__ == '__main__':
    unittest.main()
