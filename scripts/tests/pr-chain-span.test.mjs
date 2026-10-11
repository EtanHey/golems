import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { measure } from '../pr-chain-span.mjs';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/pr-chain-span/prs.json', import.meta.url)));
const run = (prs = fixture, since = '2026-10-01', until = '2026-10-15') => measure(prs, since, until);
test('three stacked PRs: chain span alongside individual merge latency', () => {
  const c = run().chains[0];
  assert.deepEqual(c.prs.map(p => p.number), [1, 2, 3]);
  assert.equal(c.spanHours, 6);
  assert.deepEqual(c.prs.map(p => p.openToMergeHours), [1, 2, 4]);
  assert.equal(c.links.filter(l => l.rule === 'stack').length, 2);
});
test('supersede link and miner floor-index percentiles', () => {
  assert.equal(run().chains[1].spanHours, 5);
  assert.deepEqual(run().chainSpanHours, { n: 2, p50: 5, p90: 5 });
});
test('unmerged root is excluded rather than counted as completed', () => {
  assert.deepEqual(run().excludedRoots, [6]);
  assert.equal(run().chains.length, 2);
});
test('dependabot bundle cannot join a chain or latency population', () => {
  assert.equal(run().excludedDependabot, 1);
  assert.ok(!run().perPr.some(p => p.number === 8));
});
test('explicit references are local, directional, and transitive', () => {
  const prs = fixture.slice(0, 3).map(p => ({ ...p, head: null, base: null }));
  prs[1].body = 'Follow-up of #1; fixes other/repo#3';
  prs[2].body = 'Fixes #2; unrelated #8';
  assert.equal(run(prs).chains[0].links.length, 2);
});
test('closed same-branch reopen links, merged branch reuse does not', () => {
  const prs = fixture.slice(0, 3).map(p => ({ ...p, head: { ref: 'reuse', repo: { full_name: 'owner/repo' } }, base: null }));
  prs[1].merged_at = null;
  prs[1].closed_at = '2026-10-01T02:00:00Z';
  assert.deepEqual(run(prs).excludedRoots, [2]);
  assert.equal(run(prs).chains.length, 0);
});
test('root-open cohort is half-open and retains descendants outside window', () => {
  assert.equal(run(fixture, '2026-10-01', '2026-10-02').chains.length, 1);
  const crossing = fixture.slice(0, 3).map(p => p.number === 3 ? { ...p, created_at: '2026-10-02T02:00:00Z', merged_at: '2026-10-02T06:00:00Z' } : p);
  assert.equal(run(crossing, '2026-10-01', '2026-10-02').chains[0].spanHours, 30);
  assert.deepEqual(run([], '2026-10-01', '2026-10-02').chainSpanHours, { n: 0, p50: null, p90: null });
});
test('invalid dates and duplicate PRs fail closed', () => {
  assert.throws(() => run(fixture, 'bad'));
  assert.throws(() => run(fixture, '2026-10-15', '2026-10-01'));
  assert.throws(() => run([fixture[0], fixture[0]]));
});
test('fork heads cannot masquerade as target-repository stack parents', () => {
  const prs = fixture.slice(0, 2).map(p => ({ ...p, head: { ...p.head, repo: { full_name: 'fork/repo' } }, base: { ...p.base, repo: { full_name: 'owner/repo' } } }));
  assert.equal(run(prs).chains.length, 0);
});
