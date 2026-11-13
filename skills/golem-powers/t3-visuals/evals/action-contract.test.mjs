import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Run the same contract against a pinned base without changing the checkout:
// T3_VISUALS_REF=<sha> node --test skills/golem-powers/t3-visuals/evals/action-contract.test.mjs
const path = 'skills/golem-powers/t3-visuals/SKILL.md';
const skill = process.env.T3_VISUALS_REF
  ? execFileSync('git', ['show', `${process.env.T3_VISUALS_REF}:${path}`], { encoding: 'utf8' })
  : readFileSync(new URL('../SKILL.md', import.meta.url), 'utf8');
const requires = (text, pattern) => assert.ok(pattern.test(text), `Missing contract: ${pattern}`);
const compose = skill.split('## Compose\n')[1]?.split('## Before rendering')[0] ?? '';

test('every user action requires an exact-payload copy button or exact-page link', () => {
  requires(compose, /Whenever there's something for me to do, should have a button of copy the comment, open the link, whatever\./);
  requires(compose, /Every action item for Etan must have a copy button or link/);
  requires(compose, /copies the exact text he would paste \(a command, a comment, a prompt\)/);
  requires(compose, /link opens the exact page/);
  requires(compose, /neither is wrong/);
});

test('note and next step are two actual columns, never a counted list', () => {
  requires(compose, /real two-column table, not rows with a count/);
  const example = compose.match(/```html\n([\s\S]*?)```/)?.[1] ?? '';
  requires(example, /<table>[\s\S]*<th>Your note<\/th><th>What happens next<\/th>/);
  const rows = [...example.matchAll(/<tr>([\s\S]*?)<\/tr>/g)];
  assert.ok(rows.length >= 2, 'example has a header and at least one paired data row');
  for (const [, row] of rows.slice(1)) {
    assert.equal((row.match(/<td>/g) ?? []).length, 2, 'each note has one next-step cell');
  }
});
