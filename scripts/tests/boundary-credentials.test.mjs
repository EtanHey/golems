import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const checker = resolve(process.env.BOUNDARY_PREPUSH_CHECKER ?? 'scripts/ci/boundary-prepush.mjs');
const corpus = JSON.parse(readFileSync(new URL('./fixtures/boundary-fleet-paths.json', import.meta.url)));
const safe = [
  'formal/voice-a' + 'sk-' + 'no-answer/results/run.json',
  '"source": "tests/voice-a' + 'sk-' + 'no-answer.test.ts#abcdefghij0123456789"',
  'task-' + '1234567890abcdefgh',
  'desk-' + '1234567890abcdefgh',
];
const credentials = [
  'sk-' + 'a'.repeat(40), 'ghp_' + 'b'.repeat(36),
  'github_pat_' + 'c'.repeat(60), 'xoxb-' + 'd'.repeat(40),
  'AKIA' + 'E'.repeat(16),
];
const cases = safe.map((text, i) => [`path lookalike ${i}`, text, false]);
for (const [i, token] of credentials.entries()) {
  for (const [j, prefix] of ['', ' ', '=', '"', ':', '/', '\t', '('].entries()) {
    cases.push([`credential ${i} delimiter ${j}`, prefix + token, true]);
  }
}
// r1277: delimiters may be encoded in session JSONL, URLs and colored logs.
const sk = 'sk-', gh = 'ghp_', ak = 'AKIA';
const body = 'a'.repeat(40);
const escaped = [
  ['JSON newline', '{"text":"here it is:\\n' + sk + 'proj-' + body + '"}'],
  ['JSON tab', '{"text":"key\\t' + sk + body + '"}'],
  ['JSON newline AKIA', '{"out":"aws_access_key_id\\n' + ak + 'E'.repeat(16) + '"}'],
  ['JSON newline ghp', '{"out":"token:\\n' + gh + body + '"}'],
  ['ANSI color', '\x1b[32m' + sk + body + '\x1b[0m'],
  ['encoded assignment', 'next=%2Fcb%3Fkey%3D' + sk + body],
  ['encoded remote', 'https%3A%2F%2F' + gh + body + '%40github.com'],
  ['Unicode quote', '\\u0022' + sk + body],
  ['underscore', 'my_' + sk + body],
  ['hyphen', 'my-' + sk + body],
  ['environment suffix', 'OPENAI_API_KEY_' + sk + body],
  ['JSON carriage return', '\\r' + sk + body],
  ['escaped quote', '\\"' + sk + body],
  ['ANSI multiple parameters', '\x1b[1;32m' + sk + body],
  ['ANSI reset', '\x1b[m' + sk + body],
];
for (const [name, text] of escaped) cases.push([name, text, true]);
// Public-repository tracked paths and blob hashes only; no private repos or prose.
assert.deepEqual([...new Set(corpus.map(row => row.repo))].sort(),
  ['brainlayer', 'golems', 'narrationlayer', 'voicelayer']);
for (const row of corpus) {
  assert.match(row.sha256, /^[a-f0-9]{64}$/);
  assert.ok(!row.path.startsWith('/') && !row.path.split('/').includes('..'));
  cases.push([`fleet ${row.repo}/${row.path}`, row.path + '\n' + JSON.stringify({ [row.path]: row.sha256 }), false]);
}
for (const [name, text, refuse] of cases) {
  test(name, () => {
    const root = mkdtempSync(join(tmpdir(), 'boundary-credentials-'));
    const git = (...args) => {
      const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    try {
      git('init', '-q'); git('config', 'user.name', 'Fixture');
      git('config', 'user.email', 'fixture@example.com');
      git('commit', '--allow-empty', '-qm', 'base');
      const base = git('rev-parse', 'HEAD');
      writeFileSync(join(root, 'sample.txt'), text + '\n');
      git('add', 'sample.txt'); git('commit', '-qm', 'candidate');
      const head = git('rev-parse', 'HEAD');
      // The real scanner applies every forbidden class and every push pattern.
      const r = spawnSync(process.execPath, [checker], {
        cwd: root, encoding: 'utf8',
        input: `refs/heads/x ${head} refs/heads/x ${base}\n`,
      });
      assert.equal(r.status, refuse ? 1 : 0, r.stderr);
      assert.match(r.stderr, refuse ? /publication violation \(push-credentials\)/ : /PASS/);
      assert.ok(!r.stderr.includes(text), 'diagnostics must withhold content');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
