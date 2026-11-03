import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { evaluatePrompt, requiredSections } from '../prompt-preflight.mjs';
import { evaluateGeminiPreflight } from '../../../research-lifecycle/scripts/lifecycle-gate.mjs';

const template = readFileSync(new URL('../../references/prompt-template.md', import.meta.url), 'utf8');
const filled = (template.split('For explicitly authorized web-only research,')[0]
  + '# Owner asks (verbatim)' + template.split('# Owner asks (verbatim)')[1])
  .replace('<reviewer-one>', 'reader-a').replace('<reviewer-two>', 'reader-b')
  .replace(/<[^>]+>/g, 'Example').replaceAll('- [ ]', '- [x]');
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
  assert.equal(evaluatePrompt(filled.replace('Verified findings + struck claims: "Example"',
    'Verified findings + struck claims: "Unlisted"')).pass, false);
});

test('explicit web-only branch needs N/A, preserves remaining requirements', () => {
  const web = filled.replace(/# Grounding\n[\s\S]*?(?=# Owner asks)/,
    '# Grounding\nNone — web-only research\nVerified findings + struck claims: N/A — web-only\nReason: historical topic, no project state.\n\n');
  assert.equal(evaluatePrompt(web).pass, true);
  assert.equal(evaluatePrompt(web.replace('# Grounding\n', '# Grounding\n- "Project facts"\n')).pass, false);
  assert.equal(evaluatePrompt(web.replace(/^Reason:.*\n/m, '')).pass, false);
  assert.equal(evaluatePrompt(web.replace('Verified findings + struck claims: N/A — web-only', '')).pass, false);
});
