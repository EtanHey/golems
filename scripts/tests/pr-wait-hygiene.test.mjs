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

// Source audit 2026-10-30: watch returns its own readback; list is diagnostic, never mandatory.
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
test('waiting policy: watch receipt proves registration without a routine list', () => {
  const paragraph = policyParagraph('**Watch claims need evidence.**');
  for (const text of ['`watch_pull_request` receipt', '`watching:true`', 'registration',
    'not polling liveness, wake delivery, current CI or merge readiness']) assert.ok(paragraph.includes(text), text);
  const policy = waitingPolicy();
  assert.ok(policy.includes('Never call `list_thread_pull_requests` solely to reprove a watch or end work'));
  assert.ok(policy.includes('the end-of-turn check above uses `gh` reads'));
  assert.ok(policy.includes('inventory (such as a settle handoff), diagnosis, an ambiguous receipt or an audit'));
});
// Root cause 2026-11-01: PRs rotted on settled threads, unadopted worker/bot PRs and silent holds.
test('waiting policy: every turn ends with an open-PR check; waiting is not a state', () => {
  const paragraph = policyParagraph('**Watching is not waiting: check your open PRs before every turn ends.**');
  assert.ok(paragraph.includes('A draft in its inner loop: check that its implementer or reviewer is still running'));
  for (const text of ["owning lead's duty, never a worker's", 'Before ending ANY turn', 'every open PR it owns',
    'fix it now or route the fix now', 'merge it under your lane', 'update the branch yourself',
    '"Waiting" is never a state for a red or green PR you own']) assert.ok(paragraph.includes(text), text);
  // Order matters: a valid hold is checked first; pending CI is ordinary waiting, never a hold.
  const cases = ['Visibly held, and the reason still holds', 'Red or conflicting', 'Green:', 'Behind:',
    'Checks or the routed review still running: keep the watch and end the turn', 'Otherwise'];
  let at = -1;
  for (const text of cases) {
    const next = paragraph.indexOf(text);
    assert.ok(next > at, `${text} follows the previous case`);
    at = next;
  }
  assert.ok(paragraph.includes('ordinary waiting, not a hold'), 'pending is not a hold');
});
test('waiting policy: ownership survives settle and covers worker and bot PRs', () => {
  const paragraph = policyParagraph('**Ownership outlives the thread.**');
  for (const text of ['Before settling, completing or retiring a lead thread', '`watch_pull_request`',
    'successor lead\'s `threadId`', 'check that call\'s `watching:true` receipt',
    'only after that unwatch it on the old thread', 'Settling drops the old thread\'s watches',
    'its acknowledgement is', 'Adopt worker and bot PRs', 'dependabot',
    'links and watches it in the turn it learns of it']) assert.ok(paragraph.includes(text), text);
});
test('waiting policy: a hold is a draft plus a plain HELD comment', () => {
  const paragraph = policyParagraph('**Held is visible, never silent.**');
  for (const text of ['is a draft', '`**Held on purpose`', 'why it is held', 'next step', 'owner',
    'when the head moves', 'mark the PR ready, get the current-head checks and the routed review',
    'Never merge a held draft', 'not visibly held is unnoticed']) assert.ok(paragraph.includes(text), text);
  assert.ok(waitingPolicy().includes('mark the PR held (above)'), 'BLOCKED marks the PR held');
});
test('waiting policy: parent owns watch and finishes existing work before arming', () => {
  const paragraph = policyParagraph('**The owning lead holds the watch.**');
  for (const text of ['never the worker', 'A worker arms no watch', 'existing feedback',
    'branch fixes and pushes', 'inspect its `watching:true` receipt', 'end the turn']) assert.ok(paragraph.includes(text), text);
});
test('waiting policy: ordinary wakes and pushes preserve watch; stop is distinct', () => {
  const paragraph = policyParagraph('**Wakes and pushes preserve the watch.**');
  for (const text of ['no routine rewatch, relink, list or rearm', 'documented stop',
    'new monitoring request', 'eligible parent', 'User Stop', 'read failures', 'comment-only']) assert.ok(paragraph.includes(text), text);
});
test('waiting policy: native T3 overrides timers and cheap watcher prescriptions', () => {
  const policy = waitingPolicy();
  for (const text of ['T3 parent-owned native watch takes precedence',
    'no timer wake, Monitor, scheduled PR poll or watcher child', 'unwatch before handback',
    'BLOCKED', 'named blocker', 'next owner']) assert.ok(policy.includes(text), text);
  assert.ok(!policy.includes('**Two states only'));
});
test('waiting policy: offline checker is diagnostic and cannot override runtime', () => {
  const policy = waitingPolicy();
  for (const text of ['diagnostic snapshot tool', 'BLOCKED-with-wake',
    'checker failure never authorizes a timer, duplicate watcher or runtime override',
    'For non-PR owned waits']) assert.ok(policy.includes(text), text);
});
test('bot policy: configuration-aware drafts and no duplicate current-head requests', () => {
  const skill = doc('skills/golem-powers/pr-loop/SKILL.md');
  for (const text of ['Draft handling depends on effective bot settings',
    'Never merge a draft', 'current-head automatic review already exists',
    // Draft first, ready once (2026-11-01): the inner loop runs on a draft; the flip starts the bots.
    'Draft first, ready once', '`gh pr create --draft`', 'run `gh pr ready <N>`',
    'never request a bot review by hand when the flip already triggered one']) assert.ok(skill.includes(text), text);
  const handoffs = doc('skills/golem-powers/pr-loop/references/dispatch-and-handoffs.md');
  assert.ok(handoffs.includes('RIGHT: gh pr create --draft → inner loop on the draft → gh pr ready <N> → bot loop → merge'));
  assert.ok(!handoffs.includes('WRONG: gh pr create --draft'), 'draft-first is no longer WRONG');
  for (const path of ['skills/golem-powers/pr-loop/SKILL.md',
    'skills/golem-powers/pr-loop/references/dispatch-and-handoffs.md']) {
    assert.ok(!doc(path).replaceAll('**', '').includes('Draft PRs silently skip bot reviews'), path);
  }
});
test('never-fabricate lists the watched claim and links the waiting policy', () => {
  const apply = doc('skills/golem-powers/never-fabricate/SKILL.md').split('## When To Apply')[1].split('\n## ')[0];
  assert.match(apply, /"watched" or "monitored"/);
  assert.ok(apply.includes('`watching:true`'), 'names the receipt');
  assert.ok(apply.includes('`watch_pull_request` receipt'), 'watch supplies registration evidence');
  assert.ok(!apply.includes('`list_thread_pull_requests` readback'), 'no mandatory list');
  assert.ok(apply.includes(`../${policyLink}`), 'links the waiting policy');
});
test('large-plan PR waiting points at the readback rule in the waiting policy', () => {
  const skill = doc('skills/golem-powers/large-plan/SKILL.md');
  const row = skill.split('\n').find((line) => line.startsWith('| **PR waiting** |'));
  assert.ok(row, 'PR waiting row exists');
  assert.ok(row.includes(`../${policyLink}`), 'row links the waiting policy');
  assert.ok(row.includes('`watching:true` receipt'), 'row names the watch receipt');
  assert.ok(row.includes('no routine list or rearm'), 'no redundant readback or rearm');
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
