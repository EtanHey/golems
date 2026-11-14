import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = new URL('../prompt-preflight.mjs', import.meta.url).pathname;
const template = readFileSync(new URL('../../references/prompt-template.md', import.meta.url), 'utf8');
const key = [
  { document: 'Facts', question: 'What is the repetition penalty?', answer: '1.5', first_line: '# Actual source facts' },
  { document: 'Facts', question: 'What is the measured score?', answer: '0.484', first_line: '# Actual source facts' },
];
const base = (template.split('For explicitly authorized web-only research,')[0]
  + '# Owner asks (verbatim)' + template.split('# Owner asks (verbatim)')[1])
  .replace(/```admission-key\n[\s\S]*?```\n?/g, '')
  .replace('<reviewer-one>', 'reader-a').replace('<reviewer-two>', 'reader-b')
  .replace(/<[^>]+>/g, 'Example statement').replaceAll('- [ ]', '- [x]')
  .replace(/# Grounding\n[\s\S]*?(?=# Owner asks)/,
    '# Grounding\nUse ONLY "Facts" via Drive.\n- "Facts"\nVerified findings + struck claims: "Facts"\n'
    + '| document | question |\n| --- | --- |\n'
    + key.map(row => `| ${row.document} | ${row.question} |`).join('\n') + '\n\n');
const author = base + '\n```admission-key\n' + JSON.stringify(key) + '\n```\n';
const table = rows => '| document | question | readable (yes/no) | first heading or line read | answer |\n'
  + '| --- | --- | --- | --- | --- |\n'
  + rows.map(row => `| ${row.document} | ${row.question} | yes | ${row.first_line} | ${row.answer} |`).join('\n');
function cli(args, input) {
  return spawnSync(process.execPath, [script, ...args], { input, encoding: 'utf8' });
}
function harvest(rows, record = author) {
  const dir = mkdtempSync(join(tmpdir(), 'admission-test-'));
  try {
    writeFileSync(join(dir, 'result.md'), table(rows));
    writeFileSync(join(dir, 'author.md'), record);
    return cli(['--harvest-check', join(dir, 'result.md'), join(dir, 'author.md')]);
  } finally { rmSync(dir, { recursive: true }); }
}
test('key-matching table PASSES the harvest CLI', () => {
  const result = harvest(key);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).pass, true);
});
test('R02 all-yes invented answers FAIL as FABRICATED_READ', () => {
  const result = harvest(key.map((row, i) => ({ ...row, answer: ['1.05', '0.179'][i] })));
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /FABRICATED_READ/);
});
test('invented first heading FAILS even with correct answers', () => {
  const result = harvest(key.map(row => ({ ...row, first_line: '# Invented heading' })));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FABRICATED_READ/);
});
test('missing key FAILS at emit without output', () => {
  const result = cli(['--emit', '-'], base);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /ADMISSION_KEY/);
});
test('key answer leaked into researcher text FAILS at emit', () => {
  const result = cli(['--emit', '-'], author.replace('# Scope\n', '# Scope\nPenalty is 1.5.\n'));
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /ADMISSION_KEY_LEAK/);
});
test('emit keeps questions and removes author-held answers', () => {
  const result = cli(['--emit', '-'], author);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /What is the repetition penalty/);
  assert.ok(!result.stdout.includes('1.5') && !result.stdout.includes('admission-key'));
});
test('missing, extra, duplicate result rows and incomplete keys fail closed', () => {
  for (const rows of [key.slice(1), [...key, key[0]], [...key, { ...key[0], question: 'Unasked?' }]]) {
    assert.equal(harvest(rows).status, 1);
  }
  const incomplete = author.replace(JSON.stringify(key), JSON.stringify(key.slice(1)));
  assert.equal(cli(['--emit', '-'], incomplete).status, 1);
});
test('non-yes and blank cells fail; malformed or duplicate keys refuse emit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'admission-test-'));
  try {
    writeFileSync(join(dir, 'author.md'), author);
    for (const rowText of [table(key).replace('| yes |', '| no |'), table(key).replace('| yes |', '| |')]) {
      writeFileSync(join(dir, 'result.md'), rowText);
      assert.equal(cli(['--harvest-check', join(dir, 'result.md'), join(dir, 'author.md')]).status, 1);
    }
  } finally { rmSync(dir, { recursive: true }); }
  for (const value of ['not JSON', JSON.stringify([...key, key[0]]), JSON.stringify([{ ...key[0], first_line: '' }])]) {
    assert.equal(cli(['--emit', '-'], author.replace(JSON.stringify(key), value)).status, 1);
  }
});
