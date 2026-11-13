import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { evaluatePrompt, researcherPrompt, requiredSections } from '../prompt-preflight.mjs';
import { evaluateGeminiPreflight } from '../../../research-lifecycle/scripts/lifecycle-gate.mjs';

const template = readFileSync(new URL('../../references/prompt-template.md', import.meta.url), 'utf8');
const filled = (template.split('For explicitly authorized web-only research,')[0]
  + '# Owner asks (verbatim)' + template.split('# Owner asks (verbatim)')[1])
  .replace('<reviewer-one>', 'reader-a').replace('<reviewer-two>', 'reader-b')
  .replace('<exact verified answer>', 'Private verified value')
  .replace('<exact current answer>', 'Private current value')
  .replaceAll('<Current project facts document title>', 'Current facts')
  .replace(/<[^>]+>/g, 'Example statement').replaceAll('- [ ]', '- [x]');
const legacy = '# Research goal\nCompare indexing.\n# Grounding\n- "Overview"\n# Scope\nLocal.\n# Desired output\nA table.\n';

test('RED: old gate accepts the R02-style omission; new gate rejects it', () => {
  assert.equal(evaluateGeminiPreflight(legacy).pass, true);
  const result = evaluatePrompt(legacy);
  assert.equal(result.pass, false);
  assert.ok(result.failures.some(f => f.includes('Evidence against')));
  assert.ok(result.failures.some(f => f.includes('BIAS_CHECK_2')));
});

test('GREEN: filled R04-style practices pass stdin CLI contract', () => {
  assert.equal(evaluatePrompt(filled).pass, true);
  const result = spawnSync(process.execPath, [new URL('../prompt-preflight.mjs', import.meta.url).pathname, '-'],
    { input: filled, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).pass, true);
});

test('every required section fails when missing or empty; duplicates fail', () => {
  for (const section of requiredSections) {
    const start = filled.indexOf(`# ${section}\n`);
    const next = filled.indexOf('\n# ', start + 1);
    const end = next < 0 ? filled.length : next;
    assert.equal(evaluatePrompt(filled.slice(0, start) + filled.slice(end)).pass, false, section);
    assert.equal(evaluatePrompt(filled.slice(0, start) + `# ${section}\n` + filled.slice(end)).pass, false, section);
  }
  assert.equal(evaluatePrompt(filled + '\n# Evidence against\nNone.').pass, false);
});

test('unfilled template, unchecked reviews and same reviewer fail', () => {
  for (const text of [template, filled.replace('[x]', '[ ]'),
    filled.replace('reader-b', 'READER-A'), filled.replace('reader-b', ' ')]) {
    assert.equal(evaluatePrompt(text).pass, false);
  }
});

test('fenced/commented headings cannot satisfy sections; no-attach remains enforced', () => {
  assert.equal(evaluatePrompt('```md\n' + filled + '\n```').pass, false);
  assert.equal(evaluatePrompt('<!--\n' + filled + '\n-->').pass, false);
  assert.equal(evaluatePrompt(filled + '\nAttach the project file.').pass, false);
  assert.equal(evaluatePrompt(filled.replace('Verified findings + struck claims: "Example statement"',
    'Verified findings + struck claims: "Unlisted"')).pass, false);
});

for (const name of requiredSections) {
  test(`${name} rejects an x-only body`, () => {
    const start = filled.indexOf(`# ${name}\n`) + `# ${name}\n`.length;
    const next = filled.indexOf('\n# ', start);
    assert.equal(evaluatePrompt(filled.slice(0, start) + 'x\n' + (next < 0 ? '' : filled.slice(next))).pass, false);
  });
}

for (const [name, words] of Object.entries({
  'Evidence labels': ['DOCUMENTED', 'OBSERVED', 'CLAIMED', 'PROPOSED'],
  'Sources and numbers': ['primary', 'hardware', 'dataset', 'method', 'units', 'TARGET', 'Recompute'],
  'Evidence against': ['against'],
  'Desired output': ['DOCUMENTED', 'OBSERVED', 'CLAIMED', 'PROPOSED', 'TARGET'],
  'Pre-fire checks': ['independent', 'findings', 'resolved'],
})) {
  for (const word of words) test(`${name} requires ${word}`, () => {
    const start = filled.indexOf(`# ${name}\n`) + `# ${name}\n`.length;
    const next = filled.indexOf('\n# ', start);
    const end = next < 0 ? filled.length : next;
    const body = filled.slice(start, end).replace(new RegExp(`\\b${word}\\b`, 'gi'), 'omitted');
    assert.ok(evaluatePrompt(filled.slice(0, start) + body + filled.slice(end)).failures.includes(`CONTENT: ${name} requires ${word}`));
  });
}

test('owner asks require a quoted span', () => {
  assert.ok(evaluatePrompt(filled.replace('"Example statement" (Example statement)',
    'Unquoted owner request')).failures.some(f => f.startsWith('OWNER_QUOTE')));
});

test('comparisons and generic types are not placeholders; uppercase checks pass', () => {
  assert.equal(evaluatePrompt(filled.replace('# Scope\n', '# Scope\nlatency <200 ms vs >50 ms; Array<string>.\n')
    .replaceAll('[x]', '[X]')).pass, true);
});

test('--emit strips prep only, keeps researcher content and refuses invalid records', () => {
  const withAfter = filled + '\n# Extra context\nKeep this context.\n';
  const expected = researcherPrompt(withAfter);
  assert.ok(!expected.includes('reader-a') && !expected.includes('Bias check') && !expected.includes('# Pre-fire checks'));
  assert.ok(expected.includes('PROPOSED') && expected.includes('Keep this context.'));
  const command = [new URL('../prompt-preflight.mjs', import.meta.url).pathname, '--emit', '-'];
  const result = spawnSync(process.execPath, command, { input: withAfter, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, expected);
  const rejected = spawnSync(process.execPath, command, { input: legacy, encoding: 'utf8' });
  assert.equal(rejected.status, 1);
  assert.equal(rejected.stdout, '');
});

test('explicit web-only branch needs N/A, preserves remaining requirements', () => {
  const web = filled.replace(/```admission-key\n[\s\S]*?```\n?/g, '').replace(/# Grounding\n[\s\S]*?(?=# Owner asks)/,
    '# Grounding\nNone — web-only research\nVerified findings + struck claims: N/A — web-only\nReason: historical topic, no project state.\n\n');
  assert.equal(evaluatePrompt(web).pass, true);
  assert.equal(evaluatePrompt(web.replace('# Grounding\n', '# Grounding\n- "Project facts"\n')).pass, false);
  assert.equal(evaluatePrompt(web.replace(/^Reason:.*\n/m, '')).pass, false);
  assert.equal(evaluatePrompt(web.replace('Verified findings + struck claims: N/A — web-only', '')).pass, false);
});
