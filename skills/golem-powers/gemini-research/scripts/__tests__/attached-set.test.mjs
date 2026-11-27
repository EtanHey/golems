// --emit --attached <folder>: the prepared folder must hold exactly the documents the
// Grounding block (and so the private key) names. Guard for the .txt fallback (golems #1366 r1):
// copying .md files to .txt without renaming them in the prompt/key must fail emit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = new URL('../prompt-preflight.mjs', import.meta.url).pathname;
const template = readFileSync(new URL('../../references/prompt-template.md', import.meta.url), 'utf8');

function record(docs, answer = d => `unique answer ${d}`) {
  const key = docs.map(document => ({ document, question: `What is in ${document}?`, answer: answer(document), first_line: `# ${document}` }));
  const body = (template.split('For explicitly authorized web-only research,')[0]
    + '# Owner asks (verbatim)' + template.split('# Owner asks (verbatim)')[1])
    .replace(/```admission-key\n[\s\S]*?```\n?/g, '')
    .replace('<reviewer-one>', 'reader-a').replace('<reviewer-two>', 'reader-b')
    .replace(/<[^>]+>/g, 'Example statement').replaceAll('- [ ]', '- [x]')
    .replace(/# Grounding\n[\s\S]*?(?=# Owner asks)/,
      '# Grounding\nFiles supplied with this run; Drive source off. Use ONLY these.\n'
      + docs.map(d => `- "${d}"`).join('\n') + '\n'
      + `Verified findings + struck claims: "${docs[0]}"\n`
      + '| document | question |\n| --- | --- |\n'
      + key.map(row => `| ${row.document} | ${row.question} |`).join('\n') + '\n\n');
  return body + '\n```admission-key\n' + JSON.stringify(key) + '\n```\n';
}

function emit(docs, files, { body = f => `| field | value |\n| --- | --- |\n| answer | unique answer ${f} |\n`, answer } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'attached-set-'));
  try {
    const folder = join(dir, 'R09-grounding');
    mkdirSync(folder);
    for (const f of files) writeFileSync(join(folder, f), `# ${f}\n\n${body(f)}`);
    writeFileSync(join(dir, 'author.md'), record(docs, answer));
    return spawnSync(process.execPath, [script, '--emit', '--attached', folder, join(dir, 'author.md')], { encoding: 'utf8' });
  } finally { rmSync(dir, { recursive: true }); }
}

const md = ['R09-01-facts.md', 'R09-02-bench.md'];
const txt = ['R09-01-facts.txt', 'R09-02-bench.txt'];

test('.txt files attached while prompt and key still name .md: emit FAILS', () => {
  const result = emit(md, txt);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /ATTACHED_SET/);
});

test('renamed consistently (.txt in folder, grounding and key): emit PASSES', () => {
  const result = emit(txt, txt);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /- "R09-01-facts\.txt"/);
});

test('extra or missing folder file FAILS; manifest and hidden files are ignored', () => {
  assert.equal(emit(md, [...md, 'R09-03-stray.md']).status, 1);
  assert.equal(emit(md, [md[0]]).status, 1);
  assert.equal(emit(md, [...md, '00-GROUNDING-MANIFEST.md', '.DS_Store']).status, 0);
});

// R01 2026-11-26: key "985.926 s", grounding cell "985.926 s (+85.926 s over deadline)". A researcher
// who copied the whole cell failed the exact harvest check. Emit must refuse a partial-cell key answer.
const cell = () => '| run | wall |\n| --- | --- |\n| `B-T2-clip01` | 985.926 s (+85.926 s over deadline) |\n';

test('key answer is only part of a table cell: emit FAILS with ADMISSION_KEY_PART', () => {
  const result = emit(md, md, { body: cell, answer: () => '985.926 s' });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /ADMISSION_KEY_PART/);
});

test('key answer is part of a prose line: emit FAILS', () => {
  const prose = () => '- plus an early sidebar occurrence at **405.0046 s** (~06:45).\n';
  assert.match(emit(md, md, { body: prose, answer: () => '405.0046 s' }).stderr, /ADMISSION_KEY_PART/);
});

test('key answer is the full cell text (bold/backticks ignored): emit PASSES', () => {
  assert.equal(emit(md, md, { body: cell, answer: () => '985.926 s (+85.926 s over deadline)' }).status, 0);
  const bold = () => '| model | wall |\n| --- | --- |\n| Flash-High | **652 s, 723 s** |\n';
  assert.equal(emit(md, md, { body: bold, answer: () => '652 s, 723 s' }).status, 0);
});

test('whole value after a label passes; part of that value fails', () => {
  const config = () => '- volume: 0.8\n- default engine: Kokoro 1.2 (fallback Piper when the daemon is down)\n';
  assert.equal(emit(md, md, { body: config, answer: () => '0.8' }).status, 0);
  assert.match(emit(md, md, { body: config, answer: () => 'Kokoro 1.2' }).stderr, /ADMISSION_KEY_PART/);
});

// golems #1370 review r1 B1: escaped pipes are literal; the closing (and opening) pipe is optional.
test('escaped \\| stays inside its cell: a suffix of that cell FAILS, the whole cell PASSES', () => {
  const esc = () => '| metric | value |\n| --- | --- |\n| latency | 985.926 s \\| extra |\n';
  assert.match(emit(md, md, { body: esc, answer: () => 'extra' }).stderr, /ADMISSION_KEY_PART/);
  assert.equal(emit(md, md, { body: esc, answer: () => '985.926 s | extra' }).status, 0);
});

test('whole final cell of a row without outer pipes PASSES', () => {
  assert.equal(emit(md, md, { body: () => '| metric | value |\n| --- | --- |\n| latency | 985.926 s\n', answer: () => '985.926 s' }).status, 0);
  assert.equal(emit(md, md, { body: () => 'metric | value\n--- | ---\nlatency | 985.926 s\n', answer: () => '985.926 s' }).status, 0);
});
