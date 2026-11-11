import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRelay, deliverPending } from './ratchet-inbox-relay.mjs';
const now = Date.parse('2026-11-12T00:00:00Z');
const incident = { active: true, causeKey: JSON.stringify(['a'.repeat(40), ['live-tier-freshness']]), firstRunUrl: 'https://github.com/EtanHey/golems/actions/runs/1' };
const input = { incident, now, rows: [], mergedPR: 1200, guardedHead: 'a'.repeat(40) };
test('red, hourly dedupe, daily reminder, changed cause and recovery', () => {
  const first = planRelay(input); assert.equal(first.posts.length, 1); assert.match(first.posts[0], /RED:/);
  assert.equal(planRelay({ ...input, state: first.state, now: now + 3600000 }).posts.length, 0);
  assert.match(planRelay({ ...input, state: first.state, now: now + 25 * 3600000 }).posts[0], /STILL RED since/);
  assert.equal(planRelay({ ...input, state: first.state, incident: { ...incident, causeKey: JSON.stringify(['b'.repeat(40), ['other']]) } }).posts.length, 1);
  const green = planRelay({ ...input, state: first.state, incident: { ...incident, active: false } });
  assert.match(green.posts[0], /GREEN:.*cleared/);
  assert.equal(planRelay({ ...input, state: green.state, incident: { ...incident, active: false } }).posts.length, 0);
});
test('48 hour warning boundary, dedupe and expired fresh receipt', () => {
  const row = hours => ({ id: 'parity', report_only_until: new Date(now + hours * 3600000).toISOString() });
  const first = planRelay({ ...input, rows: [row(47)] }); assert.match(first.posts[1], /WARN:/);
  assert.equal(planRelay({ ...input, rows: [row(47)], state: first.state }).posts.length, 0);
  assert.equal(planRelay({ ...input, rows: [row(49)] }).posts.length, 1);
  assert.equal(planRelay({ ...input, rows: [row(-1)], receiptFresh: true }).posts.length, 1);
  assert.equal(planRelay({ ...input, rows: [row(-1)] }).posts.length, 2);
});
test('failed ssh retains pending and appends OUTBOX; next run drains', () => {
  const state = { pending: ['hello'] }; const outbox = []; let delivered = '';
  deliverPending(state, () => { throw Error('offline'); }, text => outbox.push(text), () => {});
  assert.deepEqual(state.pending, ['hello']); assert.equal(outbox.length, 1);
  deliverPending(state, text => { delivered = text; }, () => {}, () => {});
  assert.match(delivered, /hello/); assert.deepEqual(state.pending, []);
});
test('injected gh reads marker incident and log without network', async () => {
  const { collect } = await import('./ratchet-inbox-relay.mjs');
  const calls = [];
  const head = 'a'.repeat(40);
  const data = collect({ now, git: args => args[0] === 'show'
    ? JSON.stringify({ schema: 1, rows: [{ id: 'live', bug_sha: head, fix_sha: head, kind: 'real', runner: 'live', direction: 'pass', ceiling: true, command: 'true', metric: 'test' }] }) : head,
    gh: args => {
      calls.push(args);
      if (args[0] === 'run') return 'live-tier freshness FAIL: stale receipt';
      const path = args.at(-1);
      if (path.includes('?state=all')) return JSON.stringify([[{ user: { login: 'github-actions[bot]' }, body: `<!-- golems-ratchet-schedule -->\n${JSON.stringify({ schema: 1, ...incident })}` }]]);
      if (path.endsWith('/pulls')) return JSON.stringify([[{ number: 1200, merged_at: '2026-11-01T00:00:00Z', merge_commit_sha: head, base: { ref: 'master' } }]]);
      return '[[]]';
    } });
  assert.equal(data.now, now); assert.equal(data.mergedPR, 1200);
  assert.match(data.reasons['live-tier-freshness'], /stale receipt/);
  assert.equal(calls.length, 4);
});
