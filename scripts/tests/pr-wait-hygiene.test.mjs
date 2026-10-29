import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const lead = { threadId: 'lead', role: 'lead', status: 'WAITING', snoozed: true, snoozedUntil: null };
const watch = { threadId: 'lead', watchId: 'watch-1', status: 'active' };
const schedule = { threadId: 'lead', scheduleId: 'wake-1', status: 'scheduled', runAt: '2099-01-01T12:00:00Z' };
function check(snapshot) {
  return spawnSync(process.execPath, ['scripts/ci/pr-wait-hygiene.mjs', '-'], {
    input: JSON.stringify(snapshot), encoding: 'utf8',
  });
}

test('RED: snooze without a wake flags the waiting lead', () => {
  const result = check({ threads: [lead] });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /lead: WAITING without a live event or scheduled wake/);
});
test('RED: snoozedUntil alone is not an owned scheduled wake', () => {
  assert.equal(check({ threads: [{ ...lead, snoozedUntil: schedule.runAt }] }).status, 1);
});
test('GREEN: a live linked PR watch is a wake source', () => {
  assert.equal(check({ threads: [lead], watches: [watch] }).status, 0);
});
test('GREEN: an owned future schedule is a wake source', () => {
  assert.equal(check({ threads: [lead], schedules: [schedule] }).status, 0);
});
test('list_thread_pull_requests: preserve native PR rows on the owning thread', () => {
  const pr = { host: 'github.com', repository: 'example/repo', number: 1, url: 'https://github.com/example/repo/pull/1', watching: true, state: 'open' };
  const snapshot = { threads: [{ ...lead, pullRequests: [pr] }] };
  assert.equal(check(snapshot).status, 0);
  pr.watching = false;
  assert.equal(check(snapshot).status, 1);
  pr.watching = true;
  pr.state = 'merged';
  assert.equal(check(snapshot).status, 1);
});
test('list_scheduled_tasks: preserve native enabled, bound owner and next-run fields', () => {
  const wake = { scheduledTaskId: 'wake-1', boundThreadId: 'lead', enabled: true, nextRunAt: schedule.runAt };
  const snapshot = { threads: [lead], schedules: [wake] };
  assert.equal(check(snapshot).status, 0);
  wake.enabled = false;
  assert.equal(check(snapshot).status, 1);
  wake.enabled = true;
  wake.boundThreadId = null;
  assert.equal(check(snapshot).status, 1);
});
test('task_status and t3_thread_list: native task/child rows associate the waiting owner', () => {
  assert.equal(check({ threads: [
    { threadId: 'lead', status: 'waiting', parentThreadId: null, snoozed: true, snoozedUntil: null },
    { threadId: 'child', parentThreadId: 'lead', status: 'running' },
  ], tasks: [{ taskId: 't', childThreadId: 'child', status: 'running', workState: 'working', hasPendingChildRuns: false, hasPendingQuestion: false }] }).status, 0);
});
test('GREEN: thread-local watch and schedule evidence is accepted', () => {
  assert.equal(check({ ...lead, watches: [watch] }).status, 0);
  assert.equal(check({ ...lead, schedules: [schedule] }).status, 0);
});
test('RED: terminal watches, unrelated watches and placeholders do not wake the lead', () => {
  for (const invalid of [{ ...watch, status: 'closed' }, { ...watch, threadId: 'other' }, { status: 'active' }]) {
    assert.equal(check({ threads: [lead], watches: [invalid] }).status, 1);
  }
});
test('RED: expired, cancelled, unowned and undated schedules do not count', () => {
  for (const invalid of [
    { ...schedule, runAt: '2000-01-01T00:00:00Z' }, { ...schedule, status: 'cancelled' },
    { ...schedule, threadId: 'other' }, { ...schedule, runAt: null },
  ]) assert.equal(check({ threads: [lead], schedules: [invalid] }).status, 1);
});
test('GREEN: weave shape accepts a live delegate whose child identifies its parent', () => {
  const snapshot = {
    schema: 'weave-t3-fleet/v1',
    threads: [{ ...lead, role: undefined, parentThreadId: null }, { threadId: 'child', parentThreadId: 'lead', status: 'running' }],
    tasks: [{ taskId: 'task-1', childThreadId: 'child', status: 'running', workState: 'working' }],
  };
  assert.equal(check(snapshot).status, 0);
  snapshot.tasks[0].status = 'completed';
  snapshot.tasks[0].workState = 'result_available';
  assert.equal(check(snapshot).status, 1);
});
test('RED: a delegate belonging to another lead cannot cover the wait', () => {
  assert.equal(check({ threads: [lead], tasks: [{ taskId: 't', parentThreadId: 'other', status: 'running' }] }).status, 1);
});
test('only waiting leads are checked; all unsafe leads are reported', () => {
  const result = check({ threads: [
    lead, { ...lead, threadId: 'second', snoozed: false },
    { ...lead, threadId: 'worker', role: 'worker' },
    { ...lead, threadId: 'child', role: undefined, parentThreadId: 'lead' },
    { ...lead, threadId: 'running', status: 'running' },
  ] });
  assert.equal(result.status, 1);
  assert.equal(result.stdout.trim().split('\n').length, 2);
});
test('invalid snapshots fail with a distinct input error', () => {
  for (const invalid of [{}, { threads: 'bad' }, { threads: [{ status: 'waiting' }] }, { threads: [lead], watches: {} }]) {
    assert.equal(check(invalid).status, 2);
  }
});

// Watch-truth text: a "watched" claim needs a same-turn `watching:true` readback, and every open
// lead-owned PR sits in one of two states. Policy lives once in review-loop.md; pointers link it.
const doc = (path) => readFileSync(path, 'utf8');
const policyLink = 'pr-loop/references/review-loop.md#waiting-policy-no-polling-turns';
const rawWaitingPolicy = () => doc('skills/golem-powers/pr-loop/references/review-loop.md')
  .split('### Waiting policy (no polling turns)')[1].split('\n### ')[0];
const waitingPolicy = () => rawWaitingPolicy().replace(/\s+/g, ' ');
// One paragraph only, so tokens elsewhere in the section cannot satisfy its assertions.
const policyParagraph = (lead) => {
  const paragraph = rawWaitingPolicy().split(/\n\s*\n/).find((block) => block.trimStart().startsWith(lead));
  assert.ok(paragraph, `paragraph ${lead} exists`);
  return paragraph.replace(/\s+/g, ' ').trim();
};
test('waiting policy: a watch claim requires a same-turn watching:true readback', () => {
  const paragraph = policyParagraph('**Watch claims need a readback.**');
  for (const sentence of [
    'Say "watched" only after `list_thread_pull_requests` shows `watching:true` for that PR in the same turn, and cite that readback.',
    'A remembered or intended watch is not evidence',
  ]) assert.ok(paragraph.includes(sentence), sentence);
});
test('waiting policy: the owning lead arms the watch on accepting a worker READY', () => {
  const policy = waitingPolicy();
  for (const text of [
    '**The owning lead holds the watch.**', 'never the worker', 'A worker arms no watch',
    'In the same turn it accepts that READY, the lead arms `watch_pull_request` and reads back `watching:true`',
  ]) assert.ok(policy.includes(text), text);
});
test('waiting policy: every open lead-owned PR is watched-with-action or blocked', () => {
  const policy = waitingPolicy();
  for (const text of [
    '**Two states only', 'WATCHED-WITH-ACTION', 'BLOCKED', 'named blocker', 'owner', '`schedule_task`',
    'No third state',
  ]) assert.ok(policy.includes(text), text);
});
test('never-fabricate lists the watched claim and links the waiting policy', () => {
  const apply = doc('skills/golem-powers/never-fabricate/SKILL.md').split('## When To Apply')[1].split('\n## ')[0];
  assert.match(apply, /"watched" or "monitored"/);
  assert.ok(apply.includes('`watching:true`'), 'names the readback');
  assert.ok(apply.includes(`../${policyLink}`), 'links the waiting policy');
});
test('large-plan PR waiting points at the readback rule in the waiting policy', () => {
  const skill = doc('skills/golem-powers/large-plan/SKILL.md');
  const row = skill.split('\n').find((line) => line.startsWith('| **PR waiting** |'));
  assert.ok(row, 'PR waiting row exists');
  assert.ok(row.includes(`../${policyLink}`), 'row links the waiting policy');
  assert.ok(row.includes('`watching:true`'), 'row names the readback');
});
test('PR-watch wake steps defer to the waiting policy instead of contradicting it', () => {
  for (const [path, prefix] of [
    ['skills/golem-powers/large-plan/SKILL.md', '../'],
    ['skills/golem-powers/agent-routing/references/t3-native.md', '../../'],
  ]) {
    const text = doc(path).replace(/\s+/g, ' ');
    assert.ok(!text.includes('A wake is news'), `${path}: no "A wake is news" rule`);
    assert.ok(text.includes(`On a PR-watch wake, follow the [waiting policy](${prefix}${policyLink}).`), `${path}: links the policy`);
  }
});

const openPr = { url: 'https://github.com/example/repo/pull/1', number: 1, state: 'open', watching: false };
const blocked = { threadId: 'lead', pr: openPr.url, reason: 'Needs maintainer input', owner: 'maintainer' };
const wake = { scheduledTaskId: 'wake-1', boundThreadId: 'lead', enabled: true, nextRunAt: schedule.runAt };
const prLead = { ...lead, status: 'running', pullRequests: [openPr] };
const prViolation = `lead ${openPr.url}: open PR neither watched nor BLOCKED-with-wake`;

test('RED: each unwatched open PR is reported even when another PR is watched', () => {
  const result = check({ threads: [{ ...prLead, pullRequests: [
    openPr, { ...openPr, number: 2, url: `${openPr.url}2` }, { ...openPr, watching: true },
  ] }] });
  assert.equal(result.status, 1);
  assert.equal(result.stdout.trim(), `${prViolation}\nlead ${openPr.url}2: open PR neither watched nor BLOCKED-with-wake`);
});
test('RED: BLOCKED without a future enabled schedule bound to the lead is insufficient', () => {
  for (const schedules of [[], [{ ...wake, enabled: false }], [{ ...wake, nextRunAt: '2000-01-01T00:00:00Z' }],
    [{ ...wake, boundThreadId: 'other' }], [{ ...wake, nextRunAt: 'invalid' }], [schedule]]) {
    const result = check({ threads: [prLead], blocked: [blocked], schedules });
    assert.equal(result.status, 1);
    assert.equal(result.stdout.trim(), prViolation);
  }
});
test('RED: BLOCKED requires a nonempty reason and owner for this thread and PR', () => {
  for (const row of [{ ...blocked, reason: '' }, { ...blocked, reason: '  ' }, { ...blocked, owner: '' },
    { ...blocked, owner: null }, { ...blocked, threadId: 'other' }, { ...blocked, pr: 2 }]) {
    assert.equal(check({ threads: [prLead], blocked: [row], schedules: [wake] }).status, 1);
  }
});
test('RED: unrelated watches, live delegates and schedules do not cover an open PR', () => {
  const result = check({ threads: [prLead], watches: [watch], schedules: [wake],
    tasks: [{ taskId: 't', parentThreadId: 'lead', status: 'running' }] });
  assert.equal(result.status, 1);
  assert.equal(result.stdout.trim(), prViolation);
});
test('GREEN: native watching:true covers an open PR on any lead status', () => {
  for (const status of ['waiting', 'running', 'completed']) {
    assert.equal(check({ threads: [{ ...prLead, status, pullRequests: [{ ...openPr, watching: true }] }] }).status, 0);
  }
});
test('GREEN: BLOCKED by PR URL or number plus an enabled future bound schedule', () => {
  for (const pr of [openPr.url, openPr.number]) {
    assert.equal(check({ threads: [prLead], blocked: [{ ...blocked, pr }], schedules: [wake] }).status, 0);
  }
  assert.equal(check({ ...lead, pullRequests: [openPr], blocked: [blocked], schedules: [wake] }).status, 0);
});
test('GREEN: closed and merged unwatched PRs are ignored', () => {
  assert.equal(check({ threads: [{ ...prLead, pullRequests: [
    { ...openPr, state: 'closed' }, { ...openPr, state: 'merged' },
  ] }] }).status, 0);
});
test('GREEN: workers and child threads remain excluded from open-PR checks', () => {
  assert.equal(check({ threads: [{ ...prLead, role: 'worker' },
    { ...prLead, threadId: 'child', role: undefined, parentThreadId: 'lead' }] }).status, 0);
});
test('invalid BLOCKED containers and open PRs without a URL are input errors', () => {
  for (const invalid of [{ threads: [prLead], blocked: {} }, { threads: [{ ...prLead, blocked: [null] }] },
    { threads: [{ ...prLead, pullRequests: [{ ...openPr, url: '' }] }] }]) {
    assert.equal(check(invalid).status, 2);
  }
});
