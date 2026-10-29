import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { main, decideSchedule, trackSchedule } from '../ratchet/schedule.mjs';
import { evaluate, parseRows } from '../ratchet/table.mjs';

const guardedHead = 'a'.repeat(40);
const runUrl = 'https://github.com/fixture-owner/fixture-repo/actions/runs/20';
const input = { event: 'schedule', guardedHead, failingRows: ['z-row', 'a-row'], runUrl };

function assertFirstRunUrl(message) {
  const url = new URL(message.split('unchanged since ')[1].trim());
  assert.equal(url.hostname, 'github.com');
  assert.equal(url.pathname, '/fixture-owner/fixture-repo/actions/runs/20');
}

test('new cause fails, reordered same cause passes with original run warning', () => {
  const first = decideSchedule(input);
  assert.equal(first.exitCode, 1);
  assert.equal(first.action, 'open');
  const repeat = decideSchedule({ ...input, failingRows: ['a-row', 'z-row'], previous: first.state });
  assert.equal(repeat.exitCode, 0);
  assert.equal(repeat.action, 'update');
  assert.match(repeat.warning, /master still RED: a-row, z-row, unchanged since/);
  assertFirstRunUrl(repeat.warning);
});

test('a new guarded SHA or failing row set fails again', () => {
  const previous = decideSchedule(input).state;
  assert.equal(decideSchedule({ ...input, previous, guardedHead: 'b'.repeat(40) }).exitCode, 1);
  assert.equal(decideSchedule({ ...input, previous, failingRows: ['a-row'] }).exitCode, 1);
});

test('green closes the issue; the same failure after recovery is new', () => {
  const previous = decideSchedule(input).state;
  const green = decideSchedule({ ...input, previous, failingRows: [] });
  assert.equal(green.exitCode, 0);
  assert.equal(green.action, 'close');
  assert.equal(decideSchedule({ ...input, previous: green.state }).exitCode, 1);
  assert.equal(decideSchedule({ ...input, failingRows: [] }).action, 'none');
});

test('push, pull_request and dispatch never suppress or update scheduled state', () => {
  const previous = decideSchedule(input).state;
  for (const event of ['push', 'pull_request', 'workflow_dispatch']) {
    const decision = decideSchedule({ ...input, event, previous });
    assert.equal(decision.exitCode, 1);
    assert.equal(decision.action, 'none');
    assert.equal(decision.warning, undefined);
  }
});

const rows = parseRows({ schema: 1, rows: input.failingRows.map(id => ({
  id, metric: id, kind: 'unit', runner: 'ci', direction: 'pass', ceiling: true, command: 'false',
})) });
const evaluation = (values = {}) => evaluate({ rows, baseRows: rows, head: guardedHead,
  results: { head_sha: guardedHead, results: values }, runner: 'ci' });
const request = { event: 'schedule', tableStatus: 1, evaluation: evaluation(), guardedHead,
  repo: 'fixture-owner/fixture-repo', runUrl };

function issueAPI() {
  const writes = [], issues = [];
  const gh = (args, body) => {
    const path = args.find(arg => arg.startsWith('repos/'));
    if (!body) {
      if (path.includes('/issues?')) {
        assert.equal(new URL(path, 'https://api.github.com/').searchParams.has('creator'), false);
        return JSON.stringify([issues]);
      }
      if (path.includes('/labels?')) return JSON.stringify([[]]);
      throw new Error(`unexpected read ${path}`);
    }
    const payload = JSON.parse(body);
    writes.push({ path, payload });
    if (path.endsWith('/issues')) issues.push({ ...payload, number: 7, state: 'open', user: { login: 'github-actions[bot]' } });
    else if (path.endsWith('/issues/7')) Object.assign(issues[0], payload);
    else if (!path.endsWith('/labels')) throw new Error(`unexpected write ${path}`);
    return '{}';
  };
  return { gh, writes, issues };
}

test('one issue: new RED, repeat warning GREEN, recovery close, recurrence RED', () => {
  const api = issueAPI();
  assert.equal(trackSchedule(request, api.gh).exitCode, 1);
  assert.deepEqual(api.issues[0].labels, ['ratchet-red']);
  const repeat = trackSchedule({ ...request, runUrl: runUrl.replace('/20', '/21') }, api.gh);
  assert.equal(repeat.exitCode, 0);
  assertFirstRunUrl(repeat.summary);
  assert.deepEqual(Object.keys(api.writes.at(-1).payload), ['body']);
  assert.equal(trackSchedule({ ...request, tableStatus: 0, evaluation: evaluation({ 'a-row': true, 'z-row': true }) }, api.gh).exitCode, 0);
  assert.equal(api.issues[0].state, 'closed');
  assert.equal(trackSchedule(request, api.gh).exitCode, 1);
  assert.equal(api.issues[0].state, 'open');
  assert.equal(api.issues.length, 1);
  assert.ok(api.writes.every(write => !write.path.includes('comments')));
});

test('non-schedule and table errors return original status without any API access', () => {
  const noAPI = () => { throw new Error('API must not run'); };
  for (const event of ['push', 'pull_request', 'workflow_dispatch']) {
    for (const tableStatus of [0, 1, 2]) {
      assert.equal(trackSchedule({ event, tableStatus }, noAPI).exitCode, tableStatus);
      assert.equal(main([String(tableStatus), 'nonexistent-results'], { GITHUB_EVENT_NAME: event }), tableStatus);
    }
  }
  assert.equal(trackSchedule({ event: 'schedule', tableStatus: 2 }, noAPI).exitCode, 2);
});

test('bad inputs, API failures and corrupt issue state cannot suppress a failure', () => {
  assert.throws(() => trackSchedule(request, () => { throw new Error('API unavailable'); }), /API unavailable/);
  const api = issueAPI();
  trackSchedule(request, api.gh);
  const validBody = api.issues[0].body;
  api.issues[0].body = validBody.split('\n')[0] + '\n{}';
  assert.throws(() => trackSchedule(request, api.gh), /malformed incident/);
  api.issues[0].body = validBody;
  for (const invalid of [
    { ...request.evaluation, stale: true }, { ...request.evaluation, rows: [] },
    { ...request.evaluation, loosened: [{ ruled: false }] }, { ...request.evaluation, ok: true },
  ]) assert.throws(() => trackSchedule({ ...request, evaluation: invalid }, api.gh), /table is invalid/);
  api.issues.push({ ...api.issues[0], number: 8 });
  assert.throws(() => trackSchedule(request, api.gh), /multiple scheduled/);
});

test('issue write failure never returns a suppressed success', () => {
  const api = issueAPI();
  trackSchedule(request, api.gh);
  assert.throws(() => trackSchedule(request, (args, body) => {
    if (body) throw new Error('write denied');
    return api.gh(args, body);
  }), /write denied/);
});

test('workflow keeps raw table status on other events and serializes schedules', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/ratchet.yml', import.meta.url), 'utf8');
  assert.match(workflow, /if \[ "\$GITHUB_EVENT_NAME" = schedule \]; then\s+node scripts\/ratchet\/schedule.mjs "\$status" "\$RUNNER_TEMP\/results.json"\s+exit \$\?\s+fi\s+exit "\$status"/);
  assert.match(workflow, /cancel-in-progress: \$\{\{ github.event_name != 'schedule' \}\}/);
  assert.match(workflow, /github.event_name == 'schedule' && 'schedule'/);
  assert.match(workflow, /run: node --test scripts\/tests\/ratchet-schedule.test.mjs/);
  // Cause identity must follow the existing freshness producer's guarded path set.
  const paths = source => [...source.matchAll(/'([^']+\/)'/g)].map(match => match[1]);
  const schedule = readFileSync(new URL('../ratchet/schedule.mjs', import.meta.url), 'utf8');
  const freshness = readFileSync(new URL('../ratchet/live-freshness.mjs', import.meta.url), 'utf8');
  assert.deepEqual(paths(schedule), paths(freshness));
});

test('real CLI emits the warning and summary on repeat; API outage stays RED', () => {
  const cwd = mkdtempSync(new URL('./.ratchet-schedule-', import.meta.url));
  try {
    mkdirSync(join(cwd, 'scripts/ratchet'), { recursive: true });
    writeFileSync(join(cwd, 'scripts/ratchet/rows.json'), JSON.stringify(rows));
    const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' }).trim();
    git('init', '-q'); git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-qm', 'fixture');
    const sha = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/master', sha);
    writeFileSync(join(cwd, 'results.json'), JSON.stringify({ head_sha: sha, results: {} }));
    writeFileSync(join(cwd, 'gh'), `#!${process.execPath}
const fs = require('node:fs');
if (process.env.FIXTURE_API_DOWN) process.exit(1);
const args = process.argv.slice(2), path = args.find(a => a.startsWith('repos/'));
let issues = fs.existsSync('issues.json') ? JSON.parse(fs.readFileSync('issues.json')) : [];
if (!args.includes('--input')) console.log(JSON.stringify([path.includes('/issues?') ? issues : []]));
else {
  const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (path.endsWith('/issues')) issues.push({ ...payload, number: 7, state: 'open', user: { login: 'github-actions[bot]' } });
  else if (path.endsWith('/issues/7')) Object.assign(issues[0], payload);
  fs.writeFileSync('issues.json', JSON.stringify(issues));
  console.log('{}');
}
`, { mode: 0o755 });
    const run = extra => spawnSync(process.execPath, [resolve('scripts/ratchet/schedule.mjs'), '1', 'results.json'], {
      cwd, encoding: 'utf8', env: { ...process.env, PATH: `${cwd}:${process.env.PATH}`, GITHUB_EVENT_NAME: 'schedule',
        GITHUB_REPOSITORY: request.repo, GITHUB_SHA: sha, GITHUB_RUN_ID: '20', GITHUB_STEP_SUMMARY: join(cwd, 'summary.md'), ...extra },
    });
    const first = run(); assert.equal(first.status, 1, first.stderr);
    const repeat = run({ GITHUB_RUN_ID: '21' }); assert.equal(repeat.status, 0, repeat.stderr);
    assert.match(repeat.stdout, /::warning::master still RED: a-row, z-row, unchanged since/);
    assertFirstRunUrl(readFileSync(join(cwd, 'summary.md'), 'utf8'));
    const down = run({ FIXTURE_API_DOWN: '1' }); assert.equal(down.status, 2);
    assert.match(down.stderr, /scheduled ratchet FAIL/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
