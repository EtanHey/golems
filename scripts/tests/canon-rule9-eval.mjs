#!/usr/bin/env node
// Judge-free fixed-case policy evaluation; this does not measure model compliance.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const baseline = process.argv[2];
assert.ok(baseline, 'Usage: node scripts/tests/canon-rule9-eval.mjs <baseline-ref>');
const files = ['standards/fleet-canon.md',
  'skills/golem-powers/pr-loop/references/pr-creation.md',
  'skills/golem-powers/large-plan/SKILL.md'];
const before = files.map(file => execFileSync('git', ['show', `${baseline}:${file}`], { encoding: 'utf8' }));
const after = files.map(file => readFileSync(file, 'utf8'));
const rule9 = text => text.match(/9\. \*\*tight-loop PRs\*\*[^]*?(?=\n10\.)/)[0];
const cases = [
  { name: '600 lines, one tryable behaviour with tests/docs', kind: 'large', expected: 'KEEP' },
  { name: 'Six commits, one tryable behaviour', kind: 'commits', expected: 'KEEP' },
  { name: 'Same-behaviour defect while PR is open', kind: 'same', expected: 'SAME_PR' },
  { name: 'Unrelated defect while PR is open', kind: 'unrelated', expected: 'NEW_PR' },
];
function decide(texts, row) {
  const canon = rule9(texts[0]);
  const behaviourGuidance = texts.every(text => /tryable behaviour|behaviour the owner/.test(text));
  if (behaviourGuidance && /Fix a defect[^]*same PR[^]*unrelated[^]*new PR/.test(canon)) {
    return { large: 'KEEP', commits: 'KEEP', same: 'SAME_PR', unrelated: 'NEW_PR' }[row.kind];
  }
  // Recognize only the previous explicit cap/defect policy; otherwise abstain.
  if (row.kind === 'large' && /split past ~\d+ hand-written lines/.test(canon)) return 'SPLIT';
  if (row.kind === 'commits' && /or \d+ commits/.test(canon)) return 'SPLIT';
  if (['same', 'unrelated'].includes(row.kind) && /a defect found mid-PR opens/.test(canon)) return 'NEW_PR';
  return 'UNKNOWN';
}
console.log('Static policy extraction, old guidance vs candidate; no model calls or behavioural-compliance claim.');
console.log('| Case | Expected | Before | After |');
console.log('|---|---|---|---|');
let oldScore = 0, newScore = 0;
for (const row of cases) {
  const oldAnswer = decide(before, row), newAnswer = decide(after, row);
  oldScore += Number(oldAnswer === row.expected);
  newScore += Number(newAnswer === row.expected);
  console.log(`| ${row.name} | ${row.expected} | ${oldAnswer} | ${newAnswer} |`);
  assert.equal(newAnswer, row.expected, row.name);
}
console.log(`Score: before ${oldScore}/${cases.length}; after ${newScore}/${cases.length}.`);
