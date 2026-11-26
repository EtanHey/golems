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

function record(docs) {
  const key = docs.map(document => ({ document, question: `What is in ${document}?`, answer: `unique answer ${document}`, first_line: `# ${document}` }));
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

function emit(docs, files) {
  const dir = mkdtempSync(join(tmpdir(), 'attached-set-'));
  try {
    const folder = join(dir, 'R09-grounding');
    mkdirSync(folder);
    for (const f of files) writeFileSync(join(folder, f), `# ${f}\n`);
    writeFileSync(join(dir, 'author.md'), record(docs));
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
